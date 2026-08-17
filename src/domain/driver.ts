/**
 * What the delivery partner sees, and what they are allowed to say.
 *
 * PURE. No I/O, no clock, no database. See eslint.config.mjs.
 *
 * `07-PLAN` Part 7, as amended by the client on 2026-08-17: the partner gets a
 * LIST of their own jobs rather than one tokenised page per order, they sign
 * in with the number already on the roster, and they close an order at the
 * door. The counter still marks the handover (`OUT`) — that decision was made
 * explicitly and the shape of `driverStage` depends on it.
 *
 * ══ WHY THE SIX-STATUS GRAPH IS COLLAPSED TO FOUR HERE ════════════════════
 *
 * ⭐ THE DRIVER DOES NOT CARE THAT `WEIGHED` EXISTS.
 *
 * `PLACED`, `PREPARING` and `WEIGHED` are three different facts about a piece
 * of fish on a counter, and every one of them means the same thing to somebody
 * holding a set of van keys: not yet. Showing them separately would be showing
 * the shop's internal bookkeeping to the one person who cannot act on it.
 *
 * The mapping deliberately does NOT live in the driver's page component. A
 * label computed in a view is a label the next view computes differently, and
 * "ready for pickup" appearing one step early is a driver standing in a shop
 * waiting for a box that is still being weighed.
 */

import type { OrderStatus, PayMode } from './types';

/**
 * The four things a job can be, from the van.
 *
 * `cancelled` is included and `PLACED`-through-`WEIGHED` are not distinguished
 * — the asymmetry is the point. A cancelled job must be visibly cancelled or
 * somebody drives to it; an unweighed job is just "not yet".
 */
export type DriverStage = 'preparing' | 'readyForPickup' | 'onTheWay' | 'delivered' | 'cancelled';

export function driverStage(status: OrderStatus): DriverStage {
  switch (status) {
    case 'PLACED':
    case 'PREPARING':
    case 'WEIGHED':
      return 'preparing';
    case 'READY':
      return 'readyForPickup';
    case 'OUT':
      return 'onTheWay';
    case 'DELIVERED':
      return 'delivered';
    case 'CANCELLED':
      return 'cancelled';
  }
}

/**
 * Whether a job still needs the driver to do something.
 *
 * Drives the sort and the "N jobs left" count, so it is one predicate rather
 * than a filter written out at each call site.
 */
export function isOpenJob(status: OrderStatus): boolean {
  const stage = driverStage(status);
  return stage !== 'delivered' && stage !== 'cancelled';
}

/**
 * ⭐ WHAT THE DRIVER MUST COLLECT AT THE DOOR, IN CENTS. `null` means nothing.
 *
 * ⚠ IT IS THE FINAL TOTAL, NEVER THE ESTIMATE. The estimate is what the
 * customer was quoted before the fish was cut; the final total is what the
 * scale produced. Collecting the estimate on a per-kg order is collecting the
 * wrong number by design, and it would be wrong in the shop's favour about
 * half the time, which is the half that generates a complaint.
 *
 * `null` for an unweighed cash order is therefore correct and load-bearing:
 * there is genuinely no amount yet, and a screen that showed the estimate
 * "for now" would be showing a figure somebody is about to take.
 */
export function amountDueAtDoor(
  payMode: PayMode,
  finalTotalCents: number | null,
): number | null {
  if (payMode !== 'COD') return null;
  return finalTotalCents;
}

/**
 * How a reported cash figure compares with what was owed.
 *
 * ⚠ `exact` IS THE ONLY OUTCOME THAT MAY CLOSE THE ORDER. Spec §5.8 says
 * exactly, not at least, and both directions are real problems:
 *
 *   - `short`  — the shop is owed money and nobody knows unless it is recorded
 *                on the day, while the driver still remembers the door.
 *   - `over`   — the customer was charged more than they agreed to. This is
 *                the worse one and it is the one an "at least" check would
 *                wave straight through.
 *
 * A mismatch is deliberately NOT an error to retry. It is a fact about a
 * delivery that happened, and the right destination for it is the shop's
 * screen, not an exception the driver has to argue with at a doorstep.
 */
export type CashOutcome = 'notDue' | 'exact' | 'short' | 'over';

export function cashOutcome(
  payMode: PayMode,
  finalTotalCents: number | null,
  collectedCents: number,
): CashOutcome {
  const due = amountDueAtDoor(payMode, finalTotalCents);
  if (due === null) return 'notDue';
  if (collectedCents === due) return 'exact';
  return collectedCents < due ? 'short' : 'over';
}

/**
 * Whether the driver may report on this job at all.
 *
 * Only `OUT`. Not `READY` — the counter marks the handover, so an order the
 * driver has not yet been given cannot be delivered by them; and not
 * `DELIVERED`, so a second tap on a slow connection is refused rather than
 * rewriting a settled cash figure.
 *
 * ⭐ THE SECOND TAP IS THE CASE THIS EXISTS FOR. A driver on one bar of signal
 * taps twice. The first tap wins and the second must not silently overwrite
 * `cash_collected_cents` with a fresh keystroke, because the two figures could
 * differ and the later one would win on nothing but timing.
 */
export function canReportDelivery(status: OrderStatus): boolean {
  return status === 'OUT';
}
