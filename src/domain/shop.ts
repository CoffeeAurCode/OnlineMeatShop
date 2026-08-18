/**
 * The shop's own identity: where it is, when it is open, and where it delivers.
 *
 * PURE. No I/O, no clock. See eslint.config.mjs.
 *
 * ══ WHY THIS IS DATA AND NOT CONFIGURATION ════════════════════════════════
 *
 * ⭐ EVERY VALUE HERE USED TO BE AN ENVIRONMENT VARIABLE, and every one of
 * them was wrong for that. `SHOP_STREET` and friends were read by nothing at
 * all, and the one that WAS read — the delivery towns — could only be changed
 * by a person with access to a hosting dashboard. A shop's opening hours
 * change on a Tuesday because a supplier is late. That is not a deployment.
 *
 * The values now live in `shop_setting` and are edited at `/admin/shop`. The
 * only things left in the environment are the ones a BUILD needs before any
 * database exists: the site's own origin, and the shop's name.
 *
 * ⚠ THIS MODULE HOLDS THE SHAPE AND THE RULES, NOT THE VALUES. It is imported
 * by the storefront, the console and the settings repository, so it must stay
 * free of both React and the database.
 */

import { formatPostalCode } from './serviceability';

// ── Shape ────────────────────────────────────────────────────────────────

/**
 * Days, in the order a week is worked rather than the order it is numbered.
 *
 * ⚠ MONDAY FIRST, AND `sun` LAST. The fishmonger's week starts Tuesday and the
 * console renders these in array order, so the array IS the display order.
 * Sorting it by `Date.getDay()` would put Sunday at the top, above the days
 * that actually matter to somebody setting hours at 6am.
 */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/**
 * One day's trading hours.
 *
 * ⭐ CLOSED IS `opens === null`, NOT `'00:00'` TO `'00:00'`. A closed day and a
 * day open for zero minutes are the same thing to a clock and completely
 * different things to a customer reading a footer, to `schema.org`, and to the
 * owner scanning the screen for the day they forgot to set.
 */
export interface DayHours {
  readonly day: Weekday;
  /** `HH:MM`, 24-hour, shop-local. Null when the shop is closed that day. */
  readonly opens: string | null;
  readonly closes: string | null;
}

/** A town with its own `/delivery/[town]` page. */
export interface DeliveryTown {
  readonly slug: string;
  readonly name: string;
}

export interface ShopIdentity {
  readonly street: string;
  readonly locality: string;
  readonly region: string;
  /** Normalised: uppercase, no space. Formatted for display on the way out. */
  readonly postalCode: string;
  /** E.164, or empty. The number CUSTOMERS see, never a driver's. */
  readonly phone: string;
  readonly hours: readonly DayHours[];
  readonly towns: readonly DeliveryTown[];
}

/**
 * What an unconfigured shop looks like.
 *
 * ⭐ EMPTY, NOT PLAUSIBLE. Every consumer of this must render nothing rather
 * than render a placeholder, because a placeholder address in a footer is a
 * wrong address in a footer and nobody ever notices it. The console's own
 * screen is where the gap is meant to be visible.
 */
export const EMPTY_IDENTITY: ShopIdentity = {
  street: '',
  locality: '',
  region: '',
  postalCode: '',
  phone: '',
  hours: [],
  towns: [],
};

/**
 * The provinces and territories, by code.
 *
 * ⚠ STATED ONCE, HERE. The console renders it as a picker and the route
 * refuses anything outside it; two copies of a closed list is two lists, and
 * the one that drifts is always the validator. `QU` is not a province and
 * `Quebec` is not a code, and both would pass any check looser than this.
 *
 * The names are English only, deliberately: this list is read by the OWNER's
 * console, which is English, and never by a customer. The storefront shows the
 * code, which is the same in both languages.
 */
export const PROVINCES = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
} as const;

export type ProvinceCode = keyof typeof PROVINCES;

/** '' is allowed and means "not set yet", which is not the same as wrong. */
export function isProvinceCode(value: string): boolean {
  return value === '' || value in PROVINCES;
}

// ── Towns ────────────────────────────────────────────────────────────────

/**
 * A URL slug for a town name.
 *
 * ⚠ ACCENTS ARE FOLDED, NOT DROPPED. The shop is in Montreal and half its
 * neighbours are spelled with one: `Montréal` has to become `montreal` and not
 * `montr-al`, because the second is both ugly and a different URL from the one
 * anybody would type. `normalize('NFD')` splits the accent off the letter and
 * the combining-mark range then removes it.
 *
 * Returns '' for a name with nothing slug-able in it, which the caller must
 * treat as a refusal — an empty slug would collide with the parent route.
 */
export function townSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Towns, de-duplicated by slug and in the order they were given.
 *
 * ⚠ THE SLUG IS THE IDENTITY, NOT THE NAME. `Saint-Laurent` and
 * `saint laurent` are one town and one page; keeping both would mean two URLs
 * serving identical content, which is the doorway-page problem the delivery
 * pages already have to be careful about.
 */
