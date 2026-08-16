import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';
import { deliveryPartner } from '@/db/schema';

/**
 * The delivery partner roster. CRUD, and nothing more.
 *
 * There is no matching module in `src/domain/` and that is deliberate: a
 * roster has no rule to state. Inventing a `Partner` aggregate here would be
 * inventing work — the only invariant in play (the number is E.164) is a CHECK
 * constraint plus `normalisePhone`, which is where a shape rule belongs.
 *
 * ⚠ EVERY WRITE HERE TOUCHES ONLY `delivery_partner`. It takes no lock on
 * `slot`, `product` or `stock_item`, so the canonical lock order
 * (`CLAUDE.md` §7) is untouched and this cannot deadlock against checkout.
 * If a future function here needs one of those rows, it inherits that whole
 * rule and this comment stops being true.
 */

export interface Partner {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly active: boolean;
  readonly notes: string | null;
  readonly sortOrder: number;
}

/**
 * The roster.
 *
 * `activeOnly` exists because the two callers want different things and both
 * are right: the assignment picker must not offer somebody who left, and the
 * management screen must show them so they can be brought back.
 */
export async function listPartners(
  activeOnly: boolean,
  tx: Tx | typeof db = db,
): Promise<readonly Partner[]> {
  const rows = await tx
    .select({
      id: deliveryPartner.id,
      name: deliveryPartner.name,
      phone: deliveryPartner.phone,
      active: deliveryPartner.active,
      notes: deliveryPartner.notes,
      sortOrder: deliveryPartner.sortOrder,
    })
    .from(deliveryPartner)
    .where(activeOnly ? eq(deliveryPartner.active, true) : undefined)
    .orderBy(asc(deliveryPartner.sortOrder), asc(deliveryPartner.name));

  return rows;
}

export async function partnerById(
  id: string,
  tx: Tx | typeof db = db,
): Promise<Partner | null> {
  const rows = await tx
    .select({
      id: deliveryPartner.id,
      name: deliveryPartner.name,
      phone: deliveryPartner.phone,
      active: deliveryPartner.active,
      notes: deliveryPartner.notes,
      sortOrder: deliveryPartner.sortOrder,
    })
    .from(deliveryPartner)
    .where(eq(deliveryPartner.id, id))
    .limit(1);

  return rows[0] ?? null;
}

export type PartnerWriteResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: 'duplicatePhone' | 'notFound' };

/**
 * Add somebody to the roster.
 *
 * ⭐ THE DUPLICATE CHECK IS THE DATABASE'S, NOT A SELECT-THEN-INSERT.
 *
 * `partner_phone_active` is a partial unique index, so two simultaneous adds
 * of the same number cannot both win. Checking first and inserting second
 * would pass its own test and lose the race in production — and the
 * consequence of losing it is two identical dispatch messages, which is how
 * two drivers turn up at one door.
 *
 * `phone` must ALREADY be E.164. This function does not normalise, because
 * normalising in a repository hides the failure from the route that has the
 * user's input and can say something useful about it.
 */
export async function addPartner(
  input: { name: string; phone: string; notes: string | null; sortOrder: number },
  tx: Tx | typeof db = db,
): Promise<PartnerWriteResult> {
  try {
    const rows = await tx
      .insert(deliveryPartner)
      .values({
        name: input.name,
        phone: input.phone,
        notes: input.notes,
        sortOrder: input.sortOrder,
      })
      .returning({ id: deliveryPartner.id });

    const row = rows[0];
    if (row === undefined) return { ok: false, reason: 'duplicatePhone' };
    return { ok: true, id: row.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'duplicatePhone' };
    throw error;
  }
}

/**
 * Edit a partner, including deactivating one.
 *
 * ⚠ DEACTIVATION IS `active = false`, NEVER A DELETE. Orders reference this
 * row, the FK is `on delete set null`, and deleting would strip the live
 * reference off every order they ever carried. The snapshot on the order
 * survives it, but the join does not, and the roster screen's history stops
 * working.
 *
 * Reactivating can fail on the partial unique index — somebody else may hold
 * the number now — which is why this returns the same refusal as `addPartner`.
 */
export async function updatePartner(
  id: string,
  patch: {
    name?: string | undefined;
    phone?: string | undefined;
    notes?: string | null | undefined;
    active?: boolean | undefined;
    sortOrder?: number | undefined;
  },
  tx: Tx | typeof db = db,
): Promise<PartnerWriteResult> {
  try {
    const rows = await tx
      .update(deliveryPartner)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(deliveryPartner.id, id))
      .returning({ id: deliveryPartner.id });

    const row = rows[0];
    if (row === undefined) return { ok: false, reason: 'notFound' };
    return { ok: true, id: row.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'duplicatePhone' };
    throw error;
  }
}

/**
 * Postgres SQLSTATE 23505 — unique violation.
 *
 * Matched on the CODE, not on the message text. Message text is localised by
 * the server's `lc_messages` and changes between major versions; the code has
 * not changed since Postgres 8.
 *
 * ⚠ AND IT WALKS `cause`, WHICH IS THE WHOLE REASON THIS FUNCTION IS MORE THAN
 * ONE LINE.
 *
 * Drizzle does not rethrow the driver's error. It throws its OWN
 * `Failed query: insert into "delivery_partner" ...` with the `pg` error
 * attached as `cause`, so `error.code` is `undefined` at the top level and a
 * top-level-only check silently falls through to `throw error`.
 *
 * Measured, not guessed: adding a partner with a number an active partner
 * already had returned **HTTP 500** instead of `duplicatePhone`, and the log
 * showed `[cause]: error: duplicate key value violates unique constraint
 * "partner_phone_active" ... code: '23505'`. The behaviour is right — the
 * database refused, nothing was written — but the owner sees "something went
 * wrong" for a mistake the screen could have explained in a sentence.
 *
 * The loop is bounded, because a cause chain can be circular and this must not
 * be the thing that hangs a request.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The partner most recently assigned to anything, to pre-select in the picker.
 *
 * At 2-6 orders a day it is the same person nearly every time, and a default
 * that is right 80% of the time saves more taps than a clean empty state
 * does. Only ever a DEFAULT — the owner can always pick somebody else.
 */
export async function lastAssignedPartnerId(tx: Tx | typeof db = db): Promise<string | null> {
  const rows = await tx.execute<{ delivery_partner_id: string }>(sql`
    select o.delivery_partner_id
      from "order" o
      join delivery_partner p on p.id = o.delivery_partner_id
     where o.delivery_partner_id is not null
       and p.active
     order by o.assigned_at desc
     limit 1
  `);

  const row = rows.rows[0];
  return row === undefined ? null : row.delivery_partner_id;
}

/** Whether anybody can be assigned at all. Drives the console's empty state. */
export async function hasActivePartner(tx: Tx | typeof db = db): Promise<boolean> {
  const rows = await tx
    .select({ id: deliveryPartner.id })
    .from(deliveryPartner)
    .where(and(eq(deliveryPartner.active, true)))
    .limit(1);

  return rows.length > 0;
}
