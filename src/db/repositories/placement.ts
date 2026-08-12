import 'server-only';

import { asc, eq, inArray, sql } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';
import {
  catalogVersion as catalogVersionTable,
  checkoutAttempt,
  order,
  orderLine,
  product,
  slot,
} from '@/db/schema';
import { applyReservations, lockStockForUpdate, releaseReservations } from '@/db/repositories/availability';
import { bookSlot, lockSlotForUpdate, unbookSlot, zoneFeesByFsa } from '@/db/repositories/fulfilment';
import { demandByProduct } from '@/domain/availability';
import {
  evaluatePlacement,
  type PlacementDecision,
  type ProductView,
  type RequestedLine,
  type StockView,
} from '@/domain/placement';
import { normalisePostalCode, fsaOf } from '@/domain/serviceability';
import { cents, grams, type Cents, type PayMode, type Pricing } from '@/domain/types';

/**
 * ⭐ `PlaceOrder` — ONE transaction, EIGHT preconditions, ALL-OR-NOTHING.
 *
 * This is the highest-risk code in the system and the entire reason this
 * application has a server tier at all.
 *
 * ══ THE CANONICAL LOCK ORDER ══════════════════════════════════════════════
 *
 *      checkout_attempt  (FOR UPDATE)
 *   →  slot              (FOR UPDATE)
 *   →  product           (FOR SHARE,  id ASC)
 *   →  stock_item        (FOR UPDATE, product_id ASC)
 *
 * EVERY transaction touching more than one of these takes them in this order,
 * including admin writes. Two baskets containing {A, B} and {B, A} deadlock
 * roughly half the time without the ascending sort, and the symptom is a
 * random timeout under load rather than anything that looks like a lock bug.
 *
 * Products are `FOR SHARE`, not `FOR UPDATE`: concurrent placements read
 * products and must not serialise against each other, while an admin
 * repricing takes a conflicting lock and waits — which is exactly the
 * behaviour P4 and P8 need to be atomic.
 *
 * ══ WHAT MUST NOT HAPPEN IN HERE ══════════════════════════════════════════
 *
 * No Stripe call. No email. No HTTP of any kind. A transaction holding row
 * locks across a network round trip to a third party is a transaction whose
 * duration is set by someone else's availability.
 */

/**
 * Where the box actually goes.
 *
 * Separate from `postalCode` because the postal code is a SERVICEABILITY
 * input — it decides whether we deliver here and what the fee is — while
 * these lines are a FULFILMENT output that a human reads off a screen while
 * carrying a box. They travel together and mean different things.
 */
export interface DeliveryAddress {
  readonly line1: string;
  readonly line2?: string | null;
  readonly city: string;
  readonly province: string;
  readonly notes?: string | null;
}

export interface PlaceOrderInput {
  readonly attemptId: string | null;
  readonly customerId: string;
  readonly postalCode: string;
  readonly address: DeliveryAddress;
  readonly slotId: string;
  readonly businessDayId: string;
  readonly payMode: PayMode;
  readonly lines: readonly RequestedLine[];
  readonly nowMs: number;
}

export type PlaceOrderResult =
  | {
      readonly ok: true;
      readonly orderId: string;
      /** The tracking credential. Returned here so the caller never re-reads
       *  the row to find it — and so the success path cannot forget it. */
      readonly publicToken: string;
      readonly estTotalCents: Cents;
      readonly duplicate: boolean;
    }
  | (Extract<PlacementDecision, { ok: false }> & { readonly orderId?: undefined })
  | { readonly ok: false; readonly reason: 'checkoutAttemptNotOpen'; readonly orderId?: string };

