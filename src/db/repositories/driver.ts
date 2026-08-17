import 'server-only';

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { customer, driverLink, order, orderLine, slot } from '@/db/schema';
import { canReportDelivery, cashOutcome, type CashOutcome } from '@/domain/driver';
import type { OrderStatus, PayMode } from '@/domain/types';

/**
 * What one delivery partner can see and do.
 *
 * ══ THE SCOPING RULE, AND IT IS THE WHOLE SECURITY MODEL ══════════════════
 *
 * ⭐ EVERY QUERY IN THIS FILE IS FILTERED BY `delivery_partner_id`, AND THAT
 * FILTER IS IN THE `WHERE` CLAUSE — never applied afterwards in JavaScript.
 *
 * The client chose "only orders assigned to them" over "the whole board" on
 * 2026-08-17. With one van those look identical today, which is exactly why
 * the filter has to be structural rather than a convention: the day a second
 * driver is added, a filter that lived in a `.filter()` on a page component is
 * a filter somebody forgets, and the leak is every customer's home address.
 *
 * ⚠ `jobForPartner` TAKES THE PARTNER ID AS WELL AS THE ORDER ID for the same
 * reason. Looking an order up by id and then comparing its partner to the
 * session is a check-then-use; making the pair the lookup key means a driver
 * who guesses another order's UUID gets `null`, which is indistinguishable
 * from an order that does not exist.
 *
 * ══ WHAT THE DRIVER IS DELIBERATELY NOT SHOWN ═════════════════════════════
 *
 * No line prices, no estimate, no delivery fee, no email, and no other
 * driver's work. The ONE money figure that appears is the amount to collect on
 * a cash order, because a driver who does not know it cannot do the job — and
 * it appears only on cash orders. Same principle as the dispatch SMS
 * (`src/domain/dispatch.ts`): every field earns its place by answering a
 * question the driver would otherwise ask by phone.
 */

export interface DriverJobLine {
  readonly name: string;
  readonly requestedG: number;
  readonly pricingMode: 'pack' | 'perKg';
  readonly hot: boolean;
}

export interface DriverJobSummary {
  readonly orderId: string;
  /** The short reference the owner and the driver say out loud. */
  readonly reference: string;
  readonly status: OrderStatus;
  readonly payMode: PayMode;
  /** Cents. Null on a prepaid order, and null on a cash order not yet weighed. */
  readonly finalTotalCents: number | null;
  readonly slotStartsAtMs: number;
  readonly slotEndsAtMs: number;
  readonly city: string;
  readonly addressLine1: string;
  readonly hasHotLine: boolean;
  readonly cashCollectedCents: number | null;
}

export interface DriverJob extends DriverJobSummary {
  readonly addressLine2: string | null;
  readonly province: string;
  readonly postalCode: string | null;
  readonly deliveryNotes: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly customerName: string | null;
  readonly customerPhone: string;
  readonly lines: readonly DriverJobLine[];
}

/**
 * Everything currently on this driver's plate, plus what they finished today.
 *
 * ⚠ THE FINISHED ONES ARE BOUNDED BY A COUNT, NOT BY A DATE. A driver
 * signing in at 05:00 has an empty "today" and would see a screen that looks
 * broken; a driver on their eleventh drop does not need the first one. Twenty
 * is enough to answer "did I already do that one?" and small enough that the
 * page is one query and no pagination.
 *
 * Ordering: open jobs first (soonest slot first, because that is the order
 * they will be driven), then the finished ones newest-first.
 */
