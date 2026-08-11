/**
 * The one place money and weight become strings.
 *
 * `04-PLAN` §7 requires a single shared money helper, and this is it. Both
 * halves of the app import from here; nothing formats a price inline.
 *
 * ⚠ Neither function divides by 100 to get a float first, even though the
 * result would be exact at these magnitudes. `CLAUDE.md` says integer cents,
 * everywhere, with no exceptions — and an exception made "just for display"
 * is the one that gets copied into a place where it is not just for display.
 * Both formatters build their string from integer arithmetic only.
 */

const GROUP = /\B(?=(\d{3})+(?!\d))/g;

/** `1234` → `"$12.34"`. Negative renders as `-$12.34`, used only by settlement. */
export function money(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`money() takes integer cents, got ${cents}`);
  }
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = String(Math.trunc(abs / 100)).replace(GROUP, ',');
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}$${dollars}.${rest}`;
}

/**
 * `1250` → `"1.25 kg"`, `250` → `"250 g"`.
 *
 * The threshold is 1 kg rather than some rounder-looking number because that
 * is where the shop's own language changes: below a kilo the counter talks in
 * grams, above it in kilos.
 */
export function weight(grams: number): string {
  if (!Number.isSafeInteger(grams) || grams < 0) {
    throw new Error(`weight() takes non-negative integer grams, got ${grams}`);
  }
  if (grams < 1000) return `${grams} g`;

  const kg = Math.trunc(grams / 1000);
  const rest = grams % 1000;
  if (rest === 0) return `${kg} kg`;

  // Trailing zeros trimmed: 1500 g reads "1.5 kg", not "1.500 kg".
  const frac = String(rest).padStart(3, '0').replace(/0+$/, '');
  return `${kg}.${frac} kg`;
}

/** `2500` → `"$25.00/kg"`. The per-kg rate, which is a price and not a total. */
export function ratePerKg(cents: number): string {
  return `${money(cents)}/kg`;
}

/**
 * Parse a kilogram figure typed by a human into exact integer grams.
 *
 * The owner thinks in kilograms ("twelve and a half of the chicken"), the
 * database stores grams, and `parseFloat("12.5") * 1000` is how a stock count
 * quietly becomes 12499. So the string is split and padded rather than
 * multiplied: no float ever exists.
 *
 * Accepts `12`, `12.5`, `12.500`, `.5`, and a comma as the decimal separator,
 * because a Canadian French keyboard produces one and the owner will not know
 * why the shop rejected their number.
 */
export function gramsFromKgInput(raw: string): number | null {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '') return null;
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '.') return null;

  const [whole = '', frac = ''] = trimmed.split('.');
  // More than three decimals is finer than a gram: refuse rather than round,
  // so a typo of 1.2555 is a question rather than a silent 1256 g.
  if (frac.length > 3) return null;

  const kg = whole === '' ? 0 : Number(whole);
  const g = frac === '' ? 0 : Number(frac.padEnd(3, '0'));
  if (!Number.isSafeInteger(kg) || !Number.isSafeInteger(g)) return null;

  return kg * 1000 + g;
}

/** Integer grams back into the kilogram string the input showed. */
export function kgInputFromGrams(g: number): string {
  const kg = Math.trunc(g / 1000);
  const rest = String(g % 1000).padStart(3, '0').replace(/0+$/, '');
  return rest === '' ? String(kg) : `${kg}.${rest}`;
}

/**
 * Integer cents as a bare decimal string: `1840` → `"18.40"`.
 *
 * For JSON-LD and anywhere else that wants a number without a currency symbol.
 * `cents / 100` would be exact at these magnitudes and is still not used, for
 * the reason in this file's header: no float is created anywhere, including in
 * JSON that leaves the server. schema.org accepts a string here.
 */
export function decimalString(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error(`decimalString() takes non-negative integer cents, got ${cents}`);
  }
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
