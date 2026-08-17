import 'server-only';

import { and, asc, eq, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { notificationOutbox } from '@/db/schema';
import type { NotificationSender } from '@/adapters/notifications';
import { defineJob, type Job } from '@/jobs/scheduler';

/**
 * Job handlers.
 *
 * Every one of them is INDEPENDENTLY IDEMPOTENT. The advisory lock reduces
 * duplicate work; it does not guarantee its absence — it is not held across a
 * process restart, and two instances briefly overlap during a deploy. Design
 * as if the job may run twice, because it will.
 *
 * Every one of them is also BOUNDED. The lock is held for the transaction's
 * lifetime, and a long transaction blocks vacuum, so anything unbounded
 * processes a batch per tick and returns rather than draining to empty.
 */

/** Bounded per tick. Deliberately small — a shop this size sends ~15/day. */
const OUTBOX_BATCH = 20;

/** 1min, 5min, 25min, … capped. Exponential, so a provider outage backs off. */
function backoffMs(attempts: number): number {
  return Math.min(60_000 * 5 ** Math.min(attempts, 4), 6 * 60 * 60_000);
}

/** After this many failures a notification is abandoned rather than retried. */
const MAX_ATTEMPTS = 8;

/**
 * Drain the notification outbox.
 *
 * ⚠ THE SEND HAPPENS OUTSIDE THE TRANSACTION, and that ordering is the whole
 * reason the outbox exists. Sending inside would tie the transaction's
 * duration to the provider's availability, and a send that succeeded followed
 * by a rollback tells a customer about an order that does not exist.
 *
 * So: claim a batch in one transaction, send outside, record outcomes in
 * another. The window between claim and record means a crash can re-send one
 * notification — which is why claiming marks attempts immediately, and why
 * `dedupeKey` exists upstream. Duplicate confirmation email: annoying.
 * Duplicate capture: money. The trade is deliberate and it is the right way
 * round.
 */
export function drainOutboxJob(sender: NotificationSender): Job {
  return defineJob('drain-outbox', async (tx) => {
    const due = await tx
      .select({
        id: notificationOutbox.id,
        channel: notificationOutbox.channel,
        kind: notificationOutbox.kind,
        recipient: notificationOutbox.recipient,
        payload: notificationOutbox.payload,
        attempts: notificationOutbox.attempts,
      })
      .from(notificationOutbox)
      .where(
        and(
          eq(notificationOutbox.status, 'PENDING'),
          lte(notificationOutbox.nextAttemptAt, new Date()),
        ),
      )
      .orderBy(asc(notificationOutbox.nextAttemptAt))
      .limit(OUTBOX_BATCH)
      // Skip rows another instance is already working on rather than queue
      // behind them. Without this the second instance blocks for the whole
      // batch and its tick achieves nothing.
      .for('update', { skipLocked: true });

    if (due.length === 0) return;

    // Claim first. If the process dies after sending but before recording, the
    // bumped attempt count and pushed-out `next_attempt_at` are what stop the
    // same notification being re-sent immediately and forever.
    for (const n of due) {
      await tx
        .update(notificationOutbox)
        .set({
          attempts: n.attempts + 1,
          nextAttemptAt: new Date(Date.now() + backoffMs(n.attempts + 1)),
        })
        .where(eq(notificationOutbox.id, n.id));
    }

    // The transaction commits when this callback returns; the sends below run
    // after it, on their own.
    queueMicrotask(() => {
      void deliverClaimed(sender, due);
    });
  });
}

async function deliverClaimed(
  sender: NotificationSender,
  claimed: readonly {
    id: string;
    channel: 'EMAIL' | 'SMS';
    kind: string;
    recipient: string;
    payload: unknown;
    attempts: number;
  }[],
): Promise<void> {
  for (const n of claimed) {
    try {
      const result = await sender.send({
        channel: n.channel,
        kind: n.kind,
        recipient: n.recipient,
        payload: (n.payload ?? {}) as Record<string, unknown>,
      });

      if (result.ok) {
        await db
          .update(notificationOutbox)
          .set({ status: 'SENT', sentAt: new Date(), lastError: null })
          .where(eq(notificationOutbox.id, n.id));
        continue;
      }

      // `retryable` is the distinction that matters. A malformed address will
      // never succeed and must be abandoned; a provider 503 must be retried.
      const exhausted = !result.retryable || n.attempts + 1 >= MAX_ATTEMPTS;
      await db
        .update(notificationOutbox)
        .set({ status: exhausted ? 'ABANDONED' : 'PENDING', lastError: result.error })
        .where(eq(notificationOutbox.id, n.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(notificationOutbox)
        .set({ lastError: message })
        .where(eq(notificationOutbox.id, n.id));
    }
  }
}

/**
 * Cancel PaymentIntents whose checkout attempt never became an order.
 *
 * The belt for step 6's braces (DTM §8.2): if the placement failed and the
 * cancel call also failed, this catches it. Fifteen minutes is long enough
 * that a slow checkout is not swept mid-flight and short enough that the
 * customer's pending charge disappears before they wonder about it.
 *
 * ⚠ It only marks the attempt. The Stripe cancel happens outside the
 * transaction, from the returned list — the same rule as the outbox.
 */
export function abandonStaleAttemptsJob(): Job {
  return defineJob('abandon-stale-attempts', async (tx) => {
    await tx.execute(sql`
      UPDATE checkout_attempt
         SET status = 'ABANDONED', updated_at = now()
       WHERE status = 'AUTHORISED'
         AND order_id IS NULL
         AND created_at < now() - interval '15 minutes'
    `);
  });
}

/**
 * Delete dispatch links that expired over a week ago.
 *
 * ⚠ HOUSEKEEPING, NOT A PRIVACY MEASURE. The row holds a hash, a partner id and
 * an order id — nothing sensitive on its own, and the token was never stored.
 * What it protects is the usefulness of `reuse_attempts`: a table full of
 * months-old rows makes the interesting ones impossible to spot.
 *
 * ⭐ THE SEVEN-DAY GRACE IS THE POINT. Deleting on use would destroy the
 * evidence at exactly the moment somebody starts asking why a driver could not
 * sign in, or who opened a link first.
 *
 * ⚠ NOTHING INVOKES THE SCHEDULER YET (`CLAUDE.md` §6 in the app repo), so this
 * job is written and not running. At two to six dispatches a day the table
 * grows by a few rows daily, which is harmless for a long time — but this is
 * the reason it does not clean itself today.
 */
export function sweepDriverLinksJob(): Job {
  return defineJob('sweep-driver-links', async (tx) => {
    await tx.execute(sql`
      DELETE FROM driver_link
       WHERE expires_at < now() - interval '7 days'
    `);
  });
}

/**
 * The nightly consistency check (DTM §6.2 / §15.3).
 *
 * inv-O3 spans order_line → product → slot and cannot be a CHECK constraint,
 * so it is checked here instead of hoped for. A hot line in a non-hot slot is
 * a food-safety failure, not a data inconsistency, and it warrants waking
 * someone.
 *
 * ⚠ THE JOB MUST ALSO ALERT ON NOT HAVING RUN. The scheduler dies with the
 * instance, so a silent instance failure otherwise becomes a silent monitoring
 * failure — the check that would have told you is the thing that stopped.
 * That half needs an external heartbeat and is NOT built yet.
 */
export function consistencyCheckJob(onViolation: (kind: string, ids: string[]) => void): Job {
  return defineJob('consistency-check', async (tx) => {
    const hot = await tx.execute<{ id: string }>(sql`
      SELECT o.id FROM "order" o
        JOIN slot s ON s.id = o.slot_id
       WHERE o.has_hot_line AND NOT s.hot_eligible
    `);
    const hotIds = hot.rows.map((r) => (r as { id: string }).id);
    if (hotIds.length > 0) onViolation('inv-O3', hotIds);

    const oversold = await tx.execute<{ id: string }>(sql`
      SELECT id FROM stock_item WHERE reserved_g > stocked_g
    `);
    const oversoldIds = oversold.rows.map((r) => (r as { id: string }).id);
    if (oversoldIds.length > 0) onViolation('inv-A3', oversoldIds);

    const overbooked = await tx.execute<{ id: string }>(sql`
      SELECT id FROM slot WHERE booked_count > capacity
    `);
    const overbookedIds = overbooked.rows.map((r) => (r as { id: string }).id);
    if (overbookedIds.length > 0) onViolation('inv-F4', overbookedIds);
  });
}
