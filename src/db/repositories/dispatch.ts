import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { notificationOutbox } from '@/db/schema';

/**
 * The record that a delivery partner was actually told about a job.
 *
 * ══ WHY THIS GOES THROUGH THE OUTBOX AT ALL ═══════════════════════════════
 *
 * The message is sent immediately, synchronously, from the admin request — not
 * queued and drained. So the outbox looks like ceremony. It is not:
 *
 * ⭐ WITHOUT A ROW, "DID ANYONE SEND IT TO MARC?" IS A QUESTION NOBODY CAN
 * ANSWER. The owner is on a phone in a shop and does not remember. The driver
 * says they got nothing. Twilio's own logs are a different system with a
 * different login and no order references in them. One row here makes it a
 * lookup instead of an argument.
 *
 * It also means the eventual retry path is free: `src/jobs/handlers.ts`
 * already drains PENDING rows with backoff, so a Twilio outage that leaves
 * this row PENDING becomes recoverable the moment the scheduler runs — which
 * needs the always-on instance (`CODEBASE-CONTEXT.md` §1.1) and is not
 * something to rely on today.
 *
 * ══ THE DEDUPE KEY ════════════════════════════════════════════════════════
 *
 * `dispatch:<orderId>:<partnerId>:<assignedAtMs>`
 *
 * ⚠ `assignedAtMs` IS IN THE KEY AND CARRIES THE WHOLE DESIGN. Reassigning an
 * order rewrites `assigned_at`, so the new assignment gets a NEW key and a new
 * row — the second driver is told even though the first already was. Without
 * it, `onConflictDoNothing` would silently swallow the second dispatch and
 * nobody would collect the order.
 *
 * A double-tap within one assignment, by contrast, produces the SAME key and
 * is correctly absorbed.
 */

export type DispatchRecord =
  | { readonly state: 'new'; readonly dedupeKey: string }
  | { readonly state: 'alreadySent'; readonly dedupeKey: string; readonly sentAtMs: number }
  | { readonly state: 'retry'; readonly dedupeKey: string };

export function dispatchDedupeKey(
  orderId: string,
  partnerId: string,
  assignedAtMs: number,
): string {
  return `dispatch:${orderId}:${partnerId}:${assignedAtMs}`;
}

/**
 * Claim the right to send, and say what was already true.
 *
 * ⚠ THIS IS CALLED BEFORE THE SEND AND WRITES A `PENDING` ROW. A crash between
 * here and the send leaves a PENDING row and no message, which the drain job
 * fixes. The other ordering — send first, record after — loses the record on
 * exactly the same crash, and an unrecorded sent message is the one failure
 * that cannot be reconstructed from anywhere.
 */
export async function claimDispatch(input: {
  orderId: string;
  partnerId: string;
  assignedAtMs: number;
  recipient: string;
  payload: unknown;
}): Promise<DispatchRecord> {
  const dedupeKey = dispatchDedupeKey(input.orderId, input.partnerId, input.assignedAtMs);

  const existing = await db
    .select({ status: notificationOutbox.status, sentAt: notificationOutbox.sentAt })
    .from(notificationOutbox)
    .where(eq(notificationOutbox.dedupeKey, dedupeKey))
    .limit(1);

  const row = existing[0];
  if (row !== undefined) {
    if (row.status === 'SENT' && row.sentAt !== null) {
      return { state: 'alreadySent', dedupeKey, sentAtMs: row.sentAt.getTime() };
    }
    return { state: 'retry', dedupeKey };
  }

  await db
    .insert(notificationOutbox)
    .values({
      channel: 'SMS',
      kind: 'dispatch.assigned',
      recipient: input.recipient,
      payload: input.payload as never,
      orderId: input.orderId,
      dedupeKey,
    })
    .onConflictDoNothing({ target: notificationOutbox.dedupeKey });

  return { state: 'new', dedupeKey };
}

/**
 * Mark the message as gone.
 *
 * ⚠ `sent_at` AND `status` MOVE TOGETHER, because `outbox_sent_at_iff_sent` is
 * a CHECK constraint and will refuse anything else. That constraint is the
 * reason this is one statement rather than two.
 */
export async function markDispatchSent(dedupeKey: string, providerId: string | null): Promise<void> {
  await db
    .update(notificationOutbox)
    .set({
      status: 'SENT',
      sentAt: new Date(),
      attempts: sql`${notificationOutbox.attempts} + 1`,
      lastError: providerId === null ? null : `sid=${providerId}`,
    })
    .where(eq(notificationOutbox.dedupeKey, dedupeKey));
}

/**
 * Record a failure, leaving the row PENDING so the drain job can retry it.
 *
 * Not `FAILED`: that status means "give up", and one Twilio timeout is not a
 * reason to give up on telling a driver where to go.
 */
export async function markDispatchFailed(dedupeKey: string, error: string): Promise<void> {
  await db
    .update(notificationOutbox)
    .set({
      attempts: sql`${notificationOutbox.attempts} + 1`,
      lastError: error.slice(0, 500),
      // Two minutes. Short, because this message is only useful before the
      // delivery window it describes.
      nextAttemptAt: new Date(Date.now() + 2 * 60 * 1000),
    })
    .where(eq(notificationOutbox.dedupeKey, dedupeKey));
}

/**
 * Force a re-send of an assignment that was already marked sent.
 *
 * The one case the owner actually hits: the driver deleted the text. Keeps the
 * same row — it is still the same assignment — and moves it back to PENDING so
 * `claimDispatch` will let the send through.
 */
export async function reopenDispatch(dedupeKey: string): Promise<void> {
  await db
    .update(notificationOutbox)
    .set({ status: 'PENDING', sentAt: null })
    .where(eq(notificationOutbox.dedupeKey, dedupeKey));
}
