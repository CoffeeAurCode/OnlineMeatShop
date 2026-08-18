/**
 * The one place money and weight become strings.
 *
 * `04-PLAN` §7 requires a single shared money helper, and this is it. Both
 * halves of the app import from here; nothing formats a price inline.
 *
 * ⚠ NO FUNCTION HERE EVER CREATES A FLOAT. `CLAUDE.md` says integer cents,
 * everywhere, with no exceptions, and an exception made "just for display" is
 * the one that gets copied somewhere it is not just for display.
 *
 * ══ HOW THAT SURVIVES BECOMING LOCALE-AWARE ═══════════════════════════════
 *
 * This file used to hardcode `$` as a prefix and `.` as the separator. That is
 * wrong on a French page: fr-CA writes `18,40 $`, with a comma, the symbol
 * AFTER the number, and a NON-BREAKING SPACE between them. Wrong money
 * formatting on a French page does not read as a cosmetic slip, it reads as
 * broken software, and in Quebec it is the half of the site the law cares
 * most about.
 *
 * The obvious fix, `Intl.NumberFormat().format(cents / 100)`, would reintroduce
 * exactly the float this file exists to avoid. So instead:
 *
 *     integer cents  →  exact decimal STRING  →  Intl.NumberFormat
 *
 * `Intl.NumberFormat.prototype.format` accepts a string and formats it
 * exactly, with no intermediate double. This is not a hopeful reading of the
 * spec; it is measured, and the difference is visible:
 *
 *     format('12345678901234567.89')  →  $12,345,678,901,234,567.89
 *     format( 12345678901234567.89 )  →  $12,345,678,901,234,568.00
 *
 * Intl supplies the SHAPE. The integer arithmetic still supplies the VALUE.
 */

export type Locale = 'en' | 'fr';

/**
 * The two ICU locales. Both are `-CA`: `fr-FR` would render euros-shaped
 * output and put a narrow no-break space in the thousands separator, which is
 * correct in France and wrong in Montreal.
 */
const ICU: Record<Locale, string> = { en: 'en-CA', fr: 'fr-CA' };

/**
 * The console is English-only and always will be: it is one operator using a
 * tool, not a shopfront. Named rather than defaulted, so that a storefront
 * call site that forgot its locale is a type error instead of a silently
 * English price on a French page.
 */
export const ADMIN_LOCALE: Locale = 'en';

/**
 * ⚠ THE ONE CAST IN THIS FILE, AND WHY IT IS NOT A LIE.
 *
 * `Intl.NumberFormat.prototype.format` accepts a decimal string at runtime and
 * formats it exactly. TypeScript's own lib types type that parameter as
 * `StringNumericLiteral`, which is a TEMPLATE-LITERAL type: it matches string
 * *literals* that look numeric, and no value computed at runtime can ever
 * satisfy it. So the capability is real and unreachable through the types.
 *
 * The alternatives are worse. Passing a number reintroduces the float this
 * whole file exists to avoid, and it is not theoretical:
 *
 *     format('12345678901234567.89')  →  $12,345,678,901,234,567.89
 *     format( 12345678901234567.89 )  →  $12,345,678,901,234,568.00
 *
 * So: one narrowed local type, used in exactly one place, rather than an
 * `any` or a float. The string is built by `decimalString`, which validates
 * its input, so the value reaching here is always well formed.
 */
type FormatsDecimalStrings = { format(value: string): string };

/**
 * Formatters are expensive to construct and are constructed once per locale.
 * `Intl.NumberFormat` instances are immutable and safe to share.
 */
const currencyCache = new Map<Locale, Intl.NumberFormat>();

function currencyFormatter(locale: Locale): Intl.NumberFormat {
  let f = currencyCache.get(locale);
  if (f === undefined) {
    f = new Intl.NumberFormat(ICU[locale], {
      style: 'currency',
      currency: 'CAD',
      // Without this, en-CA renders `CA$` in some ICU builds. The shop trades
      // in one currency and never needs to disambiguate it from another.
      currencyDisplay: 'narrowSymbol',
    });
    currencyCache.set(locale, f);
  }
  return f;
}

/**
 * Integer cents as a bare decimal string: `1840` → `"18.40"`.
 *
 * The bridge between integer arithmetic and `Intl`, and also what JSON-LD
 * wants. `cents / 100` would be exact at these magnitudes and is still not
 * used, for the reason in this file's header: no float is created anywhere,
 * including in JSON that leaves the server. schema.org accepts a string.
 */