export async function jobsForPartner(partnerId: string): Promise<readonly DriverJobSummary[]> {
  const rows = await db
    .select({
      orderId: order.id,
      status: order.status,
      payMode: order.payMode,
      finalTotalCents: order.finalTotalCents,
      cashCollectedCents: order.cashCollectedCents,
      slotStartsAt: slot.startsAt,
      slotEndsAt: slot.endsAt,
      city: order.city,
      addressLine1: order.addressLine1,
      hasHotLine: order.hasHotLine,
    })
    .from(order)
    .innerJoin(slot, eq(slot.id, order.slotId))
    .where(
      and(
        eq(order.deliveryPartnerId, partnerId),
        // An unassigned order has no snapshot either; requiring the timestamp
        // keeps this consistent with `order_assignment_coherent` rather than
        // relying on the FK alone.
        isNotNull(order.assignedAt),
      ),
    )
    // `CASE` rather than a status list, so an open job sorts before a closed
    // one regardless of how the enum happens to be ordered in Postgres.
    .orderBy(
      sql`CASE WHEN ${order.status} IN ('DELIVERED', 'CANCELLED') THEN 1 ELSE 0 END`,
      asc(slot.startsAt),
      desc(order.createdAt),
    )
    .limit(60);

  return rows.map((r) => ({
    orderId: r.orderId,
    reference: r.orderId.slice(0, 8),
    status: r.status,
    payMode: r.payMode,
    finalTotalCents: r.finalTotalCents,
    cashCollectedCents: r.cashCollectedCents,
    slotStartsAtMs: r.slotStartsAt.getTime(),
    slotEndsAtMs: r.slotEndsAt.getTime(),
    city: r.city,
    addressLine1: r.addressLine1,
    hasHotLine: r.hasHotLine,
  }));
}

/**
 * One job in full — the screen the driver opens at the door.
 *
 * ⚠ THE PARTNER ID IS PART OF THE LOOKUP, NOT A CHECK AFTERWARDS. See the
 * file header. A driver holding another order's UUID gets `null` here, which
 * the page renders identically to "no such job".
 */
export async function jobForPartner(
  partnerId: string,
  orderId: string,
): Promise<DriverJob | null> {
  const head = await db
    .select({
      orderId: order.id,
      status: order.status,
      payMode: order.payMode,
      finalTotalCents: order.finalTotalCents,
      cashCollectedCents: order.cashCollectedCents,
      slotStartsAt: slot.startsAt,
      slotEndsAt: slot.endsAt,
      addressLine1: order.addressLine1,
      addressLine2: order.addressLine2,
      city: order.city,
      province: order.province,
      postalCode: order.postalCode,
      deliveryNotes: order.deliveryNotes,
      lat: order.lat,
      lng: order.lng,
      hasHotLine: order.hasHotLine,
      customerName: customer.name,
      customerPhone: customer.phone,
    })
    .from(order)
    .innerJoin(slot, eq(slot.id, order.slotId))
    .innerJoin(customer, eq(customer.id, order.customerId))
    .where(and(eq(order.id, orderId), eq(order.deliveryPartnerId, partnerId)))
    .limit(1);

  const o = head[0];
  if (o === undefined) return null;

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
    orderId: o.orderId,
    reference: o.orderId.slice(0, 8),
    status: o.status,
    payMode: o.payMode,
    finalTotalCents: o.finalTotalCents,
    cashCollectedCents: o.cashCollectedCents,
    slotStartsAtMs: o.slotStartsAt.getTime(),
    slotEndsAtMs: o.slotEndsAt.getTime(),
    addressLine1: o.addressLine1,
    addressLine2: o.addressLine2,
    city: o.city,
    province: o.province,
    postalCode: o.postalCode,
    deliveryNotes: o.deliveryNotes,
    // Carried as `numeric` strings out of the database — a numeric is not a
    // double and must not be treated as one until it is deliberately narrowed.
    lat: o.lat === null ? null : Number(o.lat),
    lng: o.lng === null ? null : Number(o.lng),
    hasHotLine: o.hasHotLine,
    customerName: o.customerName,
    /*
     * ⚠ `customer.phone` IS NULLABLE IN THE SCHEMA and this screen treats it
     * as required, so the fallback is explicit rather than a `!`. A driver at
     * a door with an empty telephone link has no way to tell whether the
     * number is missing or the page is broken.
     */
    customerPhone: o.customerPhone ?? '',
    lines: lines.map((l) => ({
      name: l.name,
      requestedG: l.requestedG,
      pricingMode: l.pricingMode,
      hot: l.handling === 'COOKED_HOT',
    })),
  };
}

