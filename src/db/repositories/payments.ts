import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';
import { notificationOutbox, order, orderLine, payment, stripeEvent } from '@/db/schema';
import { finalise, settlementPath, stripeKeys, type FinalisableLine } from '@/domain/settlement';
import { cents, type Cents, type OrderStatus, type PayMode } from '@/domain/types';

/**
 * Payments and webhook handling.
 *
 * ⚠ NO STRIPE CALL HAPPENS IN THIS FILE. It records what Stripe told us and
 * decides what to ask Stripe for next; the HTTP is in `src/adapters/payments`,
 * behind an interface, and is never invoked inside a transaction.
 */

// ── Webhook idempotency (DTM §8.4) ───────────────────────────────────────

export type WebhookOutcome = 'processed' | 'replay';

/**
 * ⭐ Handle a Stripe event EXACTLY ONCE, and never lose one.
 *
 * THE NAIVE VERSION LOSES EVENTS, and it looks correct:
 *
 *     INSERT the event id; if it conflicts, return 200 and stop.
 *
 * If that insert commits and the process dies before the state change — a
 * deploy, an OOM, a crash — Stripe's retry finds the id present and discards
 * it as already processed. The event is gone permanently, and the symptom is
 * an order stuck mid-settlement with no error anywhere.
 *
 * THE RULE: the insert, every local effect, every enqueued follow-up and the
 * `processed_at` stamp happen in ONE transaction. A crash anywhere rolls back
 * the insert too, so the retry is clean.
 *
 * `ON CONFLICT DO UPDATE` rather than `DO NOTHING` is deliberate: it takes the
 * row lock, so two concurrent deliveries of the same event serialise instead
 * of both deciding they are first.
 */
export async function handleStripeEvent(
  event: { id: string; type: string; payload: unknown },
  apply: (tx: Tx) => Promise<void>,
): Promise<WebhookOutcome> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(stripeEvent)
      .values({ id: event.id, type: event.type, payload: event.payload as never })
      .onConflictDoUpdate({
        target: stripeEvent.id,
        // A no-op update whose only job is to take the row lock and give us
        // back the existing `processed_at`.
        set: { attempts: sql`${stripeEvent.attempts} + 1` },
      })
      .returning({ processedAt: stripeEvent.processedAt });

    if (rows[0]?.processedAt) {
      // A genuine replay. Stop, and do not repeat the effects.
      return 'replay' as const;
    }

    // Either brand new, or a previous attempt died before stamping. Both are
    // handled the same way, which is the point of the design.
    await apply(tx);

    await tx
      .update(stripeEvent)
      .set({ processedAt: new Date(), lastError: null })
      .where(eq(stripeEvent.id, event.id));

    return 'processed' as const;
  });
}

/** Events with no `processed_at` after a while — DTM §15.3 wants an alert. */
export async function stuckEvents(olderThanMs: number): Promise<readonly { id: string; type: string }[]> {
  const cutoff = new Date(Date.now() - olderThanMs);
  return db
    .select({ id: stripeEvent.id, type: stripeEvent.type })
    .from(stripeEvent)
    .where(sql`${stripeEvent.processedAt} IS NULL AND ${stripeEvent.receivedAt} < ${cutoff}`);
}

// ── Order status, guarded ────────────────────────────────────────────────

/**
 * Apply a status transition only if the order has not already moved past it.
 *
 * ⚠ STRIPE DOES NOT GUARANTEE DELIVERY ORDER. A handler that applies a
 * transition just because an event describes it will happily walk an order
 * backwards when two events arrive out of order. Every transition therefore
 * states which statuses it may move FROM, and a mismatch is a no-op rather
 * than an error — the event describing a state already passed is information,
 * not a failure.
 */
export async function transitionOrder(
  tx: Tx,
  orderId: string,
  from: readonly OrderStatus[],
  to: OrderStatus,
  extra: Partial<{ finalTotalCents: Cents | null; cancelledAt: Date; deliveredAt: Date }> = {},
): Promise<boolean> {
  const updated = await tx
    .update(order)
    .set({ status: to, updatedAt: new Date(), ...extra })
    .where(sql`${order.id} = ${orderId} AND ${order.status} IN ${from}`)
    .returning({ id: order.id });
  return updated.length > 0;
}

// ── Finalise, written ────────────────────────────────────────────────────

export type FinaliseOutcome =
  | { ok: true; finalTotalCents: Cents; captureKey: string; captureCents: Cents | null }
  | { ok: false; reason: 'notFound' | 'notInPreparation' | 'weighingIncomplete'; unweighed?: readonly string[] };

