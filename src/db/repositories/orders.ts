import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';
import { order, orderLine, slot } from '@/db/schema';
import { transitionOrder } from '@/db/repositories/payments';
import { canTransition } from '@/domain/lifecycle';
import { recordActualWeight, toleranceBand, type WeighableLine } from '@/domain/weighing';
import { cents, grams, type Cents, type Grams, type OrderStatus, type Pricing } from '@/domain/types';

/**
 * Order reads for the console, and the one write that records a weight.
 *
 * The queue is deliberately a plain point-in-time read with no caching of any
 * kind. `04-PLAN` §4 is explicit: a cached stock or order number at 6am is a
 * wrong number, and the owner acting on one is the highest-severity defect
 * class in the system.
 */

export interface QueueLine {
  readonly id: string;
  readonly productName: string;
  readonly pricingMode: 'pack' | 'perKg';
  readonly handling: 'RAW' | 'MARINATED' | 'COOKED_CHILLED' | 'COOKED_HOT';
  readonly requestedG: Grams;
  readonly estAmountCents: Cents;
  readonly actWeightG: Grams | null;
  readonly actAmountCents: Cents | null;
  readonly varianceApproved: boolean;
  /** Only per-kg lines have one. Shown at the scale, before weighing. */
  readonly band: { readonly lowerG: number; readonly upperG: number } | null;
}

export interface QueueOrder {
  readonly id: string;
  readonly status: OrderStatus;
  /** Null for an order located by coordinates. See `order_is_locatable`. */
  readonly postalCode: string | null;
  readonly estTotalCents: Cents;
  readonly finalTotalCents: Cents | null;
  readonly deliveryFeeCents: Cents;
  readonly hasHotLine: boolean;
  readonly lines: readonly QueueLine[];
}

/**
 * What the console calls an order at the top of a screen.
 *
 * ⚠ IT USED TO BE THE POSTAL CODE, FULL STOP, and that stopped being possible
 * when an order could be located by coordinates instead. The postal code is
 * still preferred where there is one: the owner recognises `H2X 1Y4` and does
 * not recognise a UUID. Where there is not, the first eight characters of the
 * id are enough to tell two orders apart on one morning's queue, and they are
 * what the URL already shows.
 */
export function orderRef(o: { id: string; postalCode: string | null }): string {
  return o.postalCode ?? `#${o.id.slice(0, 8)}`;
}

export interface QueueSlot {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly hotEligible: boolean;
  readonly orders: readonly QueueOrder[];
}

function pricingOf(l: {
  pricingMode: 'pack' | 'perKg';
  ratePerKgCents: number | null;
  packPriceCents: number | null;
  requestedG: number;
}): Pricing {
  return l.pricingMode === 'pack'
    ? // wMin/wMax are not stored on the line — the pack range is a catalog
      // fact, not an order fact, and weighing never consults it. The requested
      // weight stands in so the shape is complete.
      {
        mode: 'pack',
        price: cents(l.packPriceCents ?? 0),
        wMin: grams(l.requestedG),
        wMax: grams(l.requestedG),
      }
    : {
        mode: 'perKg',
        ratePerKg: cents(l.ratePerKgCents ?? 0),
        // Placement already validated the quantity against the catalog's step
        // and minimum. Re-deriving them here would re-litigate a decision the
        // order has already recorded, using values that may since have moved.
        minOrder: grams(0),
        step: grams(1),
      };
}

/**
 * The day's orders, grouped by delivery slot, in slot order.
 *
 * Grouped in application code rather than by a windowed query: at 2 to 6
 * orders a day the whole result is a handful of rows, and a readable shape is
 * worth more here than a query that scales to a volume this shop will not see.
 */
