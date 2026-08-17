import 'server-only';

import { and, asc, eq, gt, isNotNull, ne, notInArray } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';
import { customer, order, orderLine, slot } from '@/db/schema';
import { transitionOrder } from '@/db/repositories/payments';
import { canTransition, requiresAssignment } from '@/domain/lifecycle';
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
  /**
   * ⭐ THE COUNTER HAS TO SEE THIS. A cash order is packed the same and handed
   * over differently — somebody is coming back with money for it — and the
   * client asked for it to be visible to the shop as well as the driver.
   */
  readonly payMode: 'PREPAID' | 'COD';
  /** What the driver said they took, on a cash order. Null until they report. */
  readonly cashCollectedCents: Cents | null;
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
      payMode: order.payMode,
      cashCollectedCents: order.cashCollectedCents,
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
      payMode: r.payMode,
      cashCollectedCents: r.cashCollectedCents === null ? null : cents(r.cashCollectedCents),
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
      payMode: order.payMode,
      cashCollectedCents: order.cashCollectedCents,
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
    payMode: o.payMode,
    cashCollectedCents: o.cashCollectedCents === null ? null : cents(o.cashCollectedCents),
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
): Promise<{
  readonly ok: boolean;
  readonly reason?: 'illegalTransition' | 'staleStatus' | 'notAssigned';
}> {
  if (!canTransition(from, to)) return { ok: false, reason: 'illegalTransition' };

  /*
   * ⭐ AN ORDER CANNOT GO OUT WITH NOBODY CARRYING IT.
   *
   * The rule is a pure predicate in `src/domain/lifecycle.ts`; the read that
   * feeds it is here, because the domain may not touch the database. Checked
   * OUTSIDE the transaction on purpose: it is a read of one row, and holding a
   * transaction open across it buys nothing — a partner unassigned in the
   * millisecond after this check still leaves an order that is OUT with a
   * snapshot naming who had it, which is recoverable. An order that reached
   * OUT with no snapshot at all is not.
   */
  if (requiresAssignment(to)) {
    const assignment = await assignmentOf(orderId);
    if (assignment === null) return { ok: false, reason: 'staleStatus' };
    if (assignment.partnerId === null) return { ok: false, reason: 'notAssigned' };
  }

  const moved = await db.transaction((tx) =>
    transitionOrder(tx, orderId, [from], to, to === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
  );

  return moved ? { ok: true } : { ok: false, reason: 'staleStatus' };
}

// ── Assignment and dispatch (07-PLAN Parts 3 and 5) ──────────────────────

/**
 * Give an order to a delivery partner.
 *
 * ⭐ WRITES A SNAPSHOT AS WELL AS THE REFERENCE, IN THE SAME STATEMENT.
 *
 * `partner_name` and `partner_phone` are copied here and never read back from
 * `delivery_partner` afterwards. The FK is for joining today's roster; the
 * snapshot is the historical record, and the `order_assignment_coherent` CHECK
 * refuses the half-written shape where one exists without the other.
 *
 * ⚠ REASSIGNMENT CLEARS `dispatched_at`. The new partner has not been told,
 * and an order that still reads as dispatched is one nobody sends a second
 * message about. This is the single easiest thing to leave out, and its
 * symptom is a driver sitting at home while the console says the job went out.
 *
 * ⚠ ONE ROW, ONE TABLE, NO OTHER LOCK. This takes no lock on `slot`,
 * `product` or `stock_item`, so the canonical lock order (`CLAUDE.md` §7) is
 * untouched and it cannot deadlock against checkout. Do not add a stock or
 * slot read in here.
 */
export async function assignPartner(
  orderId: string,
  partner: { id: string; name: string; phone: string },
  nowMs: number,
): Promise<{ readonly ok: boolean; readonly reason?: 'notFound' | 'finished' }> {
  const rows = await db
    .update(order)
    .set({
      deliveryPartnerId: partner.id,
      partnerName: partner.name,
      partnerPhone: partner.phone,
      assignedAt: new Date(nowMs),
      dispatchedAt: null,
      updatedAt: new Date(nowMs),
    })
    .where(
      and(
        eq(order.id, orderId),
        // The guard is in the WHERE clause rather than in a prior SELECT, so a
        // status that changed between the screen and this call is a no-op
        // rather than a lost update.
        notInArray(order.status, ['DELIVERED', 'CANCELLED']),
      ),
    )
    .returning({ id: order.id });

  if (rows[0] !== undefined) return { ok: true };

  const exists = await db
    .select({ status: order.status })
    .from(order)
    .where(eq(order.id, orderId))
    .limit(1);

  return { ok: false, reason: exists[0] === undefined ? 'notFound' : 'finished' };
}

/** Take the job back off somebody. Clears the dispatch flag with it. */
export async function unassignPartner(orderId: string, nowMs: number): Promise<boolean> {
  const rows = await db
    .update(order)
    .set({
      deliveryPartnerId: null,
      partnerName: null,
      partnerPhone: null,
      assignedAt: null,
      dispatchedAt: null,
      updatedAt: new Date(nowMs),
    })
    .where(and(eq(order.id, orderId), notInArray(order.status, ['DELIVERED', 'CANCELLED'])))
    .returning({ id: order.id });

  return rows[0] !== undefined;
}

/**
 * Record that the dispatch message actually went.
 *
 * ⚠ CALLED AFTER THE SEND, NEVER BEFORE. Marking first and sending second
 * means a Twilio failure leaves an order claiming a driver was told. The other
 * order — send, then mark — can double-send after a crash, and a driver
 * receiving the same job twice is a phone call, not a lost delivery.
 */
export async function markDispatched(orderId: string, nowMs: number): Promise<boolean> {
  const rows = await db
    .update(order)
    .set({ dispatchedAt: new Date(nowMs), updatedAt: new Date(nowMs) })
    .where(and(eq(order.id, orderId), isNotNull(order.assignedAt)))
    .returning({ id: order.id });

  return rows[0] !== undefined;
}

export interface DispatchSnapshot {
  readonly orderId: string;
  readonly reference: string;
  readonly partnerId: string;
  readonly partnerName: string;
  readonly partnerPhone: string;
  readonly assignedAtMs: number;
  readonly slotStartsAt: Date;
  readonly slotEndsAt: Date;
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly city: string;
  readonly province: string;
  readonly postalCode: string | null;
  readonly deliveryNotes: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly customerPhone: string | null;
  readonly customerName: string | null;
  /** Whether the driver holds their hand out at the door. Never the amount. */
  readonly payMode: 'PREPAID' | 'COD';
  readonly lines: readonly {
    name: string;
    requestedG: number;
    pricingMode: 'pack' | 'perKg';
    hot: boolean;
  }[];
}

/**
 * Everything the dispatch message needs, in one read.
 *
 * ⚠ `lat`/`lng` ARE `numeric` AND ARRIVE AS STRINGS. `pg` returns numeric as
 * text on purpose — it does not fit in a double without loss — so they are
 * parsed here, at the edge, exactly once. A `Number()` sprinkled at the call
 * site is how one of them ends up as the string `"45.501900"` inside a URL.
 */
export async function orderForDispatch(orderId: string): Promise<DispatchSnapshot | null> {
  const head = await db
    .select({
      id: order.id,
      postalCode: order.postalCode,
      payMode: order.payMode,
      partnerId: order.deliveryPartnerId,
      partnerName: order.partnerName,
      partnerPhone: order.partnerPhone,
      assignedAt: order.assignedAt,
      addressLine1: order.addressLine1,
      addressLine2: order.addressLine2,
      city: order.city,
      province: order.province,
      deliveryNotes: order.deliveryNotes,
      lat: order.lat,
      lng: order.lng,
      slotStartsAt: slot.startsAt,
      slotEndsAt: slot.endsAt,
      customerPhone: customer.phone,
      customerName: customer.name,
    })
    .from(order)
    .innerJoin(slot, eq(slot.id, order.slotId))
    .innerJoin(customer, eq(customer.id, order.customerId))
    .where(eq(order.id, orderId))
    .limit(1);

  const o = head[0];
  if (o === undefined) return null;
  if (o.partnerId === null || o.partnerName === null || o.partnerPhone === null) return null;
  if (o.assignedAt === null) return null;

  const lines = await db
    .select({
      name: orderLine.productName,
      requestedG: orderLine.requestedG,
      pricingMode: orderLine.pricingMode,
      handling: orderLine.handling,
    })
    .from(orderLine)
    .where(eq(orderLine.orderId, orderId))
    .orderBy(asc(orderLine.id));

  return {
    orderId: o.id,
    reference: o.id.slice(0, 8),
    partnerId: o.partnerId,
    partnerName: o.partnerName,
    partnerPhone: o.partnerPhone,
    assignedAtMs: o.assignedAt.getTime(),
    slotStartsAt: o.slotStartsAt,
    slotEndsAt: o.slotEndsAt,
    addressLine1: o.addressLine1,
    addressLine2: o.addressLine2,
    city: o.city,
    province: o.province,
    postalCode: o.postalCode,
    deliveryNotes: o.deliveryNotes,
    lat: o.lat === null ? null : Number(o.lat),
    lng: o.lng === null ? null : Number(o.lng),
    customerPhone: o.customerPhone,
    customerName: o.customerName,
    payMode: o.payMode,
    lines: lines.map((l) => ({
      name: l.name,
      requestedG: l.requestedG,
      pricingMode: l.pricingMode,
      hot: l.handling === 'COOKED_HOT',
    })),
  };
}

export interface Assignment {
  readonly partnerId: string | null;
  readonly partnerName: string | null;
  readonly partnerPhone: string | null;
  readonly assignedAtMs: number | null;
  readonly dispatchedAtMs: number | null;
}

/** The assignment state the console screen and the status guard both need. */
export async function assignmentOf(orderId: string): Promise<Assignment | null> {
  const rows = await db
    .select({
      partnerId: order.deliveryPartnerId,
      partnerName: order.partnerName,
      partnerPhone: order.partnerPhone,
      assignedAt: order.assignedAt,
      dispatchedAt: order.dispatchedAt,
    })
    .from(order)
    .where(eq(order.id, orderId))
    .limit(1);

  const r = rows[0];
  if (r === undefined) return null;
  return {
    partnerId: r.partnerId,
    partnerName: r.partnerName,
    partnerPhone: r.partnerPhone,
    assignedAtMs: r.assignedAt?.getTime() ?? null,
    dispatchedAtMs: r.dispatchedAt?.getTime() ?? null,
  };
}

// ── The new-order alarm ──────────────────────────────────────────────────

export interface ArrivedOrder {
  readonly id: string;
  readonly reference: string;
  readonly placedAtMs: number;
  readonly hasHotLine: boolean;
  readonly estTotalCents: number;
}

/**
 * Orders that landed after a moment the CONSOLE remembers.
 *
 * ══ WHY A POLL AND NOT A PUSH ═════════════════════════════════════════════
 *
 * Supabase Realtime was cut at launch (D18), and re-adding it would mean
 * exposing `order` to the anon key behind RLS policies — a second
 * authorisation system, on the table holding customers' home addresses, so
 * that a phone can make a noise. A ten-second poll behind the staff cookie
 * reuses the authorisation that already exists and cannot leak a row the
 * console could not already read.
 *
 * ⚠ THE CURSOR IS A TIMESTAMP THE CALLER HOLDS, NOT A "SEEN" FLAG ON THE ROW.
 * A flag would mean two consoles fighting over it — the first tab to poll
 * would mark the order seen and the second would stay silent, which is exactly
 * wrong when the owner has the shop tablet open and their phone in a pocket.
 *
 * ⚠ AND IT IS `>`, NOT `>=`. With `>=`, the order that triggered this poll is
 * returned again on the next one, forever, because its own timestamp becomes
 * the cursor. The alarm would never stop.
 */
export async function ordersArrivedSince(
  sinceMs: number,
  limit = 20,
): Promise<readonly ArrivedOrder[]> {
  const rows = await db
    .select({
      id: order.id,
      postalCode: order.postalCode,
      createdAt: order.createdAt,
      hasHotLine: order.hasHotLine,
      estTotalCents: order.estTotalCents,
    })
    .from(order)
    .where(and(gt(order.createdAt, new Date(sinceMs)), ne(order.status, 'CANCELLED')))
    .orderBy(asc(order.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    reference: orderRef({ id: r.id, postalCode: r.postalCode }),
    placedAtMs: r.createdAt.getTime(),
    hasHotLine: r.hasHotLine,
    estTotalCents: r.estTotalCents,
  }));
}
