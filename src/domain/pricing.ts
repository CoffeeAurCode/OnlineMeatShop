/**
 * Pricing — the catalog invariants and the one place money is rounded.
 *
 * PURE. No I/O, no clock. See eslint.config.mjs.
 *
 * Spec §4 (Catalog, inv-C1 / inv-C2) and §5; DTM §6.3.
 */

import { cents, type Cents, type Grams, type Pricing } from './types';

// ── Catalog invariants (spec §4) ─────────────────────────────────────────

/**
 * inv-C1 — a pack product must have a sane weight range and a real price.
 *
 *   pack(price, wMin, wMax) ⇒ 0 < wMin ≤ wMax ∧ price > 0
 *
 * `wMin ≤ wMax`, not `<`: a pack with an exact declared weight is legitimate
 * (a 500 g tray that is always 500 g), and the spec permits equality.
 */
export function isValidPackPricing(price: Cents, wMin: Grams, wMax: Grams): boolean {
  return price > 0 && wMin > 0 && wMin <= wMax;
}

/**
 * inv-C2 — a per-kg product must have a positive rate, a positive step, and a
 * minimum order of at least one step.
 *
 *   perKg(rate, minQ, step) ⇒ rate > 0 ∧ step > 0 ∧ minQ ≥ step
 *
 * `minOrder ≥ step` is what makes the minimum orderable: if the minimum were
 * below one step, no legal quantity would satisfy both constraints at once and
 * the product could never be bought — a catalog that type-checks and cannot
 * sell anything.
 */
export function isValidPerKgPricing(ratePerKg: Cents, minOrder: Grams, step: Grams): boolean {
  return ratePerKg > 0 && step > 0 && minOrder >= step;
}

/** inv-C1 ∧ inv-C2 over whichever mode this product uses. */
export function isValidPricing(p: Pricing): boolean {
  return p.mode === 'pack'
    ? isValidPackPricing(p.price, p.wMin, p.wMax)
    : isValidPerKgPricing(p.ratePerKg, p.minOrder, p.step);
}

// ── Quantities ───────────────────────────────────────────────────────────

/**
 * P5 — is this a quantity the customer may actually order?
 *
 * A per-kg quantity must be at least `minOrder` and an exact multiple of
 * `step`. The butcher cuts in steps; a 437 g request is not a cut they can
 * make, and accepting it produces an order that cannot be fulfilled as
 * ordered.
 *
 * Pack lines have no weight to validate — the customer buys a unit, and the
 * declared range is the shop's promise about that unit, not an input.
 */
export function isLegalQuantity(p: Pricing, requested: Grams): boolean {
  if (p.mode === 'pack') return true;
  return requested >= p.minOrder && requested % p.step === 0;
}

// ── Line estimate — the only rounding in the system ──────────────────────

/**
 * `lineEst(p, w) ≜ pack ? packPrice : ⌈ratePerKg × grams / 1000⌉`
 *
 * Rounds **UP**, always, and in this one function. Spec §5; DTM §6.3.
 *
 * Rounding up rather than to nearest is deliberate and is not about revenue:
 * it guarantees the quoted estimate is never below what the exact arithmetic
 * gives, so the authorised ceiling always covers the real amount. A
 * round-to-nearest here could quote a cent under, and the capture would then
 * exceed what the customer authorised — which Stripe refuses, at settlement,
 * long after anyone is watching.
 *
 * WHY THE ARITHMETIC LOOKS LIKE THIS
 * ----------------------------------
 * The obvious spelling is `Math.ceil(rate * g / 1000)`, and the obvious
 * suspicion is that float division breaks it somewhere. It does not. That was
 * checked rather than assumed, and the result is worth writing down so nobody
 * "simplifies" this on the strength of the same suspicion:
 *
 *   - every `rate × g` pair with rate ≤ 20000 and g ≤ 30000: no disagreement
 *   - 3M random pairs up to rate 1e9 × g 1e6: no disagreement
 *   - the worst case by construction, n = 1000k + 1 near 2^53: no disagreement
 *
 * The reason is a narrow one. A wrong answer needs the rounded quotient to
 * fall on or below the integer beneath it. A non-multiple of 1000 sits at
 * least 0.001 above that integer, while half an ulp at the top of the
 * safe-integer range (quotients near 9e12) is about 0.000976. So the naive
 * form survives — by a margin of roughly 2%, and only because `Number`
 * division rounds to nearest.
 *
 * That margin is not a thing to build money on. The form below is exact by
 * construction instead of by an argument about ulp sizes: `n % 1000` is exact
 * for any safe integer, `n - r` is then an exact multiple of 1000, so
 * `(n - r) / 1000` is exact in floating point, and the ceiling is a question
 * about the remainder rather than about the quotient. It also fails loudly
 * rather than quietly if `n` ever leaves safe-integer range, which is the
 * case the 2% margin does not cover at all.
 */
