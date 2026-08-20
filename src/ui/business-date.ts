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
 * `businessDateIn`, shifted by whole days on the CALENDAR.
 *
 * ⚠ NOT `now.getTime() + days * 86_400_000`. That adds a DURATION, and a
 * duration is not a day: on the night the clocks go forward, 23:30 local plus
 * twenty-four real hours formats as 00:30 two dates later, so a three-day
 * horizon silently becomes four — once a year, at night. Resolve the local date
 * first, then count in the calendar, where a day is a day by definition.
 *
 * `Date.UTC` is used purely as a calendar here: it is what rolls `2026-01-30 +
 * 3` into February and gets leap years right. No instant in it means anything.
 */
export function businessDatePlus(timeZone: string, now: Date, days: number): string {
  const today = businessDateIn(timeZone, now);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const d = Number(today.slice(8, 10));
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
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

/**
 * The same window with the DATE LEFT OFF. `14:00–16:00`.
 *
 * ⚠ ONLY EVER CORRECT WHERE THE DATE IS ALREADY ESTABLISHED, which is exactly
 * one place: the console's today panel, where four rows all belong to the day
 * named in the heading above them and repeating it four times is noise. The
 * customer-facing picker must keep `slotWindow` — see the warning on it.
 *
 * En dash rather than the word, because these sit in a column of times where
 * the shortest label that still reads as a range wins.
 */
export function slotClock(timeZone: string, startsAt: Date, endsAt: Date): string {
  const time = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${time.format(startsAt)}–${time.format(endsAt)}`;
}