/** `product` row → the domain's view of it. */
function toProductView(r: {
  id: string;
  name: string;
  handling: 'RAW' | 'MARINATED' | 'COOKED_CHILLED' | 'COOKED_HOT';
  pricingMode: 'pack' | 'perKg';
  packPriceCents: number | null;
  wMinG: number | null;
  wMaxG: number | null;
  ratePerKgCents: number | null;
  minOrderG: number | null;
  stepG: number | null;
  taxCode: string;
  active: boolean;
}): ProductView {
  const pricing: Pricing =
    r.pricingMode === 'pack'
      ? {
          mode: 'pack',
          price: cents(r.packPriceCents ?? 0),
          wMin: grams(r.wMinG ?? 0),
          wMax: grams(r.wMaxG ?? 0),
        }
      : {
          mode: 'perKg',
          ratePerKg: cents(r.ratePerKgCents ?? 0),
          minOrder: grams(r.minOrderG ?? 0),
          step: grams(r.stepG ?? 0),
        };

  return {
    id: r.id,
    name: r.name,
    handling: r.handling,
    pricing,
    taxCode: r.taxCode,
    active: r.active,
  };
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const postalCode = normalisePostalCode(input.postalCode);
  const fsa = fsaOf(postalCode);
  if (fsa === null) return { ok: false, reason: 'outsideDeliveryArea' };

  // Sorted, de-duplicated, ascending. This is the list every lock below is
  // taken against, and computing it once is what guarantees the slot, product
  // and stock locks agree about the order.
  const productIds = [...new Set(input.lines.map((l) => l.productId))].sort();

  return db.transaction(async (tx) => {
    // ── 0. Claim the checkout attempt ───────────────────────────────────
    //
    // Guarded here, inside the transaction, under a row lock. That is what
    // makes a double-submit produce exactly one order even when both requests
    // arrive at the same millisecond on different connections.
    let quote = null as
      | null
      | { quotedEstCents: Cents; quoteVersion: number; authorisedCeilingCents: Cents };

    if (input.attemptId !== null) {
      const attempts = await tx
        .select({
          id: checkoutAttempt.id,
          status: checkoutAttempt.status,
          orderId: checkoutAttempt.orderId,
          quotedEstCents: checkoutAttempt.quotedEstCents,
          quoteVersion: checkoutAttempt.quoteVersion,
          authorisedCeilingCents: checkoutAttempt.authorisedCeilingCents,
        })
        .from(checkoutAttempt)
        .where(eq(checkoutAttempt.id, input.attemptId))
        .for('update');

      const attempt = attempts[0];
      if (!attempt) return { ok: false as const, reason: 'checkoutAttemptNotOpen' as const };

      if (attempt.status !== 'AUTHORISED') {
        // ⚠ NOT AN ERROR TO THE CUSTOMER. An already-CONSUMED attempt is a
        // double-tap, and the right answer is the order the first tap made.
        // Anything else shows an alarming failure for a purchase that
        // succeeded. See DTM §7.4.
        return {
          ok: false as const,
          reason: 'checkoutAttemptNotOpen' as const,
          ...(attempt.orderId ? { orderId: attempt.orderId } : {}),
        };
      }

      quote = {
        quotedEstCents: cents(attempt.quotedEstCents),
        quoteVersion: attempt.quoteVersion,
        authorisedCeilingCents: cents(attempt.authorisedCeilingCents),
      };
    }

    // ── 1. slot (FOR UPDATE) ────────────────────────────────────────────
    const slotView = await lockSlotForUpdate(tx, input.slotId);

    // ── 2. product (FOR SHARE, id ASC) ──────────────────────────────────
    //
    // Read INSIDE the transaction, never passed in from outside it. Otherwise
    // an admin can deactivate or reprice a product mid-checkout and the stored
    // order disagrees with the amount actually authorised.
    const productRows =
      productIds.length === 0
        ? []
        : await tx
            .select({
              id: product.id,
              name: product.name,
              handling: product.handling,
              pricingMode: product.pricingMode,
              packPriceCents: product.packPriceCents,
              wMinG: product.wMinG,
              wMaxG: product.wMaxG,
              ratePerKgCents: product.ratePerKgCents,
              minOrderG: product.minOrderG,
              stepG: product.stepG,
              taxCode: product.taxCode,
              active: product.active,
            })
            .from(product)
            .where(inArray(product.id, productIds))
            .orderBy(asc(product.id))
            .for('share');

    const products = new Map(productRows.map((r) => [r.id, toProductView(r)]));

    // ── 3. stock_item (FOR UPDATE, product_id ASC) ──────────────────────
    const stockRows = await lockStockForUpdate(tx, input.businessDayId, productIds);
    const stock = new Map<string, StockView>(
      [...stockRows].map(([id, r]) => [id, { stockedG: r.stockedG, reservedG: r.reservedG }]),
    );

    // Zones are read without a lock: they change roughly never, and locking
    // the whole delivery area on every checkout would serialise every order in
    // the shop against every other one.
    const zones = await zoneFeesByFsa(tx);

    // The catalog version is read AFTER the product rows are share-locked, so
    // an admin cannot have repriced anything in this basket without waiting.
    // An unrelated edit elsewhere in the catalog still bumps it and forces a
    // harmless re-confirm — coarse and cheap, and the trade DTM §7.3 chose
    // deliberately over per-product versioning.
    const versionRows = await tx
      .select({ version: catalogVersionTable.version })
      .from(catalogVersionTable)
      .where(eq(catalogVersionTable.id, 1));
    const version = versionRows[0]?.version ?? 0;

    // ── 4. The decision. PURE. No I/O, all eight preconditions. ─────────
    const decision = evaluatePlacement(
      {
        postalCode,
        lines: input.lines,
        nowMs: input.nowMs,
        catalogVersion: version,
        quote,
      },
      { slot: slotView, zones, products, stock },
    );

    if (!decision.ok) {
      // No writes have happened. `reserved_g` and `booked_count` are
      // byte-identical to what they were on entry, which is the property every
      // failure path in this function must have.
      return decision;
    }

    // ── 5. Writes ───────────────────────────────────────────────────────
    //
    // From here, any failure must abort the whole transaction rather than
    // leave a partial order. Each write below is conditional and returns a
    // row count, so a row that moved between the lock and the write produces a
    // clean refusal rather than a CHECK violation.

    const booked = await bookSlot(tx, input.slotId);
    if (!booked) return { ok: false as const, reason: 'slotFull' as const };

    const reserved = await applyReservations(tx, input.businessDayId, decision.demandByProduct);
    if (!reserved.ok) {
      return {
        ok: false as const,
        reason: 'insufficientStock' as const,
        detail: {
          productId: reserved.productId,
          productName: products.get(reserved.productId)?.name,
        },
      };
    }

    const [created] = await tx
      .insert(order)
      .values({
        customerId: input.customerId,
        postalCode,
        fsa,
        addressLine1: input.address.line1,
        addressLine2: input.address.line2 ?? null,
        city: input.address.city,
        province: input.address.province,
        deliveryNotes: input.address.notes ?? null,
        slotId: input.slotId,
        businessDayId: input.businessDayId,
        payMode: input.payMode,
        status: 'PLACED',
        estLineTotalCents: decision.estLineTotalCents,
        deliveryFeeCents: decision.deliveryFeeCents,
        estTotalCents: decision.estTotalCents,
        catalogVersion: version,
        slotHotEligible: slotView?.hotEligible ?? false,
        hasHotLine: decision.hasHotLine,
      })
      .returning({ id: order.id, publicToken: order.publicToken });

    if (!created) throw new Error('order insert returned no row');

    await tx.insert(orderLine).values(
      decision.lines.map((l) => ({
        orderId: created.id,
        productId: l.productId,
        prepOptionId: l.prepOptionId,
        productName: l.productName,
        pricingMode: l.pricing.mode,
        handling: l.handling,
        ratePerKgCents: l.pricing.mode === 'perKg' ? l.pricing.ratePerKg : null,
        packPriceCents: l.pricing.mode === 'pack' ? l.pricing.price : null,
        requestedG: l.requestedG,
        estAmountCents: l.estAmountCents,
        taxCode: l.taxCode,
      })),
    );

    if (input.attemptId !== null) {
      // The UNIQUE on `order_id` plus this status guard is the second half of
      // the anti-double-order rule; the FOR UPDATE at step 0 is the first.
      await tx
        .update(checkoutAttempt)
        .set({ status: 'CONSUMED', orderId: created.id, updatedAt: new Date() })
        .where(eq(checkoutAttempt.id, input.attemptId));
    }

    return {
      ok: true as const,
      orderId: created.id,
      publicToken: created.publicToken,
      estTotalCents: decision.estTotalCents,
      duplicate: false,
    };
  });
}

