import 'server-only';

import { and, eq, gte, sql } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';
import { serviceableFsa, slot, zone } from '@/db/schema';
import { fsaOf, type ZoneFee } from '@/domain/serviceability';
import type { SlotView } from '@/domain/slots';
import { cents } from '@/domain/types';

/**
 * Fulfilment repository — zones, serviceable areas, delivery slots.
 *
 * ⚠ CANONICAL LOCK ORDER: `slot` is FIRST. See the header of
 * `repositories/availability.ts`.
 */

/** FSA → fee rule, for the whole delivery area. Small enough to read whole. */
export async function zoneFeesByFsa(tx: Tx | typeof db = db): Promise<ReadonlyMap<string, ZoneFee>> {
  const rows = await tx
    .select({
      fsa: serviceableFsa.fsa,
      zoneId: zone.id,
      feeCents: zone.feeCents,
      freeAboveCents: zone.freeAboveCents,
    })
    .from(serviceableFsa)
    .innerJoin(zone, eq(zone.id, serviceableFsa.zoneId));

  return new Map(
    rows.map((r) => [
      r.fsa,
      {
        zoneId: r.zoneId,
        feeCents: cents(r.feeCents),
        freeAboveCents: r.freeAboveCents === null ? null : cents(r.freeAboveCents),
      },
    ]),
  );
}

/** The fee rule for one address, or `null` if it is outside the area (P1). */
export async function zoneForPostalCode(
  postalCode: string,
  tx: Tx | typeof db = db,
): Promise<ZoneFee | null> {
  const fsa = fsaOf(postalCode);
  if (fsa === null) return null;

  const rows = await tx
    .select({
      zoneId: zone.id,
      feeCents: zone.feeCents,
      freeAboveCents: zone.freeAboveCents,
    })
    .from(serviceableFsa)
    .innerJoin(zone, eq(zone.id, serviceableFsa.zoneId))
    .where(eq(serviceableFsa.fsa, fsa))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  return {
    zoneId: r.zoneId,
    feeCents: cents(r.feeCents),
    freeAboveCents: r.freeAboveCents === null ? null : cents(r.freeAboveCents),
  };
}

function toView(r: {
  id: string;
  startsAt: Date;
  endsAt: Date;
  cutoffAt: Date;
  capacity: number;
  bookedCount: number;
  hotEligible: boolean;
  active: boolean;
}): SlotView {
  return {
    id: r.id,
    startsAtMs: r.startsAt.getTime(),
    endsAtMs: r.endsAt.getTime(),
    cutoffAtMs: r.cutoffAt.getTime(),
    capacity: r.capacity,
    bookedCount: r.bookedCount,
    hotEligible: r.hotEligible,
    active: r.active,
  };
}

const SLOT_COLUMNS = {
  id: slot.id,
  startsAt: slot.startsAt,
  endsAt: slot.endsAt,
  cutoffAt: slot.cutoffAt,
  capacity: slot.capacity,
  bookedCount: slot.bookedCount,
  hotEligible: slot.hotEligible,
  active: slot.active,
} as const;

/**
 * Slots on or after a date, for the picker. **Read-only, no locks** — the
 * storefront must never block a placement.
 *
 * The cutoff filter is NOT applied here. The picker needs to show a closed
 * slot as closed rather than silently omit it, or the customer refreshes and
 * wonders where the 5pm delivery went. `evaluateSlot` decides; this returns
 * the raw rows.
 */
export async function slotsFrom(fromDate: string, tx: Tx | typeof db = db): Promise<readonly SlotView[]> {
  const rows = await tx
    .select(SLOT_COLUMNS)
    .from(slot)
    .where(and(gte(slot.serviceDate, fromDate), eq(slot.active, true)))
    .orderBy(slot.startsAt);
  return rows.map(toView);
}

/**
 * Lock one slot `FOR UPDATE` — the FIRST lock in the canonical order.
 *
 * `FOR UPDATE` rather than `FOR SHARE` because the placement increments
 * `booked_count`. This is the lock that serialises two customers racing for
 * the last place in a slot, and it is taken before any product or stock row so
 * that two baskets can never take these three locks in different orders.
 */
export async function lockSlotForUpdate(tx: Tx, slotId: string): Promise<SlotView | null> {
  const rows = await tx.select(SLOT_COLUMNS).from(slot).where(eq(slot.id, slotId)).for('update');
  const r = rows[0];
  return r ? toView(r) : null;
}

/**
 * Consume one place in a slot.
 *
 * The `booked_count < capacity` predicate in the WHERE is what makes this safe
 * to reason about alone: if the row moved between the lock and the update, the
 * update matches nothing and the caller gets `false` — rather than a CHECK
 * violation, which would already have aborted the whole transaction and lost
 * the chance to return `slotFull` cleanly.
 */
export async function bookSlot(tx: Tx, slotId: string): Promise<boolean> {
  const updated = await tx
    .update(slot)
    .set({ bookedCount: sql`${slot.bookedCount} + 1` })
    .where(and(eq(slot.id, slotId), sql`${slot.bookedCount} < ${slot.capacity}`))
    .returning({ id: slot.id });
  return updated.length > 0;
}

/**
 * Return a place to a slot — cancellation (spec §5.7).
 *
 * `GREATEST(0, …)` for the same reason stock release floors at zero: failing
 * to release strands capacity for the rest of the day, which is worse than
 * releasing one that was already free.
 */
export async function unbookSlot(tx: Tx, slotId: string): Promise<void> {
  await tx
    .update(slot)
    .set({ bookedCount: sql`GREATEST(0, ${slot.bookedCount} - 1)` })
    .where(eq(slot.id, slotId));
}

/** DTM §15.3 — should always be empty. Not a log line if it is not. */
export async function invF4Violations(): Promise<
  readonly { slotId: string; bookedCount: number; capacity: number }[]
> {
  return db
    .select({ slotId: slot.id, bookedCount: slot.bookedCount, capacity: slot.capacity })
    .from(slot)
    .where(sql`${slot.bookedCount} > ${slot.capacity}`);
}
