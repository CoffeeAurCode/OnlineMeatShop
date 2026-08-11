/**
 * `Finalise` and `SettlePayment` (spec §5.5, §5.6) — the money, at the end.
 *
 * PURE. No I/O, no clock, no Stripe. See eslint.config.mjs. The gate for this
 * increment is that all of this is tested with ZERO network calls, which is
 * only possible because nothing here can make one.
 */

import { cappedTotal, DEFAULT_TOLERANCE, sumCents } from './pricing';
import { cents, delta, differenceCents, type Cents, type Delta, type PayMode } from './types';

// ── Finalise (spec §5.5) ─────────────────────────────────────────────────

export interface FinalisableLine {
  readonly lineId: string;
  readonly mode: 'pack' | 'perKg';
  readonly estAmountCents: Cents;
  /** Pack lines: equals `estAmountCents`. Per-kg lines: null until weighed. */
  readonly actAmountCents: Cents | null;
}

export type FinaliseResult =
  | {
      readonly ok: true;
      readonly finalTotalCents: Cents;
      readonly deltaCents: Delta;
      /** What the customer is charged vs what was held — for the receipt. */
      readonly actualLineTotalCents: Cents;
      readonly cappedAtCeiling: boolean;
    }
  | { readonly ok: false; readonly reason: 'weighingIncomplete'; readonly unweighed: readonly string[] };

/**
 * `final! = cappedTotal(o?)`, `delta! = final! − estTotal`.
 *
 * ⭐ THE CAP IS THE PRODUCT PROMISE, not an optimisation.
 *
 *   cappedTotal ≜ min( Σ act + fee , Σ est × (1+tol) + fee )
 *
 * Even when the cuts came in heavy, the customer pays no more than the
 * estimate plus tolerance, and the shop absorbs the rest. That is what the
 * client was told ("never more than the hold"), and it is also what makes
 * Stripe's one-capture-per-authorisation limit a non-issue: the capture can
 * never need to exceed the hold, so there is never a second capture to
 * attempt.
 *
 * The delivery fee is added on BOTH sides of the `min`, so it is never scaled
 * by the tolerance. Inflating a fixed delivery charge by 10% because the meat
 * came in heavy would be indefensible on an invoice.
 */
export function finalise(
  lines: readonly FinalisableLine[],
  deliveryFeeCents: Cents,
  estTotalCents: Cents,
  tolerance = DEFAULT_TOLERANCE,
): FinaliseResult {
  const unweighed = lines.filter((l) => l.mode === 'perKg' && l.actAmountCents === null);
  if (unweighed.length > 0) {
    return { ok: false, reason: 'weighingIncomplete', unweighed: unweighed.map((l) => l.lineId) };
  }

  // Pack lines are their own estimate (inv-O6); per-kg lines are now weighed.
  const actualLineTotal = sumCents(lines.map((l) => l.actAmountCents ?? l.estAmountCents));
  const estimatedLineTotal = sumCents(lines.map((l) => l.estAmountCents));

  const finalTotal = cappedTotal(actualLineTotal, estimatedLineTotal, deliveryFeeCents, tolerance);
  const ceiling = Math.ceil(estimatedLineTotal * (1 + tolerance)) + deliveryFeeCents;

  return {
    ok: true,
    finalTotalCents: finalTotal,
    deltaCents: differenceCents(finalTotal, estTotalCents),
    actualLineTotalCents: actualLineTotal,
    // Worth surfacing: it means the shop just absorbed the difference, and the
    // owner should know how often that happens.
    cappedAtCeiling: actualLineTotal + deliveryFeeCents > ceiling,
  };
}

// ── SettlePayment (spec §5.6) ────────────────────────────────────────────

export type SettlementPath =
  | { readonly kind: 'capture'; readonly captureCents: Cents }
  | { readonly kind: 'dueOnDelivery'; readonly amountDueCents: Cents };

/**
 * Which settlement path an order takes.
 *
 * ⚠ THE SPEC'S THREE PATHS COLLAPSE TO ONE FOR PREPAID, AND THAT IS A
 * CORRECTION RATHER THAN A SIMPLIFICATION.
 *
 * Spec §5.6 has `SettleRefund` (delta < 0) and `SettleCollect` (delta > 0) as
 * separate operations, because it was written for a rail that could only
 * charge the estimate up front and refund the difference afterwards
 * (assumption A-2, since dead). Stripe authorises a ceiling and captures an
 * exact amount, so there is nothing to refund and nothing extra to collect:
 * there is ONE capture, for `cappedTotal`, and Stripe releases the remainder
 * by itself.
 *
 * Getting this wrong in the direction of the spec would mean capturing the
 * estimate and then issuing a refund — two money movements, a fee on each, and
 * a customer watching their bank balance go the wrong way first.
 */
export function settlementPath(
  payMode: PayMode,
  finalTotalCents: Cents,
  authorisedCents: Cents,
): SettlementPath {
  if (payMode === 'COD') {
    return { kind: 'dueOnDelivery', amountDueCents: finalTotalCents };
  }

  if (finalTotalCents > authorisedCents) {
    // Unreachable if `cappedTotal` is doing its job, and that is exactly why
    // it is checked. Capturing above the authorisation is refused by Stripe at
    // settlement — long after anyone is watching — so it must fail here, loudly.
    throw new Error(
      `Refusing to capture ${finalTotalCents} against an authorisation of ${authorisedCents}. ` +
        'cappedTotal should make this impossible; if it happened, the cap is broken.',
    );
  }

  return { kind: 'capture', captureCents: finalTotalCents };
}

/** What the customer gets back relative to the hold. Only ever informational. */
export function releasedFromHold(authorisedCents: Cents, capturedCents: Cents): Cents {
  return cents(Math.max(0, authorisedCents - capturedCents));
}

// ── Stripe idempotency keys ──────────────────────────────────────────────

/**
 * The keys, derived rather than generated.
 *
 * TWO RULES, AND THE SECOND IS THE ONE THAT BITES:
 *
 *   1. Stable across retries — that is the entire point of an idempotency key.
 *   2. **They must CHANGE when the amount changes.** Stripe replays the
 *      ORIGINAL response for a reused key. A capture key that ignored the
 *      amount would silently return the old capture for a new number, and the
 *      shop would charge yesterday's total. That is a quiet, real-money bug
 *      with no error anywhere.
 *
 * Hence `quoteVersion` in the create key and `finalTotalCents` in the capture
 * key. Pure string construction, so it is testable without Stripe and cannot
 * drift between the caller and the retry.
 */
export const stripeKeys = {
  create: (attemptId: string, quoteVersion: number): string =>
    `checkout:${attemptId}:${quoteVersion}:create`,

  cancel: (attemptId: string): string => `checkout:${attemptId}:cancel`,

  capture: (orderId: string, finalTotalCents: Cents): string =>
    `settle:${orderId}:${finalTotalCents}:capture`,
} as const;

// ── Delta, for the customer-facing sentence ──────────────────────────────

/**
 * How to describe the difference between the hold and the charge.
 *
 * `delta` is negative when the final bill is BELOW the estimate, which is the
 * ordinary case and the good one. The frontend needs the sign to know whether
 * to say "we released $3.40 of your hold" or nothing at all.
 */
export function describeDelta(deltaCents: Delta): 'less' | 'same' | 'more' {
  if (deltaCents < 0) return 'less';
  if (deltaCents > 0) return 'more';
  return 'same';
}

/** The zero delta, spelled once so callers do not construct it three ways. */
export const NO_DELTA: Delta = delta(0);
