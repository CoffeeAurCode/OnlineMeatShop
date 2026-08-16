/**
 * Order lifecycle — which status transitions are legal.
 *
 * PURE. No I/O, no clock. See eslint.config.mjs.
 *
 * Spec §4 (STATUS, inv-O4, inv-O5), §5.7 (CancelOrder), §5.8 (Deliver).
 *
 * ⚠ THIS IS NOT THE PAYMENT STATE MACHINE. `order.status` and
 * `payment.status` are separate, joined by an ID, and neither is derived from
 * the other (DTM §8.3). There is no `PAID` here on purpose: an order can be
 * READY while its capture is pending, and a capture can succeed against an
 * order cancelled a second earlier. Both are real, and a single column cannot
 * express either.
 */

import type { OrderStatus } from './types';

/**
 * The legal moves. Anything not listed is refused.
 *
 * An allowlist rather than a list of forbidden moves, for the same reason the
 * domain import boundary is: you cannot enumerate every wrong transition, but
 * the right ones are few and can be written down.
 */
const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  // Cancellable only here. Once the butcher starts cutting, the meat is
  // committed (spec §5.7) — partial cancellation of uncut lines is v2.
  PLACED: ['PREPARING', 'CANCELLED'],

  // WEIGHED is reached through Finalise, which requires every per-kg line
  // weighed. It is not reachable by a status change alone.
  PREPARING: ['WEIGHED'],

  WEIGHED: ['READY'],
  READY: ['OUT'],
  OUT: ['DELIVERED'],

  // Terminal.
  DELIVERED: [],
  CANCELLED: [],
};

/**
 * The happy path, in order, for anything that has to DISPLAY progress.
 *
 * Derived by hand rather than walked from `TRANSITIONS`, because a graph walk
 * would have to pick a branch at `PLACED` and the answer it needs is "the
 * sequence a customer expects to see", not "a valid path". `CANCELLED` is
 * deliberately absent: it is not a point on the line, it is the line ending,
 * and a timeline that renders it as a seventh step implies every order passes
 * through it.
 */
export const LIFECYCLE_ORDER = [
  'PLACED',
  'PREPARING',
  'WEIGHED',
  'READY',
  'OUT',
  'DELIVERED',
] as const satisfies readonly OrderStatus[];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Spec §5.7 — cancellation is free while merely PLACED, and refused after. */
export function canCancel(status: OrderStatus): boolean {
  return status === 'PLACED';
}

/**
 * inv-O5 — a final total exists exactly in these statuses.
 *
 * Stated here as well as in the CHECK constraint so the application can give a
 * useful error instead of surfacing a constraint violation.
 */
export function requiresFinalTotal(status: OrderStatus): boolean {
  return status === 'WEIGHED' || status === 'READY' || status === 'OUT' || status === 'DELIVERED';
}

/**
 * inv-O4 — an order cannot reach READY until every per-kg line is weighed.
 *
 * There is no predicate for this because the transition graph already enforces
 * it: READY is reachable only from WEIGHED, and WEIGHED is reachable only
 * through `Finalise`, which refuses while any per-kg line is unweighed. A
 * function here would be a second, weaker statement of the same rule.
 *
 * Written down rather than left implicit, because the property depends on
 * TRANSITIONS not gaining a shortcut into READY. The lifecycle tests assert
 * that it has not.
 */

/**
 * Spec §5.8 — an order closes only when it is prepaid, or the rider has
 * collected exactly the final amount.
 *
 * Exactly. Not "at least": a rider who collects more has taken money the
 * customer did not agree to, and one who collects less has a shortfall
 * somebody must account for. Both need to be caught at the door.
 */
export function canDeliver(
  status: OrderStatus,
  payMode: 'PREPAID' | 'COD',
  finalTotalCents: number | null,
  cashCollectedCents: number | null,
): boolean {
  if (status !== 'OUT') return false;
  if (payMode === 'PREPAID') return true;
  return finalTotalCents !== null && cashCollectedCents === finalTotalCents;
}

// ── Delivery assignment (07-PLAN Part 3) ─────────────────────────────────

/**
 * Whether a delivery partner may be attached to, or changed on, an order.
 *
 * Anything that is not finished. Assigning early is harmless — the owner
 * often knows who is driving before the fish is cut — and reassigning is the
 * normal correction when somebody calls in sick.
 *
 * ⚠ REASSIGNMENT CLEARS `dispatched_at`, and that rule lives in the
 * repository rather than here because it is a write, not a predicate. The
 * reason is worth stating anyway: the NEW partner has not been told, and an
 * order that still looks dispatched is one nobody sends a second message
 * about.
 */
export function canAssignPartner(status: OrderStatus): boolean {
  return status !== 'DELIVERED' && status !== 'CANCELLED';
}

/**
 * ⭐ AN ORDER CANNOT GO OUT WITH NOBODY CARRYING IT.
 *
 * `07-PLAN` §3.2. Stated as a pure predicate, beside `canDeliver`, and called
 * by the status route — rather than written inline in that route — for the
 * same reason every other rule in this file is: a check that lives in a route
 * handler is a check the next route handler does not have.
 *
 * The failure it prevents is not hypothetical. `OUT` is what starts the
 * customer's "on its way" message. An order that reaches it unassigned tells
 * a customer their food is moving while it is sitting on the counter, and the
 * shop finds out when they ring.
 */
export function requiresAssignment(to: OrderStatus): boolean {
  return to === 'OUT';
}

/**
 * The full move test: the graph, plus the assignment rule.
 *
 * Deliberately a separate function rather than extra parameters on
 * `canTransition`. `canTransition` answers a question about the STATUS GRAPH
 * and is used by screens that render "what can happen next"; this one answers
 * whether this PARTICULAR order may move right now. Merging them would force
 * every caller of the first to know about partners.
 */
export function canAdvance(
  from: OrderStatus,
  to: OrderStatus,
  hasAssignment: boolean,
): boolean {
  if (!canTransition(from, to)) return false;
  if (requiresAssignment(to) && !hasAssignment) return false;
  return true;
}

// ── Notifications (FR-24) ────────────────────────────────────────────────

/**
 * Which notifications a transition produces.
 *
 * ⚠ EMAIL ONLY AT LAUNCH (D18). SMS is cut — Canadian A2P registration is
 * weeks of carrier paperwork and was the likeliest cause of a launch delay.
 * The channel stays a parameter of the outbox so adding SMS later is a new
 * adapter rather than a redesign.
 *
 * The dedupe key is derived from the order and the kind, so a webhook
 * redelivery that correctly declines to repeat its effects also declines to
 * send a second email.
 */
export interface PlannedNotification {
  readonly kind: string;
  readonly channel: 'EMAIL' | 'SMS';
  readonly dedupeKey: string;
}

export function notificationsFor(orderId: string, to: OrderStatus): readonly PlannedNotification[] {
  const email = (kind: string): PlannedNotification => ({
    kind,
    channel: 'EMAIL',
    dedupeKey: `${kind}:${orderId}`,
  });

  switch (to) {
    // The itemised estimate plus the hold sentence — the one that carries the
    // client-facing promise.
    case 'PLACED':
      return [email('order.accepted')];
    // The number that actually matters to the customer.
    case 'WEIGHED':
      return [email('order.weighed')];
    case 'DELIVERED':
      return [email('order.delivered')];
    case 'CANCELLED':
      return [email('order.cancelled')];
    // Deliberately silent. "We started preparing your order" is a
    // notification nobody wants, and every unwanted one costs attention on
    // the ones that matter.
    default:
      return [];
  }
}