export function normaliseTowns(names: readonly string[]): DeliveryTown[] {
  const out: DeliveryTown[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ');
    const slug = townSlug(name);
    if (name === '' || slug === '' || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, name });
  }
  return out;
}

// ── Address ──────────────────────────────────────────────────────────────

/**
 * True once there is enough of an address to be worth showing anybody.
 *
 * The street alone is not an address and neither is the town alone. Both, plus
 * something to put on an envelope, is the bar — below it every consumer
 * renders nothing at all.
 */
export function hasAddress(identity: ShopIdentity): boolean {
  return identity.street !== '' && identity.locality !== '';
}

/**
 * The address as display lines, in Canada Post order, skipping what is blank.
 *
 * Returns [] when there is no address, so a caller can render the whole block
 * or none of it with one check.
 */
export function addressLines(identity: ShopIdentity): string[] {
  if (!hasAddress(identity)) return [];
  const cityLine = [identity.locality, identity.region].filter((p) => p !== '').join(', ');
  const postal = identity.postalCode === '' ? '' : formatPostalCode(identity.postalCode);
  return [identity.street, [cityLine, postal].filter((p) => p !== '').join('  ')].filter(
    (line) => line.trim() !== '',
  );
}

// ── Hours ────────────────────────────────────────────────────────────────

/** Every day closed. The shape the console edits before anybody has saved. */
export function blankHours(): DayHours[] {
  return WEEKDAYS.map((day) => ({ day, opens: null, closes: null }));
}

/**
 * `HH:MM`, 24-hour. Rejects `9:00`, `24:00` and `09:60`.
 *
 * Deliberately strict where the postal-code validator is deliberately loose:
 * this value is not typed by a customer at a checkout, it is picked from a
 * native time control by one person, and a malformed one silently breaks the
 * `schema.org` block rather than showing anybody an error.
 */
export function isTimeOfDay(value: string): boolean {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

/**
 * The seven days in display order, with anything missing filled in as closed.
 *
 * ⚠ THE STORED VALUE IS NOT TRUSTED TO BE COMPLETE OR ORDERED. It is written
 * by a form today and could be written by a script tomorrow; a footer that
 * renders whatever order the rows arrived in is a footer that reorders itself
 * for no visible reason.
 */
export function weekOf(hours: readonly DayHours[]): DayHours[] {
  return WEEKDAYS.map((day) => {
    const found = hours.find((h) => h.day === day);
    if (found === undefined || found.opens === null || found.closes === null) {
      return { day, opens: null, closes: null };
    }
    return found;
  });
}

/**
 * Consecutive days with identical hours, collapsed into one row.
 *
 * ⭐ THIS IS WHY THE FOOTER IS READABLE. Seven lines saying the same thing is
 * not opening hours, it is a table nobody reads; `Tue to Sat 09:00-19:00` is
 * the sentence a person would actually say. Closed days break a run rather
 * than joining one, so a shop shut on Wednesday reads as two runs and not as
 * one wrong one.
 */
export function groupHours(
  hours: readonly DayHours[],
): { readonly from: Weekday; readonly to: Weekday; readonly opens: string; readonly closes: string }[] {
  const out: { from: Weekday; to: Weekday; opens: string; closes: string }[] = [];

  for (const day of weekOf(hours)) {
    if (day.opens === null || day.closes === null) continue;
    const last = out[out.length - 1];
    const contiguous =
      last !== undefined &&
      last.opens === day.opens &&
      last.closes === day.closes &&
      WEEKDAYS.indexOf(day.day) === WEEKDAYS.indexOf(last.to) + 1;

    if (contiguous) last.to = day.day;
    else out.push({ from: day.day, to: day.day, opens: day.opens, closes: day.closes });
  }

  return out;
}

/**
 * `schema.org` `OpeningHoursSpecification` entries for the `Store` node.
 *
 * ⚠ `dayOfWeek` TAKES THE FULL ENGLISH NAME AND A SCHEMA.ORG URL PREFIX IS NOT
 * REQUIRED, but the CASE is: `Tuesday`, never `tuesday` or `TUE`. Google's
 * structured-data parser drops the whole specification on an unrecognised day
 * rather than reporting it, so a lower-cased name loses the hours silently and
 * the rich result simply never appears.
 */
const SCHEMA_DAY: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export function openingHoursSpecification(
  hours: readonly DayHours[],
): { '@type': 'OpeningHoursSpecification'; dayOfWeek: string[]; opens: string; closes: string }[] {
  return groupHours(hours).map((run) => {
    const from = WEEKDAYS.indexOf(run.from);
    const to = WEEKDAYS.indexOf(run.to);
    return {
      '@type': 'OpeningHoursSpecification' as const,
      dayOfWeek: WEEKDAYS.slice(from, to + 1).map((d) => SCHEMA_DAY[d]),
      opens: run.opens,
      closes: run.closes,
    };
  });
}