/**
 * `CancelOrder` (spec §5.7) — returns the stock AND the slot.
 *
 * Only from `PLACED`. Once the butcher has started cutting, the meat is
 * committed; the spec refuses cancellation rather than pretending otherwise.
 *
 * Takes the same canonical lock order as placement, for the same reason.
 */
export async function cancelOrder(
  orderId: string,
): Promise<{ ok: true } | { ok: false; reason: 'notFound' | 'alreadyInPreparation' }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: order.id,
        status: order.status,
        slotId: order.slotId,
        businessDayId: order.businessDayId,
      })
      .from(order)
      .where(eq(order.id, orderId))
      .for('update');

    const o = rows[0];
    if (!o) return { ok: false as const, reason: 'notFound' as const };
    if (o.status !== 'PLACED') {
      return { ok: false as const, reason: 'alreadyInPreparation' as const };
    }

    const lines = await tx
      .select({ productId: orderLine.productId, requestedG: orderLine.requestedG })
      .from(orderLine)
      .where(eq(orderLine.orderId, orderId));

    // Aggregated across lines on the way OUT too. Releasing per line would be
    // correct only by accident — it happens to sum to the same total, but the
    // moment a line is added or removed the two spellings diverge.
    const demand = demandByProduct(
      lines.map((l) => ({ productId: l.productId, requestedG: grams(l.requestedG) })),
    );

    await releaseReservations(tx, o.businessDayId, demand);
    await unbookSlot(tx, o.slotId);

    await tx
      .update(order)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(order.id, orderId));

    return { ok: true as const };
  });
}

/**
 * Bump the catalog version. Any price or `active` change must call this, in
 * the SAME transaction as the change, or P8 cannot detect a stale quote.
 */
export async function bumpCatalogVersion(tx: Tx): Promise<number> {
  const rows = await tx
    .update(catalogVersionTable)
    .set({ version: sql`${catalogVersionTable.version} + 1`, updatedAt: new Date() })
    .where(eq(catalogVersionTable.id, 1))
    .returning({ version: catalogVersionTable.version });
  return rows[0]?.version ?? 0;
}

/**
 * DTM §15.3 — inv-O3 as a nightly query. It spans order_line → product → slot
 * and cannot be a CHECK in that form, so it is checked here instead of hoped
 * for. A hot line in a non-hot slot is a food-safety failure, not a data
 * inconsistency.
 */
export async function invO3Violations(): Promise<readonly { orderId: string }[]> {
  return db
    .select({ orderId: order.id })
    .from(order)
    .innerJoin(slot, eq(slot.id, order.slotId))
    .where(sql`${order.hasHotLine} AND NOT ${slot.hotEligible}`);
}