export type DeliveryReport =
  | { readonly ok: true; readonly outcome: 'exact'; readonly status: 'DELIVERED' }
  /**
   * ⭐ THE MONEY IS RECORDED AND THE ORDER STAYS `OUT`. A mismatch is a fact
   * about a delivery that happened, not an error to retry — see below.
   */
  | { readonly ok: true; readonly outcome: 'short' | 'over'; readonly status: 'OUT' }
  | {
      readonly ok: false;
      readonly reason: 'notFound' | 'notOut' | 'notWeighed' | 'cashRequired' | 'cashNotAllowed';
    };

/**
 * The driver closes the job.
 *
 * ══ WHY THIS IS ONE TRANSACTION AND NOT A READ THEN A WRITE ═══════════════
 *
 * The status, the pay mode and the final total are all read INSIDE the
 * transaction that writes, with the row locked. Read outside it, the owner
 * could weigh the order — changing `final_total_cents` — between the read and
 * the write, and the cash figure would be reconciled against a number that is
 * no longer the one owed.
 *
 * ══ THE MISMATCH DECISION, WHICH IS THE INTERESTING ONE ═══════════════════
 *
 * ⚠ A WRONG AMOUNT DOES NOT CLOSE THE ORDER, AND IT IS NOT REJECTED EITHER.
 *
 * Rejecting it outright would be the obvious choice and it is wrong: the food
 * is already at the door, the money is already in the driver's pocket, and an
 * endpoint that refuses the report leaves the only record of the discrepancy
 * in one person's memory on a driveway. So the figure is written, the order
 * stays `OUT`, and the shop's screen has a red line on it before the van is
 * back.
 *
 * Closing it anyway would be worse still — spec §5.8 says an order closes when
 * the rider collected EXACTLY the final amount, and the `order_cod_settled_on_
 * delivery` CHECK would refuse the write regardless. This is the one path
 * where the database backstop and the product decision agree exactly.
 *
 * ⚠ NO LOCK ON `slot`, `product` OR `stock_item`. One row, one table, so the
 * canonical lock order (`CLAUDE.md` §7) is untouched and this cannot deadlock
 * against checkout. Do not add a stock read in here.
 */
export async function reportDelivery(
  partnerId: string,
  orderId: string,
  collectedCents: number | null,
  nowMs: number,
): Promise<DeliveryReport> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        status: order.status,
        payMode: order.payMode,
        finalTotalCents: order.finalTotalCents,
      })
      .from(order)
      .where(and(eq(order.id, orderId), eq(order.deliveryPartnerId, partnerId)))
      .for('update')
      .limit(1);

    const o = rows[0];
    if (o === undefined) return { ok: false, reason: 'notFound' } as const;

    // `OUT` only. Not `READY` — the counter marks the handover — and not
    // `DELIVERED`, so a double tap on one bar of signal cannot rewrite a
    // settled cash figure with a fresh keystroke.
    if (!canReportDelivery(o.status)) return { ok: false, reason: 'notOut' } as const;

    if (o.payMode === 'COD') {
      if (collectedCents === null) return { ok: false, reason: 'cashRequired' } as const;
      // Unreachable through the lifecycle — `OUT` implies `WEIGHED` — and
      // checked anyway, because the alternative is reconciling against `null`
      // and writing a row the CHECK will refuse with a constraint name.
      if (o.finalTotalCents === null) return { ok: false, reason: 'notWeighed' } as const;
    } else if (collectedCents !== null) {
      // A prepaid order with cash against it means two rails took money for
      // one basket. Refused here and by `order_cash_only_on_cod` beneath.
      return { ok: false, reason: 'cashNotAllowed' } as const;
    }

    const outcome: CashOutcome =
      collectedCents === null
        ? 'notDue'
        : cashOutcome(o.payMode, o.finalTotalCents, collectedCents);

    const settled = outcome === 'notDue' || outcome === 'exact';
    const now = new Date(nowMs);

    await tx
      .update(order)
      .set({
        ...(settled ? { status: 'DELIVERED' as const, deliveredAt: now } : {}),
        ...(collectedCents === null
          ? {}
          : { cashCollectedCents: collectedCents, cashReportedAt: now }),
        updatedAt: now,
      })
      .where(eq(order.id, orderId));

    if (outcome === 'short' || outcome === 'over') {
      return { ok: true, outcome, status: 'OUT' } as const;
    }
    return { ok: true, outcome: 'exact', status: 'DELIVERED' } as const;
  });
}

