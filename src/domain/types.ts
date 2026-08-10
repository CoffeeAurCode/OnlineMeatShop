/**
 * The formal state model, as TypeScript.
 *
 * PURE. This file — and everything else in src/domain — imports nothing that
 * performs I/O. No framework, no database, no network, no clock. Enforced by
 * eslint.config.mjs; see CLAUDE.md for why.
 *
 * Increment 1 fills in the catalog and pricing rules. This file currently
 * carries only the vocabulary, so that the shape is agreed before the logic
 * is written.
 */

// ── Money and weight ─────────────────────────────────────────────────────
//
// The formal model defines MONEY and GRAMS as ℕ — natural numbers. So these
// constructors reject negatives, not merely non-integers.
//
// `Number.isSafeInteger` rather than `Number.isInteger`, because beyond 2^53
// integers stop being distinguishable: 2**53 === 2**53 + 1 is true. A price
// that large is nonsense in a butcher's shop, but a corrupt import or a bad
// migration can produce one, and it would then compare equal to its own
// neighbour and silently pass arithmetic checks. Reject it at the boundary
// rather than reasoning about it later.
//
// NaN and Infinity fail both predicates, so they are covered too.

const assertNatural = (n: number, unit: string): void => {
  if (!Number.isSafeInteger(n)) {
    throw new Error(`${unit} must be a safe integer, got ${n}`);
  }
  if (n < 0) {
    throw new Error(`${unit} must not be negative, got ${n}. For signed differences use Delta.`);
  }
};

/** Integer cents, CAD, non-negative. Never a float — floats lose money. */
export type Cents = number & { readonly __brand: 'Cents' };
export const cents = (n: number): Cents => {
  assertNatural(n, 'Money (cents)');
  return n as Cents;
};

/** Integer grams, non-negative. Never kilograms as a decimal — same reason. */
export type Grams = number & { readonly __brand: 'Grams' };
export const grams = (n: number): Grams => {
  assertNatural(n, 'Weight (grams)');
  return n as Grams;
};

/**
 * A signed money difference — spec §5.5 defines `delta! : ℤ`.
 *
 * Deliberately a separate type rather than relaxing `Cents` to allow
 * negatives. Settlement is the one place a negative amount is meaningful
 * (we owe the customer money); everywhere else — a price, a line amount, a
 * total, a delivery fee — a negative value is a defect, and keeping `Cents`
 * non-negative is what makes that defect impossible to express.
 */
export type Delta = number & { readonly __brand: 'Delta' };
export const delta = (n: number): Delta => {
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Delta must be a safe integer, got ${n}`);
  }
  return n as Delta;
};

/** final − estimate. Negative means we owe the customer. */
export const differenceCents = (final: Cents, estimate: Cents): Delta =>
  delta(final - estimate);

// ── Enumerations (spec §4) ───────────────────────────────────────────────

/**
 * Handling class. Drives shelf life and slot eligibility.
 *
 * NOTE: this is NOT a tax code. Canadian tax treatment of raw vs prepared vs
 * hot food does not map cleanly onto these four values — the same cooked item
 * can be taxed differently sold hot versus chilled. Products carry an explicit
 * tax code of their own.
 */
export type Handling = 'RAW' | 'MARINATED' | 'COOKED_CHILLED' | 'COOKED_HOT';

/** Order lifecycle. Distinct from, and never derived from, payment status. */
export type OrderStatus =
  | 'PLACED'
  | 'PREPARING'
  | 'WEIGHED'
  | 'READY'
  | 'OUT'
  | 'DELIVERED'
  | 'CANCELLED';

export type PayMode = 'PREPAID' | 'COD';

/**
 * Pricing mode. Exactly one per product.
 *
 * `pack`  — fixed price for a declared weight range. The estimate IS the
 *           actual; pack lines are never re-priced.
 * `perKg` — cut to order, billed on actual weight after weighing.
 */
export type Pricing =
  | { readonly mode: 'pack'; readonly price: Cents; readonly wMin: Grams; readonly wMax: Grams }
  | {
      readonly mode: 'perKg';
      readonly ratePerKg: Cents;
      readonly minOrder: Grams;
      readonly step: Grams;
    };

/** Why a placement was refused. Each maps to a precondition. */
export type PlacementFailure =
  | 'outsideDeliveryArea'
  | 'slotCutoffPassed'
  | 'slotFull'
  | 'productUnavailable'
  | 'invalidQuantity'
  | 'insufficientStock'
  | 'hotFoodNotAllowedInSlot'
  | 'priceChanged'
  | 'checkoutAttemptNotOpen';
