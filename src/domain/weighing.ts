/**
 * `RecordActualWeight` (spec §5.4) — what the meat actually weighed.
 *
 * PURE. No I/O, no clock. See eslint.config.mjs.
 *
 * This is the operation the whole "billed on actual weight" promise rests on,
 * and it is also the one where a mistake is a butcher unilaterally selling
 * someone 30% more meat than they asked for.
 */

import { inBand, lineEst, DEFAULT_TOLERANCE } from './pricing';
import { cents, type Cents, type Grams, type OrderStatus, type Pricing } from './types';

export type WeighingFailure =
  | 'orderNotInPreparation'
  | 'packLineNotWeighable'
  | 'varianceApprovalRequired'
  | 'lineNotFound';

export interface WeighableLine {
  readonly lineId: string;
  readonly pricing: Pricing;
  readonly requestedG: Grams;
  readonly actWeightG: Grams | null;
  /** Set once a customer has explicitly accepted an out-of-band weight. */
  readonly varianceApproved: boolean;
}

export type WeighingResult =
  | { readonly ok: true; readonly actWeightG: Grams; readonly actAmountCents: Cents }
  | {
      readonly ok: false;
      readonly reason: WeighingFailure;
      readonly detail?: {
        readonly lowerG?: number;
        readonly upperG?: number;
        readonly requestedG?: number;
      };
    };

/**
 * Record a weight against one line.
 *
 * THE TOLERANCE BAND IS NOT A ROUNDING ALLOWANCE. It is the boundary between
 * "this is the cut you asked for, near enough" and "this is a different
 * purchase and the customer has to agree to it". Outside ±10% the operation is
 * REFUSED — it does not clamp, does not record, and does not charge. The
 * butcher cannot unilaterally decide the customer is buying 30% more meat.
 *
 * Once the customer has approved the variance, `varianceApproved` lets the
 * same weight through. That is the only way out of the band, and it requires a
 * human on the other end saying yes.
 */
export function recordActualWeight(
  orderStatus: OrderStatus,
  line: WeighableLine,
  weighedG: Grams,
  tolerance = DEFAULT_TOLERANCE,
): WeighingResult {
  // Spec: `pre: orders(o?).status = PREPARING`. Weighing a PLACED order means
  // the butcher has not started; weighing a WEIGHED one means re-weighing
  // after the final total was computed, which would silently invalidate it.
  if (orderStatus !== 'PREPARING') {
    return { ok: false, reason: 'orderNotInPreparation' };
  }

  // inv-O6 — a pack line's estimate IS its actual. There is nothing to weigh:
  // the customer bought a unit at a fixed price, and recording a weight
  // against it would imply the price could move.
  if (line.pricing.mode === 'pack') {
    return { ok: false, reason: 'packLineNotWeighable' };
  }

  if (!line.varianceApproved && !inBand(line.requestedG, weighedG, tolerance)) {
    return {
      ok: false,
      reason: 'varianceApprovalRequired',
      detail: {
        requestedG: line.requestedG,
        lowerG: Math.ceil(line.requestedG * (1 - tolerance)),
        upperG: Math.floor(line.requestedG * (1 + tolerance)),
      },
    };
  }

  // The same rounding rule as the estimate, from the same function. Two
  // spellings of "price this weight" is how an estimate and a final bill end
  // up one cent apart for no reason anybody can explain.
  return { ok: true, actWeightG: weighedG, actAmountCents: lineEst(line.pricing, weighedG) };
}

/**
 * The band, for display. The admin console shows it BEFORE the butcher weighs,
 * so an out-of-band cut is caught at the scale rather than at settlement.
 */
export function toleranceBand(
  requestedG: Grams,
  tolerance = DEFAULT_TOLERANCE,
): { readonly lowerG: number; readonly upperG: number } {
  return {
    lowerG: Math.ceil(requestedG * (1 - tolerance)),
    upperG: Math.floor(requestedG * (1 + tolerance)),
  };
}

/**
 * `Finalise` precondition — every per-kg line has been weighed.
 *
 * Pack lines are excluded because they are never weighed at all. An
 * implementation that required a weight on every line would deadlock any order
 * containing a pack item.
 */
export function allPerKgLinesWeighed(lines: readonly WeighableLine[]): boolean {
  return lines.every((l) => l.pricing.mode === 'pack' || l.actWeightG !== null);
}

/** Which lines are still holding up `Finalise`. Drives the admin's task list. */
export function unweighedLineIds(lines: readonly WeighableLine[]): readonly string[] {
  return lines.filter((l) => l.pricing.mode === 'perKg' && l.actWeightG === null).map((l) => l.lineId);
}

/**
 * A pack line's actual amount, which is its estimate. Stated as a function so
 * that `Finalise` can treat both modes uniformly without a caller
 * re-implementing inv-O6 and getting it subtly wrong.
 */
export function packLineActualAmount(pricing: Pricing): Cents {
  if (pricing.mode !== 'pack') throw new Error('packLineActualAmount called on a perKg line');
  return cents(pricing.price);
}
