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

// ── Money ────────────────────────────────────────────────────────────────
// Integer cents, CAD. Never a float, anywhere, ever. A float here loses
// fractions of a cent per line and the loss compounds silently.
export type Cents = number & { readonly __brand: 'Cents' };
export const cents = (n: number): Cents => {
  if (!Number.isInteger(n)) throw new Error(`Money must be integer cents, got ${n}`);
  return n as Cents;
};

// Weight is always grams. Never kilograms as a decimal — same reason.
export type Grams = number & { readonly __brand: 'Grams' };
export const grams = (n: number): Grams => {
  if (!Number.isInteger(n)) throw new Error(`Weight must be integer grams, got ${n}`);
  return n as Grams;
};

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