export async function orderQueue(
  businessDayId: string,
  tx: Tx | typeof db = db,
): Promise<readonly QueueSlot[]> {
  const rows = await tx
    .select({
      slotId: slot.id,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      hotEligible: slot.hotEligible,
      orderId: order.id,
      status: order.status,
      postalCode: order.postalCode,
      estTotalCents: order.estTotalCents,
      finalTotalCents: order.finalTotalCents,
      deliveryFeeCents: order.deliveryFeeCents,
      hasHotLine: order.hasHotLine,
    })
    .from(order)
    .innerJoin(slot, eq(slot.id, order.slotId))
    .where(eq(order.businessDayId, businessDayId))
    .orderBy(asc(slot.startsAt), asc(order.createdAt));

  if (rows.length === 0) return [];

  const lines = await tx
    .select({
      id: orderLine.id,
      orderId: orderLine.orderId,
      productName: orderLine.productName,
      pricingMode: orderLine.pricingMode,
      handling: orderLine.handling,
      ratePerKgCents: orderLine.ratePerKgCents,
      packPriceCents: orderLine.packPriceCents,
      requestedG: orderLine.requestedG,
      estAmountCents: orderLine.estAmountCents,
      actWeightG: orderLine.actWeightG,
      actAmountCents: orderLine.actAmountCents,
      varianceApprovedAt: orderLine.varianceApprovedAt,
    })
    .from(orderLine)
    .innerJoin(order, eq(order.id, orderLine.orderId))
    .where(eq(order.businessDayId, businessDayId));

  const linesByOrder = new Map<string, QueueLine[]>();
  for (const l of lines) {
    const list = linesByOrder.get(l.orderId) ?? [];
    list.push({
      id: l.id,
      productName: l.productName,
      pricingMode: l.pricingMode,
      handling: l.handling,
      requestedG: grams(l.requestedG),
      estAmountCents: cents(l.estAmountCents),
      actWeightG: l.actWeightG === null ? null : grams(l.actWeightG),
      actAmountCents: l.actAmountCents === null ? null : cents(l.actAmountCents),
      varianceApproved: l.varianceApprovedAt !== null,
      band: l.pricingMode === 'perKg' ? toleranceBand(grams(l.requestedG)) : null,
    });
    linesByOrder.set(l.orderId, list);
  }

  const slots = new Map<string, { meta: Omit<QueueSlot, 'orders'>; orders: QueueOrder[] }>();
  for (const r of rows) {
    const entry = slots.get(r.slotId) ?? {
      meta: {
        id: r.slotId,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        hotEligible: r.hotEligible,
      },
      orders: [],
    };
    entry.orders.push({
      id: r.orderId,
      status: r.status,
      postalCode: r.postalCode,
      estTotalCents: cents(r.estTotalCents),
      finalTotalCents: r.finalTotalCents === null ? null : cents(r.finalTotalCents),
      deliveryFeeCents: cents(r.deliveryFeeCents),
      hasHotLine: r.hasHotLine,
      lines: linesByOrder.get(r.orderId) ?? [],
    });
    slots.set(r.slotId, entry);
  }

  return [...slots.values()].map((s) => ({ ...s.meta, orders: s.orders }));
}

/** One order, for the weighing screen. `null` when it does not exist. */
export async function orderForWeighing(
  orderId: string,
  tx: Tx | typeof db = db,
): Promise<QueueOrder | null> {
  const rows = await tx
    .select({
      id: order.id,
      status: order.status,
      postalCode: order.postalCode,
      estTotalCents: order.estTotalCents,
      finalTotalCents: order.finalTotalCents,
      deliveryFeeCents: order.deliveryFeeCents,
      hasHotLine: order.hasHotLine,
    })
    .from(order)
    .where(eq(order.id, orderId))
    .limit(1);

  const o = rows[0];
  if (!o) return null;

  const lines = await tx
    .select()
    .from(orderLine)
    .where(eq(orderLine.orderId, orderId))
    .orderBy(asc(orderLine.productName));

  return {
    id: o.id,
    status: o.status,
    postalCode: o.postalCode,
    estTotalCents: cents(o.estTotalCents),
    finalTotalCents: o.finalTotalCents === null ? null : cents(o.finalTotalCents),
    deliveryFeeCents: cents(o.deliveryFeeCents),
    hasHotLine: o.hasHotLine,
    lines: lines.map((l) => ({
      id: l.id,
      productName: l.productName,
      pricingMode: l.pricingMode,
      handling: l.handling,
      requestedG: grams(l.requestedG),
      estAmountCents: cents(l.estAmountCents),
      actWeightG: l.actWeightG === null ? null : grams(l.actWeightG),
      actAmountCents: l.actAmountCents === null ? null : cents(l.actAmountCents),
      varianceApproved: l.varianceApprovedAt !== null,
      band: l.pricingMode === 'perKg' ? toleranceBand(grams(l.requestedG)) : null,
    })),
  };
}

