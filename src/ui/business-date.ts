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

/** A slot window, in the shop's timezone. `14:00 to 16:00`. */
export function slotWindow(timeZone: string, startsAt: Date, endsAt: Date): string {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${f.format(startsAt)} to ${f.format(endsAt)}`;
}
