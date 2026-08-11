/**
 * Tax — per line, on actual weight, from an explicit code.
 *
 * PURE. No I/O, no clock. See eslint.config.mjs.
 *
 * ⚠ THE RATES AND THE MAPPING ARE BLOCKED ON THE CLIENT'S ACCOUNTANT (DQ-2).
 * This file is the mechanism, and the mechanism is correct under any answer.
 * Nothing here hard-codes a rate: the table is passed in, so filling it in
 * later is configuration rather than a code change. Do not invent rates — an
 * invented tax rate is the kind of wrong that is discovered by the CRA.
 *
 * DTM §10. Three rules that hold whatever the accountant says:
 *
 *   1. `tax_code` is an explicit column on `product`, NEVER derived from
 *      `handling`. The same cooked chicken is taxed differently sold hot
 *      versus chilled, so a derived code is a bug waiting for its first edge
 *      case.
 *   2. Tax is computed PER LINE, not per order. One basket legitimately mixes
 *      zero-rated raw meat and taxable hot food; an order-level rate cannot
 *      represent that.
 *   3. Tax on per-kg lines is computed at `Finalise`, on ACTUAL weight — not
 *      at `PlaceOrder`. The estimate carries an estimated tax; the final total
 *      carries the real one.
 */

import { cents, type Cents } from './types';

/**
 * Basis points — hundredths of a percent. 5% GST is `500`.
 *
 * An integer, not a float, for the same reason money is: `0.05` is not
 * representable and a rate that is almost 5% produces a tax that is almost
 * right, on every line, forever.
 */
export type BasisPoints = number & { readonly __brand: 'BasisPoints' };

export const basisPoints = (n: number): BasisPoints => {
  if (!Number.isSafeInteger(n) || n < 0 || n > 10_000) {
    throw new Error(`Tax rate must be 0..10000 basis points, got ${n}`);
  }
  return n as BasisPoints;
};

/** `tax_code` → rate. Supplied by configuration, never hard-coded here. */
export type TaxTable = ReadonlyMap<string, BasisPoints>;

export interface LineTax {
  readonly taxCode: string;
  readonly rateBasisPoints: BasisPoints;
  readonly taxCents: Cents;
}

/**
 * Tax on one line amount.
 *
 * ROUNDS HALF UP, per line, and this is a decision rather than a default.
 * Canadian practice is to compute tax on the invoice total per rate, but
 * storing the per-line breakdown is what makes a receipt reconstructable
 * years later (DTM §10) — so the rounding has to happen somewhere, and doing
 * it per line and summing is the version whose printed lines add up to the
 * printed total. A customer who adds up the column and gets a different number
 * than the total has found a bug, whatever the accounting literature says.
 *
 * ⚠ If the accountant's answer requires order-level rounding instead, change
 * it HERE and nowhere else, and expect the per-line breakdown to stop summing
 * exactly — which then needs a decision about what the receipt shows.
 */
export function lineTax(amountCents: Cents, taxCode: string, table: TaxTable): LineTax {
  const rate = table.get(taxCode);
  if (rate === undefined) {
    // Refusing is the only safe answer. A missing code silently treated as
    // zero-rated undercharges tax on every sale of that product, and the
    // shortfall is the shop's to pay.
    throw new Error(
      `No tax rate configured for code "${taxCode}". ` +
        'Rates come from configuration (DQ-2); a missing one must not default to zero.',
    );
  }

  // Exact integer arithmetic. `amount × rate` is at most ~1e4 × 1e9, well
  // inside safe-integer range for any real order.
  const scaled = amountCents * rate;
  const remainder = scaled % 10_000;
  const quotient = (scaled - remainder) / 10_000;
  const rounded = remainder * 2 >= 10_000 ? quotient + 1 : quotient;

  return { taxCode, rateBasisPoints: rate, taxCents: cents(rounded) };
}

/** Total tax across lines. Sums the per-line rounded amounts, deliberately. */
export function totalTax(lines: readonly LineTax[]): Cents {
  return cents(lines.reduce<number>((sum, l) => sum + l.taxCents, 0));
}

/**
 * The tax breakdown grouped by rate, which is what a receipt actually prints —
 * "GST 5% ... $1.20" rather than one line per item.
 */
export function taxByRate(lines: readonly LineTax[]): ReadonlyMap<BasisPoints, Cents> {
  const out = new Map<BasisPoints, Cents>();
  for (const l of lines) {
    out.set(l.rateBasisPoints, cents((out.get(l.rateBasisPoints) ?? 0) + l.taxCents));
  }
  return out;
}