export type SaveWeightResult =
  | { readonly ok: true; readonly actWeightG: Grams; readonly actAmountCents: Cents }
  | {
      readonly ok: false;
      readonly reason:
        | 'orderNotInPreparation'
        | 'packLineNotWeighable'
        | 'varianceApprovalRequired'
        | 'lineNotFound';
      readonly detail?: { readonly lowerG?: number; readonly upperG?: number; readonly requestedG?: number };
    };

/**
 * ⭐ Record one weight.
 *
 * The decision is the domain's — this function reads, asks, and writes what it
 * is told. In particular it does NOT clamp an out-of-band weight, and it does
 * not decide for itself that a 30% variance is close enough. Refusing is the
 * behaviour: the butcher cannot unilaterally sell someone a different amount
 * of meat than they agreed to buy.
 *
 * `approveVariance` is the customer's yes, arriving from the console after the
 * owner has actually asked them. It is not a retry flag.
 */
export async function saveActualWeight(
  orderId: string,
  lineId: string,
  weighedG: Grams,
  approveVariance: boolean,
): Promise<SaveWeightResult> {
  return db.transaction(async (tx) => {
    // The order row is locked first and the line read under it, so two taps on
    // the confirm button cannot both pass the PREPARING check and write.
    const orders = await tx
      .select({ id: order.id, status: order.status })
      .from(order)
      .where(eq(order.id, orderId))
      .for('update');

    const o = orders[0];
    if (!o) return { ok: false as const, reason: 'lineNotFound' as const };

    const rows = await tx
      .select()
      .from(orderLine)
      .where(and(eq(orderLine.id, lineId), eq(orderLine.orderId, orderId)))
      .limit(1);

    const l = rows[0];
    if (!l) return { ok: false as const, reason: 'lineNotFound' as const };

    const line: WeighableLine = {
      lineId: l.id,
      pricing: pricingOf(l),
      requestedG: grams(l.requestedG),
      actWeightG: l.actWeightG === null ? null : grams(l.actWeightG),
      varianceApproved: approveVariance || l.varianceApprovedAt !== null,
    };

    const decision = recordActualWeight(o.status, line, weighedG);
    if (!decision.ok) return decision;

    await tx
      .update(orderLine)
      .set({
        actWeightG: decision.actWeightG,
        actAmountCents: decision.actAmountCents,
        // Stamped only when the approval was actually needed, so the column
        // records "a human said yes to an unusual weight" rather than "this
        // line was weighed with the flag set".
        varianceApprovedAt:
          approveVariance && l.varianceApprovedAt === null ? new Date() : l.varianceApprovedAt,
      })
      .where(eq(orderLine.id, lineId));

    return {
      ok: true as const,
      actWeightG: decision.actWeightG,
      actAmountCents: decision.actAmountCents,
    };
  });
}

/**
 * Move an order along its lifecycle, from the console's status buttons.
 *
 * Delegates to `transitionOrder` rather than issuing its own UPDATE, because
 * that function already carries the guard that matters: the transition names
 * the statuses it may move FROM, so a stale screen or a double tap is a no-op
 * instead of walking the order backwards. `canTransition` is checked first so
 * an illegal pair is refused before it reaches SQL, where it would look like
 * an ordinary no-match.
 */
export async function advanceOrder(
  orderId: string,
  from: OrderStatus,
  to: OrderStatus,
): Promise<{ readonly ok: boolean; readonly reason?: 'illegalTransition' | 'staleStatus' }> {
  if (!canTransition(from, to)) return { ok: false, reason: 'illegalTransition' };

  const moved = await db.transaction((tx) =>
    transitionOrder(tx, orderId, [from], to, to === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
  );

  return moved ? { ok: true } : { ok: false, reason: 'staleStatus' };
}
