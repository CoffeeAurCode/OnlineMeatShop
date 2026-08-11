import 'server-only';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';
import { businessDay, product, stockItem } from '@/db/schema';
import {
  available,
  canOpenBusinessDay,
  declaredStockIsInCatalog,
  isIsoDate,
} from '@/domain/availability';
import { grams, type Grams } from '@/domain/types';

/**
 * Availability repository — the business day and today's stock.
 *
 * SQL lives here and nowhere else. The rules live in `src/domain/availability`
 * and are called from here; this file is responsible for locking, ordering and
 * transactions, and for nothing else.
 *
 * ⚠ CANONICAL LOCK ORDER — `slot` → `product` (FOR SHARE, id ASC) →
 * `stock_item` (FOR UPDATE, product_id ASC). Every function here that takes
 * more than one lock takes them in that order, including the admin writes.
 * Two transactions that disagree about the order deadlock roughly half the
 * time under concurrency, and the failure looks like a random timeout rather
 * than like a lock-ordering bug.
 */

export type OpenDayFailure =
  | 'invalidDate'
  | 'dayNotAfterCurrent'
  | 'unknownProduct'
  | 'negativeQuantity';

export type OpenDayResult =
  | { readonly ok: true; readonly businessDayId: string; readonly productCount: number }
  | { readonly ok: false; readonly reason: OpenDayFailure; readonly detail?: string };

