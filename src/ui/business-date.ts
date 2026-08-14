/**
 * Today, as the shop reckons it.
 *
 * A trading day is a wall-clock concept in the shop's own timezone, not a UTC
 * instant — `business_day.business_date` is a `date` for exactly that reason.
 * At 6am local the UTC date may already be tomorrow, and a console that opened
 * the wrong day would put the morning's stock against a date the storefront is
 * not selling from.
 *
 * `en-CA` gives `YYYY-MM-DD` directly, which is the format the column wants.
 */
export function businessDateIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The configured shop timezone.
 *
 * Falls back to `America/Toronto` rather than to the host's zone: a server in
 * Ohio silently reckoning days in its own timezone is a bug that only shows up
 * near midnight, and only sometimes.
 */
export function shopTimeZone(): string {
  const tz = process.env.SHOP_TIMEZONE;
  return tz === undefined || tz === '' ? 'America/Toronto' : tz;
}

/**
 * A slot window, in the shop's timezone. `Sat 15 Aug, 14:00 to 16:00`.
 *
 * ⚠ THE DATE IS PART OF THE LABEL, not decoration. The picker lists every slot
 * from today onwards (DTM §19 DQ-9 caps that at three days out), so with four
 * windows a day the customer otherwise chooses between four rows all reading
 * `12:00 to 14:00` and finds out which day they picked when the fish arrives.
 * The same label is the one shown back to them on the tracking page.
 *
 * The joiner is translated because this label is customer-facing on both
 * locales; the console passes no locale and gets English.
 */
export function slotWindow(
  timeZone: string,
  startsAt: Date,
  endsAt: Date,
  locale: 'en' | 'fr' = 'en',
): string {
  const tag = locale === 'fr' ? 'fr-CA' : 'en-CA';
  const day = new Intl.DateTimeFormat(tag, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = new Intl.DateTimeFormat(tag, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const joiner = locale === 'fr' ? 'à' : 'to';
  return `${day.format(startsAt)}, ${time.format(startsAt)} ${joiner} ${time.format(endsAt)}`;
}