export function lineEst(p: Pricing, requested: Grams): Cents {
  if (p.mode === 'pack') return p.price;

  const n = p.ratePerKg * requested;
  if (!Number.isSafeInteger(n)) {
    // Cannot happen with real catalog values; if it ever does, the result
    // would be silently wrong rather than obviously wrong.
    throw new Error(`Line estimate overflowed safe integer range: ${p.ratePerKg} × ${requested}`);
  }

  const remainder = n % 1000;
  const exactQuotient = (n - remainder) / 1000;
  return cents(remainder === 0 ? exactQuotient : exactQuotient + 1);
}

// ── The tolerance band and the capped total ──────────────────────────────

/**
 * Default weight tolerance, ±10%. Spec §5.4.
 *
 * A number, not `Cents`: it is a ratio, and giving it a money brand would be
 * a category error that the type system would then help enforce.
 */
export const DEFAULT_TOLERANCE = 0.1;

/**
 * The ceiling authorised on the customer's card: the estimate plus tolerance.
 *
 * Rounds up for the same reason `lineEst` does — the hold must cover every
 * amount the capture could legitimately be.
 */
export function authorisationCeiling(estTotal: Cents, tolerance = DEFAULT_TOLERANCE): Cents {
  return cents(Math.ceil(estTotal * (1 + tolerance)));
}

/**
 * `cappedTotal(o) ≜ min( Σ actAmount + fee , Σ estAmount × (1+tol) + fee )`
 *
 * The customer is charged the real weighed amount, unless that exceeds the
 * tolerance ceiling they agreed to, in which case they are charged the
 * ceiling and the shop absorbs the difference.
 *
 * This is the rule that makes Stripe's one-capture-per-authorisation
 * limitation a non-issue: the capture can never need to exceed the hold, so
 * there is never a second capture to attempt.
 *
 * Note the fee is added on BOTH sides, so it is never scaled by the
 * tolerance. Delivery is a fixed charge; inflating it by 10% because the meat
 * came in heavy would be indefensible on an invoice.
 */
export function cappedTotal(
  actualLineTotal: Cents,
  estimatedLineTotal: Cents,
  deliveryFee: Cents,
  tolerance = DEFAULT_TOLERANCE,
): Cents {
  const ceiling = Math.ceil(estimatedLineTotal * (1 + tolerance));
  return cents(Math.min(actualLineTotal, ceiling) + deliveryFee);
}

/**
 * `inBand(l) ≜ reqWeight × (1−tol) ≤ actWeight ≤ reqWeight × (1+tol)`
 *
 * Whether a weighed line landed inside the agreed tolerance. Outside it, the
 * spec requires the variance to be approved rather than silently charged.
 */
export function inBand(requested: Grams, actual: Grams, tolerance = DEFAULT_TOLERANCE): boolean {
  return actual >= requested * (1 - tolerance) && actual <= requested * (1 + tolerance);
}

/** Total estimate across lines. Kept here so no caller re-sums with floats. */
export function sumCents(values: readonly Cents[]): Cents {
  return cents(values.reduce<number>((a, b) => a + b, 0));
}