/** The one open trading day, or `null` before the owner has opened one. */
export async function currentBusinessDay(
  tx: Tx | typeof db = db,
): Promise<{ id: string; businessDate: string } | null> {
  const rows = await tx
    .select({ id: businessDay.id, businessDate: businessDay.businessDate })
    .from(businessDay)
    .where(eq(businessDay.open, true))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * `OpenBusinessDay` (spec §5.1) — the owner declares today's quantities.
 *
 * One transaction: close the current day, open the new one, write its stock.
 * All of it or none of it, because a half-open day is a shop that is selling
 * against a stock table it does not have.
 *
 * **Nothing rolls over.** `reserved_g` starts at zero for every row, which is
 * the spec's `reserved' = ∅`. Yesterday's unsold quantity is a physical
 * question the owner answers by looking at the counter.
 */
export async function openBusinessDay(
  businessDate: string,
  declared: ReadonlyMap<string, Grams>,
): Promise<OpenDayResult> {
  if (!isIsoDate(businessDate)) {
    return { ok: false, reason: 'invalidDate', detail: businessDate };
  }
  for (const [productId, quantity] of declared) {
    if (quantity < 0 || !Number.isSafeInteger(quantity)) {
      return { ok: false, reason: 'negativeQuantity', detail: productId };
    }
  }

  return db.transaction(async (tx) => {
    // Lock the open day first. Two admin taps at 6am is not a hypothetical —
    // it is a phone with a slow connection and an impatient thumb.
    const current = await tx
      .select({ id: businessDay.id, businessDate: businessDay.businessDate })
      .from(businessDay)
      .where(eq(businessDay.open, true))
      .for('update')
      .limit(1);

    const currentDate = current[0]?.businessDate ?? null;
    if (!canOpenBusinessDay(currentDate, businessDate)) {
      return {
        ok: false as const,
        reason: 'dayNotAfterCurrent' as const,
        detail: `current=${currentDate ?? 'none'} requested=${businessDate}`,
      };
    }

    const declaredIds = [...declared.keys()];

    // inv-A1: `dom stocked ⊆ dom products`. Checked here rather than left to
    // the foreign key so the failure names the product instead of surfacing a
    // constraint violation the caller has to parse.
    if (declaredIds.length > 0) {
      const known = await tx
        .select({ id: product.id })
        .from(product)
        .where(inArray(product.id, declaredIds))
        .orderBy(asc(product.id))
        .for('share');

      const knownIds = new Set(known.map((r) => r.id));
      if (!declaredStockIsInCatalog(declaredIds, knownIds)) {
        const missing = declaredIds.filter((id) => !knownIds.has(id));
        return {
          ok: false as const,
          reason: 'unknownProduct' as const,
          detail: missing.join(', '),
        };
      }
    }

    if (current[0]) {
      await tx
        .update(businessDay)
        .set({ open: false, closedAt: new Date() })
        .where(eq(businessDay.id, current[0].id));
    }

    const [inserted] = await tx
      .insert(businessDay)
      .values({ businessDate, open: true })
      .returning({ id: businessDay.id });

    if (!inserted) throw new Error('business_day insert returned no row');

    if (declaredIds.length > 0) {
      await tx.insert(stockItem).values(
        declaredIds.map((productId) => ({
          businessDayId: inserted.id,
          productId,
          stockedG: declared.get(productId) ?? 0,
          reservedG: 0,
        })),
      );
    }

    return { ok: true as const, businessDayId: inserted.id, productCount: declaredIds.length };
  });
}

/**
 * Re-open a business date that was closed by mistake is deliberately NOT
 * offered. Correcting quantities is `adjustStock`, which does not touch
 * `reserved_g`, because resetting reservations would unfund every order
 * already placed against them — invisibly, and all at once.
 */
export async function adjustStock(
  businessDayId: string,
  productId: string,
  stockedG: Grams,
): Promise<{ ok: true } | { ok: false; reason: 'belowReserved'; reservedG: number }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ reservedG: stockItem.reservedG })
      .from(stockItem)
      .where(and(eq(stockItem.businessDayId, businessDayId), eq(stockItem.productId, productId)))
      .for('update');

    if (row && stockedG < row.reservedG) {
      // The CHECK would refuse this anyway. Catching it here turns a
      // constraint violation into a sentence the owner can act on: you cannot
      // declare less stock than you have already promised to customers.
      return { ok: false as const, reason: 'belowReserved' as const, reservedG: row.reservedG };
    }

    if (row) {
      await tx
        .update(stockItem)
        .set({ stockedG })
        .where(and(eq(stockItem.businessDayId, businessDayId), eq(stockItem.productId, productId)));
    } else {
      await tx.insert(stockItem).values({ businessDayId, productId, stockedG, reservedG: 0 });
    }
    return { ok: true as const };
  });
}

export interface StockRow {
  readonly productId: string;
  readonly stockedG: Grams;
  readonly reservedG: Grams;
  readonly availableG: Grams;
}

/**
 * Today's availability for a set of products. **Read-only, no locks** — this
 * is the storefront path, and it must never block a placement.
 *
 * A product with no row for today is absent from the result rather than
 * reported as zero. The caller decides whether "not stocked today" reads as
 * sold out or as not offered, and those are different sentences.
 */
export async function availabilityForProducts(
  businessDayId: string,
  productIds: readonly string[],
  tx: Tx | typeof db = db,
): Promise<ReadonlyMap<string, StockRow>> {
  if (productIds.length === 0) return new Map();

  const rows = await tx
    .select({
      productId: stockItem.productId,
      stockedG: stockItem.stockedG,
      reservedG: stockItem.reservedG,
    })
    .from(stockItem)
    .where(
      and(eq(stockItem.businessDayId, businessDayId), inArray(stockItem.productId, productIds)),
    );

  return new Map(
    rows.map((r) => [
      r.productId,
      {
        productId: r.productId,
        stockedG: grams(r.stockedG),
        reservedG: grams(r.reservedG),
        availableG: available(grams(r.stockedG), grams(r.reservedG)),
      },
    ]),
  );
}

/**
 * Lock today's stock rows for a set of products, **in canonical order**.
 *
 * Exported because `PlaceOrder` needs exactly this and must not spell it a
 * second way. `ORDER BY product_id ASC` is the part that matters: two baskets
 * containing `{A, B}` and `{B, A}` deadlock without it.
 *
 * `FOR UPDATE` — placements modify these rows, so they must serialise.
 */
export async function lockStockForUpdate(
  tx: Tx,
  businessDayId: string,
  productIds: readonly string[],
): Promise<ReadonlyMap<string, StockRow>> {
  if (productIds.length === 0) return new Map();

  const rows = await tx
    .select({
      productId: stockItem.productId,
      stockedG: stockItem.stockedG,
      reservedG: stockItem.reservedG,
    })
    .from(stockItem)
    .where(
      and(eq(stockItem.businessDayId, businessDayId), inArray(stockItem.productId, productIds)),
    )
    .orderBy(asc(stockItem.productId))
    .for('update');

  return new Map(
    rows.map((r) => [
      r.productId,
      {
        productId: r.productId,
        stockedG: grams(r.stockedG),
        reservedG: grams(r.reservedG),
        availableG: available(grams(r.stockedG), grams(r.reservedG)),
      },
    ]),
  );
}

/**
 * Commit demand against today's stock, inside a caller's transaction.
 *
 * The `WHERE reserved_g + demand <= stocked_g` clause is not redundant with
 * the CHECK constraint, and it is not redundant with the domain's `canReserve`
 * either. It is what makes this statement safe to reason about on its own: if
 * the row moved between the lock and the update, the update matches nothing
 * and the caller sees a row count of zero instead of a constraint violation
 * that has already aborted the whole transaction.
 */
export async function applyReservations(
  tx: Tx,
  businessDayId: string,
  demand: ReadonlyMap<string, Grams>,
): Promise<{ ok: true } | { ok: false; productId: string }> {
  // Canonical order again — this is a write against the rows locked above,
  // and iterating a Map in insertion order would not be sorted.
  for (const productId of [...demand.keys()].sort()) {
    const quantity = demand.get(productId) ?? grams(0);
    if (quantity === 0) continue;

    const updated = await tx
      .update(stockItem)
      .set({ reservedG: sql`${stockItem.reservedG} + ${quantity}` })
      .where(
        and(
          eq(stockItem.businessDayId, businessDayId),
          eq(stockItem.productId, productId),
          sql`${stockItem.reservedG} + ${quantity} <= ${stockItem.stockedG}`,
        ),
      )
      .returning({ productId: stockItem.productId });

    if (updated.length === 0) return { ok: false as const, productId };
  }
  return { ok: true as const };
}

/**
 * Return demand to the pool — cancellation (spec §5.7).
 *
 * `GREATEST(0, …)` rather than a bare subtraction. Releasing more than is
 * held would violate the CHECK and abort a cancellation, which is the wrong
 * way round: over-releasing frees stock that was already free, while refusing
 * to release strands it for the rest of the trading day. See the asymmetry
 * note on `release` in the domain module.
 */
export async function releaseReservations(
  tx: Tx,
  businessDayId: string,
  demand: ReadonlyMap<string, Grams>,
): Promise<void> {
  for (const productId of [...demand.keys()].sort()) {
    const quantity = demand.get(productId) ?? grams(0);
    if (quantity === 0) continue;

    await tx
      .update(stockItem)
      .set({ reservedG: sql`GREATEST(0, ${stockItem.reservedG} - ${quantity})` })
      .where(
        and(eq(stockItem.businessDayId, businessDayId), eq(stockItem.productId, productId)),
      );
  }
}

/** Products stocked today that have nothing left. Drives the sold-out badge. */
export async function soldOutProductIds(businessDayId: string): Promise<readonly string[]> {
  const rows = await db
    .select({ productId: stockItem.productId })
    .from(stockItem)
    .where(
      and(
        eq(stockItem.businessDayId, businessDayId),
        sql`${stockItem.reservedG} >= ${stockItem.stockedG}`,
      ),
    );
  return rows.map((r) => r.productId);
}

/**
 * The consistency check from DTM §15.3, as a query rather than as a belief.
 *
 * Returns rows that violate `inv-A3`. Should always be empty; if it is not,
 * the CHECK constraint has been dropped or bypassed, and that is a page-someone
 * event rather than a log line.
 */
export async function invA3Violations(): Promise<
  readonly { businessDayId: string; productId: string; stockedG: number; reservedG: number }[]
> {
  return db
    .select({
      businessDayId: stockItem.businessDayId,
      productId: stockItem.productId,
      stockedG: stockItem.stockedG,
      reservedG: stockItem.reservedG,
    })
    .from(stockItem)
    .where(sql`${stockItem.reservedG} > ${stockItem.stockedG}`);
}