/**
 * `Finalise` (spec §5.5) then decide the settlement path (§5.6).
 *
 * ⚠ THE CAPTURE ITSELF IS NOT DONE HERE. This computes the exact amount, marks
 * the order WEIGHED and returns the idempotency key the caller must use. The
 * Stripe call happens after the transaction commits — because you get exactly
 * ONE capture per authorisation, and a capture that succeeded inside a
 * transaction that then rolled back is money taken for an order that does not
 * exist in that state.
 */
export async function finaliseOrder(orderId: string): Promise<FinaliseOutcome> {
  return db.transaction(async (tx) => {
    const orders = await tx
      .select({
        id: order.id,
        status: order.status,
        payMode: order.payMode,
        deliveryFeeCents: order.deliveryFeeCents,
        estTotalCents: order.estTotalCents,
      })
      .from(order)
      .where(eq(order.id, orderId))
      .for('update');

    const o = orders[0];
    if (!o) return { ok: false as const, reason: 'notFound' as const };
    if (o.status !== 'PREPARING') return { ok: false as const, reason: 'notInPreparation' as const };

    const lines = await tx
      .select({
        id: orderLine.id,
        pricingMode: orderLine.pricingMode,
        estAmountCents: orderLine.estAmountCents,
        actAmountCents: orderLine.actAmountCents,
      })
      .from(orderLine)
      .where(eq(orderLine.orderId, orderId));

    const finalisable: FinalisableLine[] = lines.map((l) => ({
      lineId: l.id,
      mode: l.pricingMode,
      estAmountCents: cents(l.estAmountCents),
      actAmountCents: l.actAmountCents === null ? null : cents(l.actAmountCents),
    }));

    const result = finalise(finalisable, cents(o.deliveryFeeCents), cents(o.estTotalCents));
    if (!result.ok) {
      return { ok: false as const, reason: 'weighingIncomplete' as const, unweighed: result.unweighed };
    }

    await tx
      .update(order)
      .set({ status: 'WEIGHED', finalTotalCents: result.finalTotalCents, updatedAt: new Date() })
      .where(eq(order.id, orderId));

    const pay = await tx
      .select({ authorisedCents: payment.authorisedCents })
      .from(payment)
      .where(eq(payment.orderId, orderId));

    const captureKey = stripeKeys.capture(orderId, result.finalTotalCents);

    // Recorded BEFORE the Stripe call, so a crash between here and the capture
    // leaves a retry able to re-derive the same key rather than invent a new
    // one and capture twice.
    await tx
      .update(payment)
      .set({ captureIdempotencyKey: captureKey, updatedAt: new Date() })
      .where(eq(payment.orderId, orderId));

    const path =
      pay[0] === undefined
        ? null
        : settlementPath(o.payMode as PayMode, result.finalTotalCents, cents(pay[0].authorisedCents));

    return {
      ok: true as const,
      finalTotalCents: result.finalTotalCents,
      captureKey,
      captureCents: path?.kind === 'capture' ? path.captureCents : null,
    };
  });
}

/**
 * Record a completed capture. Idempotent: a second call with the same amount
 * is a no-op, because the webhook that reports it can arrive twice.
 */
export async function recordCapture(
  tx: Tx,
  orderId: string,
  capturedCents: Cents,
): Promise<void> {
  await tx
    .update(payment)
    .set({ status: 'CAPTURED', capturedCents, capturedAt: new Date(), updatedAt: new Date() })
    .where(sql`${payment.orderId} = ${orderId} AND ${payment.status} <> 'CAPTURED'`);
}

// ── Outbox ───────────────────────────────────────────────────────────────

/**
 * Enqueue a notification, in the caller's transaction.
 *
 * `dedupeKey` is required rather than optional. The webhook handler is
 * idempotent only if what it enqueues is too — otherwise a redelivered event
 * that correctly declines to repeat its effects still sends the customer a
 * second email.
 */
export async function enqueueNotification(
  tx: Tx,
  n: {
    channel: 'EMAIL' | 'SMS';
    kind: string;
    recipient: string;
    payload: unknown;
    orderId?: string;
    dedupeKey: string;
  },
): Promise<void> {
  await tx
    .insert(notificationOutbox)
    .values({
      channel: n.channel,
      kind: n.kind,
      recipient: n.recipient,
      payload: n.payload as never,
      orderId: n.orderId ?? null,
      dedupeKey: n.dedupeKey,
    })
    .onConflictDoNothing({ target: notificationOutbox.dedupeKey });
}
