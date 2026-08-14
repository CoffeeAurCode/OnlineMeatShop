import en from '@/../messages/en.json';
import fr from '@/../messages/fr.json';

import type { Locale } from '@/ui/format';

export type { Locale };

/**
 * UI chrome translation. Two locales, a few hundred strings, one dynamic route
 * segment.
 *
 * ⭐ NO i18n LIBRARY, DELIBERATELY. `next-intl` and friends buy message
 * extraction, ICU plurals, and a routing layer. The routing here is one
 * segment, the plural cases are counted on one hand, and the extraction step
 * would be solving a problem this project does not have. The dependency would
 * be larger than the thing it replaces.
 *
 * ══ THE DIVISION THAT MATTERS ═════════════════════════════════════════════
 *
 * ⚠ UI CHROME LIVES HERE. PRODUCT CONTENT LIVES IN THE DATABASE.
 *
 * "Add to basket" is a string a developer ships, so it belongs in a JSON file
 * under version control. "Saumon de l'Atlantique" is data the OWNER edits, so
 * it belongs in `product.name_fr`.
 *
 * Conflating the two is the standard mistake and it is expensive in one
 * specific way: it puts the catalog in a file that only a developer can
 * change, so adding a fish on a Tuesday morning needs a deploy.
 */

export const LOCALES = ['fr', 'en'] as const;

/**
 * ⚠ FRENCH IS THE DEFAULT, and this is ONE CONSTANT away from being English.
 *
 * The shop is a Montreal fishmonger and Bill 96 has real requirements for
 * commercial sites in Quebec: French must be available and at least as
 * prominent. Both locales are complete and a visitor's choice is remembered in
 * a cookie, so this only decides where a FIRST-TIME visitor lands on a bare
 * `/`.
 *
 * Flagged in `05-PLAN` §6.3 as an assumption rather than a client answer: the
 * shop sits on Sherbrooke Street West, which is a heavily anglophone part of
 * the city, so its actual trade may point the other way.
 */
export const DEFAULT_LOCALE: Locale = 'fr';

/** The cookie a chosen locale is remembered in. Read by `proxy.ts`. */
export const LOCALE_COOKIE = 'ps-locale';

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'fr';
}

/**
 * Messages are plain nested objects, and `en.json` is the SHAPE OF RECORD.
 *
 * Typing `fr.json` as `Messages` rather than inferring it separately is what
 * makes a missing French key a build error instead of a blank space on a live
 * page. It is the one thing the omitted i18n library would have given us, and
 * it costs one type annotation.
 */
export type Messages = typeof en;

const BUNDLES: Record<Locale, Messages> = { en, fr: fr as Messages };

/**
 * Dotted-path lookup: `t(locale, 'basket.addToBasket')`.
 *
 * Returns the KEY ITSELF when a string is missing, rather than an empty string
 * or the English fallback. A visible `basket.addToBasket` on the page is
 * obviously a bug and gets fixed; a silent English word on a French page looks
 * deliberate and survives to production. The typing above means this should be
 * unreachable, and it is the behaviour for the case where it is not.
 */
export function t(locale: Locale, path: string, vars?: Record<string, string | number>): string {
  const raw = lookup(BUNDLES[locale], path);
  if (raw === null) return path;
  if (vars === undefined) return raw;

  return raw.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name];
    return v === undefined ? whole : String(v);
  });
}

function lookup(bundle: Messages, path: string): string | null {
  let node: unknown = bundle;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : null;
}

/**
 * A bound `t` for one locale, so a component takes `t('x')` rather than
 * repeating the locale at every call site.
 */
export type Translator = (path: string, vars?: Record<string, string | number>) => string;

export function translator(locale: Locale): Translator {
  return (path, vars) => t(locale, path, vars);
}

/**
 * The sentence for a basket line the server refused to price.
 *
 * ⚠ A LINE WITH A PROBLEM IS PRICED BUT NOT SUMMED — `quoteBasket` leaves it
 * out of `lineSubtotalCents`. A screen that renders the amount and swallows
 * the problem therefore shows priced lines above a subtotal that does not add
 * up, which is precisely what the live basket looked like with no trading day
 * open. Lives here rather than in either component because the basket drawer
 * and the checkout summary must not word the same refusal differently.
 */
export function quoteProblemMessage(
  locale: Locale,
  problem: 'productUnavailable' | 'invalidQuantity' | 'insufficientStock',
  name: string,
): string {
  switch (problem) {
    case 'productUnavailable':
      return t(locale, 'errors.productUnavailable', { name });
    case 'invalidQuantity':
      return t(locale, 'errors.illegalQuantity');
    case 'insufficientStock':
      return t(locale, 'errors.insufficientStock', { name });
  }
}

/** The other locale. Used by the language toggle, which has exactly one job. */
export function otherLocale(locale: Locale): Locale {
  return locale === 'fr' ? 'en' : 'fr';
}

/**
 * Swap the locale segment of a path, preserving everything after it.
 *
 * Route slugs are NOT translated. `/fr/shop/lobster` and `/en/shop/lobster`
 * are the same page in two languages, which keeps the language toggle a pure
 * one-segment swap and means a shared link survives the recipient's locale
 * preference. Translating slugs would need a bidirectional route map, and
 * every mistranslation in it is a 404.
 */
export function pathForLocale(pathname: string, target: Locale): string {
  const rest = pathname.replace(/^\/(fr|en)(?=\/|$)/, '');
  return `/${target}${rest}`;
}

/** `fr` → `fr-CA`, for `hreflang` and `<html lang>`. */
export function htmlLang(locale: Locale): string {
  return locale === 'fr' ? 'fr-CA' : 'en-CA';
}
