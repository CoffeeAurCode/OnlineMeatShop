/**
 * Availability — today's stock, and what is already committed against it.
 *
 * PURE. No I/O, no clock. See eslint.config.mjs.
 *
 * Spec §4 (Availability, inv-A1…inv-A3) and §5.1 (OpenBusinessDay).
 */

import { grams, type Grams } from './types';

// ── The derived quantity everything else is built on ─────────────────────

/**
 * `available(p) ≜ stocked(p) − reserved(p)`, and `0` for an unstocked product.
 *
 * Clamped at zero rather than allowed to go negative. A negative availability
 * is not a meaningful quantity — it is evidence that `inv-A3` was violated —
 * and returning one here would let a caller "have" negative stock and produce
 * arithmetic that looks fine. The database CHECK is what actually prevents the
 * state; this clamp only makes sure a corrupt row cannot be quietly consumed.
 */
export function available(stocked: Grams, reserved: Grams): Grams {
  return grams(Math.max(0, stocked - reserved));
}

/** Nothing left to sell today. The storefront's sold-out state. */
export function isSoldOut(stocked: Grams, reserved: Grams): boolean {
  return available(stocked, reserved) === 0;
}

// ── inv-A3, as a predicate ───────────────────────────────────────────────

/**
 * `inv-A3: reserved(p) ≤ stocked(p)`.
 *
 * Stated as a function so the property tests can quantify over it directly,
 * rather than restating the inequality and testing their own restatement.
 */
export function holdsInvA3(stocked: Grams, reserved: Grams): boolean {
  return reserved >= 0 && reserved <= stocked;
}

/**
 * Can this much more be committed without breaking `inv-A3`?
 *
 * `demand` is the AGGREGATE for one product across every line of the basket,
 * never a single line's weight. Duplicate product lines are the normal case
 * here — prep options deliberately do not create separate products — so
 * asking this question per line permits 1 kg + 1 kg against 1.5 kg of stock.
 * See `demandByProduct`.
 */
export function canReserve(stocked: Grams, reserved: Grams, demand: Grams): boolean {
  return demand <= available(stocked, reserved);
}

/**
 * The reservation itself. Throws rather than clamping if it would breach
 * `inv-A3`: a caller that has not checked `canReserve` first has a bug, and
 * silently reserving less than asked would turn that bug into an order that
 * claims stock it does not have.
 */
export function reserve(stocked: Grams, reserved: Grams, demand: Grams): Grams {
  const next = reserved + demand;
  if (next > stocked) {
    throw new Error(
      `Reserving ${demand}g would breach inv-A3: ${reserved}g reserved of ${stocked}g stocked`,
    );
  }
  return grams(next);
}

/**
 * Releasing a reservation — cancellation returns stock to the pool (spec §5.7).
 *
 * Floors at zero and does not throw. Asymmetric with `reserve` on purpose:
 * over-reserving sells meat that does not exist, while over-releasing merely
 * makes stock available that already was. Refusing to release is the worse
 * failure — it would strand stock for the rest of the trading day.
 */
export function release(reserved: Grams, demand: Grams): Grams {
  return grams(Math.max(0, reserved - demand));
}

// ── Demand aggregation ───────────────────────────────────────────────────

/** Just enough of a line for the stock question. */
export interface DemandLine {
  readonly productId: string;
  readonly requestedG: Grams;
}

/**
 * ⭐ Total requested weight **per product**, aggregated across lines.
 *
 * This function exists because the obvious alternative — checking each line
 * against availability as you walk the basket — oversells, and does so on an
 * ordinary order rather than a contrived one.
 *
 * `FR-4` gives per-kg products customer-selectable cut preferences, and those
 * preferences deliberately do **not** create separate products. So "1 kg curry
 * cut + 1 kg biryani cut" is one product on two lines. Against 1.5 kg of
 * stock, per-line checking sees 1 ≤ 1.5 twice and accepts; aggregation sees
 * 2 > 1.5 and refuses. The second is correct.
 *
 * A `Map` rather than an object literal so product IDs cannot collide with
 * `Object.prototype` keys.
 */
export function demandByProduct(lines: readonly DemandLine[]): ReadonlyMap<string, Grams> {
  const totals = new Map<string, Grams>();
  for (const line of lines) {
    const running = totals.get(line.productId) ?? grams(0);
    totals.set(line.productId, grams(running + line.requestedG));
  }
  return totals;
}

// ── OpenBusinessDay (spec §5.1) ──────────────────────────────────────────

/**
 * `pre: d? > businessDate` — a new trading day must be strictly later than
 * the current one.
 *
 * Strictly, so re-opening today is refused as well as opening the past.
 * Re-opening would reset `reserved` to empty (the spec's `reserved' = ∅`)
 * while orders placed earlier today still hold that stock — every one of them
 * would become unfunded at once, invisibly. Refusing is the only safe answer;
 * correcting a day's quantities is a different operation (adjust stock), not
 * a re-open.
 *
 * `current` is `null` when no day has ever been opened, which any date may
 * follow.
 *
 * Dates are ISO `YYYY-MM-DD` strings in the SHOP'S timezone, already resolved
 * by the caller. The domain does not read a clock and does not know what
 * "today" is — see CLAUDE.md.
 */
export function canOpenBusinessDay(current: string | null, requested: string): boolean {
  if (!isIsoDate(requested)) return false;
  if (current === null) return true;
  // ISO dates are lexicographically ordered, which is the whole reason to
  // carry them as strings rather than parsing to a Date the domain must not
  // construct from a clock.
  return requested > current;
}

/** `YYYY-MM-DD`, and a real calendar date — `2026-02-31` is refused. */
export function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) return 29;
  return lengths[month - 1] ?? 0;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * `pre: dom stock? ⊆ dom products` — every declared quantity names a product
 * that exists. Caller supplies the catalog's product IDs; this stays pure.
 */
export function declaredStockIsInCatalog(
  declared: readonly string[],
  catalogProductIds: ReadonlySet<string>,
): boolean {
  return declared.every((id) => catalogProductIds.has(id));
}