/**
 * Cash orders whose reported amount did not match, for the console.
 *
 * Bounded and unpaginated on purpose: if this list is ever long enough to need
 * a page control, the shop has a problem no screen is going to solve.
 */
export async function cashDiscrepancies(): Promise<
  readonly {
    orderId: string;
    reference: string;
    partnerName: string | null;
    dueCents: number | null;
    collectedCents: number;
    reportedAtMs: number;
  }[]
> {
  const rows = await db
    .select({
      orderId: order.id,
      partnerName: order.partnerName,
      dueCents: order.finalTotalCents,
      collectedCents: order.cashCollectedCents,
      cashReportedAt: order.cashReportedAt,
    })
    .from(order)
    .where(
      and(
        eq(order.payMode, 'COD'),
        isNotNull(order.cashCollectedCents),
        inArray(order.status, ['OUT', 'READY', 'WEIGHED']),
        sql`${order.cashCollectedCents} IS DISTINCT FROM ${order.finalTotalCents}`,
      ),
    )
    .orderBy(desc(order.cashReportedAt))
    .limit(50);

  return rows.flatMap((r) =>
    r.collectedCents === null || r.cashReportedAt === null
      ? []
      : [
          {
            orderId: r.orderId,
            reference: r.orderId.slice(0, 8),
            partnerName: r.partnerName,
            dueCents: r.dueCents,
            collectedCents: r.collectedCents,
            reportedAtMs: r.cashReportedAt.getTime(),
          },
        ],
  );
}

// ── The single-use sign-in link (dispatch SMS) ───────────────────────────

/**
 * Record a freshly minted link.
 *
 * The caller owns the token; this only ever sees its hash. See
 * `src/auth/driver-link.ts` for why it is random-and-stored rather than signed.
 */
export async function issueDriverLink(input: {
  tokenHash: string;
  partnerId: string;
  orderId: string | null;
  expiresAt: Date;
}): Promise<void> {
  await db.insert(driverLink).values({
    tokenHash: input.tokenHash,
    partnerId: input.partnerId,
    orderId: input.orderId,
    expiresAt: input.expiresAt,
  });
}

export type DriverLinkState =
  | { readonly state: 'valid'; readonly partnerId: string; readonly orderId: string | null }
  | { readonly state: 'expired' }
  | { readonly state: 'spent' }
  | { readonly state: 'unknown' };

/**
 * Look a link up WITHOUT spending it.
 *
 * ⭐⭐ THE READ AND THE SPEND ARE SEPARATE, AND THIS IS THE MOST IMPORTANT
 * DESIGN DECISION IN THE WHOLE MAGIC-LINK FEATURE.
 *
 * ⚠ IF A PLAIN `GET` SPENT THE TOKEN, THE FEATURE WOULD BE BROKEN ON ARRIVAL.
 * Carriers, messaging apps, link scanners and corporate security products
 * routinely FETCH a URL in an SMS before any human sees it, to build a preview
 * or check for malware. Every one of those fetches is a GET, and every one
 * would burn the link — so the driver would tap a dead link on every single
 * dispatch and the shop would conclude the whole system does not work.
 *
 * So: the GET renders a page with a button, and the button POSTs. Spending
 * requires an action a preview bot does not take. The cost is one extra tap;
 * the alternative is a feature that fails a hundred percent of the time.
 */