export function decimalString(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error(`decimalString() takes non-negative integer cents, got ${cents}`);
  }
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * `1234` → `"$12.34"` on en, `"12,34 $"` on fr.
 *
 * Negative renders with the locale's own negative form and is used only by
 * settlement, where a difference can legitimately go either way.
 */
export function money(cents: number, locale: Locale): string {
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`money() takes integer cents, got ${cents}`);
  }
  const sign = cents < 0 ? '-' : '';
  const f = currencyFormatter(locale) as unknown as FormatsDecimalStrings;
  return f.format(`${sign}${decimalString(Math.abs(cents))}`);
}

/**
 * `1250` → `"1.25 kg"` on en, `"1,25 kg"` on fr. `250` → `"250 g"`.
 *
 * The threshold is 1 kg rather than some rounder-looking number because that
 * is where the shop's own language changes: below a kilo the counter talks in
 * grams, above it in kilos. That is true in both languages.
 *
 * Built by hand rather than through `Intl` `unit` style, because the unit
 * formatter takes a quantity and would need the float this file refuses. Only
 * the decimal separator differs between the two locales, and that is one
 * character.
 */
export function weight(grams: number, locale: Locale): string {
  if (!Number.isSafeInteger(grams) || grams < 0) {
    throw new Error(`weight() takes non-negative integer grams, got ${grams}`);
  }
  if (grams < 1000) return `${grams} g`;

  const kg = Math.trunc(grams / 1000);
  const rest = grams % 1000;
  if (rest === 0) return `${kg} kg`;

  // Trailing zeros trimmed: 1500 g reads "1.5 kg", not "1.500 kg".
  const frac = String(rest).padStart(3, '0').replace(/0+$/, '');
  const point = locale === 'fr' ? ',' : '.';
  return `${kg}${point}${frac} kg`;
}

/**
 * `2500` → `"$25.00/kg"`. The per-kg rate, which is a price and not a total.
 *
 * French writes `25,00 $/kg`. The solidus needs no space in either locale;
 * the non-breaking space already sits inside the currency part on fr.
 */
export function ratePerKg(cents: number, locale: Locale): string {
  return pricePerUnit(cents, 'kg', locale);
}

/**
 * `1899`, `"pack"` → `"$18.99/pack"`. The same shape as `ratePerKg`, for the
 * unit that has to be translated.
 *
 * ⚠ A BARE AMOUNT ON A PRODUCT CARD IS A DEFECT, not a tidier layout. "$18.99"
 * against a pack of scallops and "$18.99" against a kilo of cod are the same
 * three characters and completely different offers, and the customer comparing
 * them is scanning a two-column grid on a phone. The design system says it
 * outright: `"$32.99 / kg"` or `"$18.99 / pack"`, never a bare amount.
 *
 * The unit WORD is passed in rather than looked up here. `kg` is the same in
 * both locales and needs no dictionary; `pack` is `paquet` in French, and
 * `src/ui/format.ts` is a formatter, not a second place translations live.
 */
export function pricePerUnit(cents: number, unit: string, locale: Locale): string {
  return `${money(cents, locale)}/${unit}`;
}

/**
 * Parse a kilogram figure typed by a human into exact integer grams.
 *
 * The owner thinks in kilograms ("twelve and a half of the salmon"), the
 * database stores grams, and `parseFloat("12.5") * 1000` is how a stock count
 * quietly becomes 12499. So the string is split and padded rather than
 * multiplied: no float ever exists.
 *
 * Accepts `12`, `12.5`, `12.500`, `.5`, and a comma as the decimal separator.
 * The comma is not a nicety here: it is what a Canadian French keyboard
 * produces and what every French-reading customer will type, and rejecting it
 * would look like the shop rejecting their number for no reason.
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

/**
 * Integer grams back into the kilogram string the input showed.
 *
 * Locale-aware because it fills a form field the customer then edits, and a
 * French field prefilled with `1.5` that only accepts `1,5` on the way back
 * would be a genuinely confusing bug. `gramsFromKgInput` accepts both.
 */
export function kgInputFromGrams(g: number, locale: Locale = 'en'): string {
  const kg = Math.trunc(g / 1000);
  const rest = String(g % 1000).padStart(3, '0').replace(/0+$/, '');
  if (rest === '') return String(kg);
  return `${kg}${locale === 'fr' ? ',' : '.'}${rest}`;
}