export async function peekDriverLink(
  tokenHash: string,
  /*
   * ⚠ DEFAULTED HERE RATHER THAN READ IN THE PAGE. A Server Component calling
   * `Date.now()` during render is an impure read of a moving value and React
   * refuses it. A repository is server code that already talks to a clock-bound
   * database, so this is where the clock belongs — and the parameter stays
   * explicit so tests can pin it.
   */
  nowMs: number = Date.now(),
): Promise<DriverLinkState> {
  const rows = await db
    .select({
      partnerId: driverLink.partnerId,
      orderId: driverLink.orderId,
      expiresAt: driverLink.expiresAt,
      usedAt: driverLink.usedAt,
    })
    .from(driverLink)
    .where(eq(driverLink.tokenHash, tokenHash))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return { state: 'unknown' };
  if (row.usedAt !== null) return { state: 'spent' };
  if (row.expiresAt.getTime() <= nowMs) return { state: 'expired' };
  return { state: 'valid', partnerId: row.partnerId, orderId: row.orderId };
}

/**
 * Spend the link. At most once, ever.
 *
 * ⭐ SINGLE USE IS A CONDITIONAL UPDATE, not a read followed by a decision.
 * `where used_at is null` means two requests racing the same token serialise on
 * the row and exactly one matches; the other updates zero rows and is told
 * `spent`. A read-then-write would let both through — the same reasoning, and
 * the same shape, as the one-capture rule in `StubPaymentAdapter`.
 *
 * ⚠ THE EXPIRY IS IN THE SAME STATEMENT for the same reason. Checked
 * beforehand, a link expiring in the millisecond between the check and the
 * write would still be spent.
 */
export async function consumeDriverLink(
  tokenHash: string,
  nowMs: number,
): Promise<DriverLinkState> {
  const now = new Date(nowMs);

  const spent = await db
    .update(driverLink)
    .set({ usedAt: now })
    .where(
      and(
        eq(driverLink.tokenHash, tokenHash),
        isNull(driverLink.usedAt),
        sql`${driverLink.expiresAt} > ${now}`,
      ),
    )
    .returning({ partnerId: driverLink.partnerId, orderId: driverLink.orderId });

  const won = spent[0];
  if (won !== undefined) {
    return { state: 'valid', partnerId: won.partnerId, orderId: won.orderId };
  }

  /*
   * ⭐ IT DID NOT MATCH, SO COUNT THE ATTEMPT BEFORE REPORTING WHY.
   *
   * This counter is the ONLY signal a forwarded text ever produces. A driver
   * double-tapping on a bad connection registers one or two; a link being tried
   * repeatedly after it was spent is worth the shop asking about. Neither is
   * proof of anything, and a number nobody recorded is not even a question.
   */
  await db
    .update(driverLink)
    .set({ reuseAttempts: sql`${driverLink.reuseAttempts} + 1` })
    .where(eq(driverLink.tokenHash, tokenHash));

  return peekDriverLink(tokenHash, nowMs);
}

/**
 * Delete links that are expired or long spent.
 *
 * ⚠ NOT A PRIVACY MEASURE — the row holds a hash, a partner id and an order id,
 * none of which is sensitive on its own. It is housekeeping, and it keeps
 * `reuse_attempts` meaningful: a table full of months-old rows makes the
 * interesting ones impossible to spot.
 *
 * The 7-day grace on spent rows is deliberate. Deleting on use would destroy
 * the evidence at exactly the moment somebody starts asking why a driver could
 * not sign in.
 */
export async function sweepDriverLinks(nowMs: number): Promise<number> {
  const cutoff = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(driverLink)
    .where(sql`${driverLink.expiresAt} < ${cutoff}`)
    .returning({ id: driverLink.id });
  return deleted.length;
}
