/**
 * Phone numbers, normalised to E.164.
 *
 * PURE. No I/O, no clock. See eslint.config.mjs.
 *
 * ══ WHY THIS MOVED OUT OF THE CUSTOMER REPOSITORY ═════════════════════════
 *
 * It used to live in `src/db/repositories/customers.ts`, next to its only
 * caller. There are now three, and two of them are not customers: the OTP
 * routes normalise before asking Supabase to text a code, and the delivery
 * partner roster normalises before writing a row the database's own CHECK
 * will re-test. A rule enforced in three places has to be stated in one.
 *
 * ══ WHY IT ACCEPTS THE WHOLE WORLD NOW ════════════════════════════════════
 *
 * ⚠ THE OLD VERSION ACCEPTED CANADIAN NUMBERS AND NOTHING ELSE. Ten digits
 * became `+1…`, eleven starting with a 1 became `+…`, and every other shape
 * returned null. That was defensible while the number was an unverified
 * display field on an order — a Montreal shop delivers to Montreal people.
 *
 * It stopped being defensible the moment the number became a LOGIN. The
 * person testing this shop is not in Canada, and neither is anyone who moves
 * here with their old number still on their phone. A login that cannot express
 * the user's own number is not a strict login, it is a broken one.
 *
 * So: a leading `+` (or `00`) means the caller has already said which country,
 * and we believe them. A bare national number is interpreted against the
 * default region, which is the only place a guess is made and the only place
 * `+1` is ever invented.
 *
 * ⚠ THIS IS NOT libphonenumber AND MUST NOT PRETEND TO BE. It does not know
 * that `+1 555` is unassigned or that French mobiles start `06`/`07`. It
 * enforces the SHAPE the E.164 standard defines and that every downstream
 * consumer — Twilio, Supabase, the `partner_phone_e164` CHECK — actually
 * requires. Real per-country validation is Twilio's Lookup API, which costs a
 * network call, and the place to add it is at the boundary, not here.
 */

/** The E.164 shape, stated once. The database CHECK is this same regex. */
const E164 = /^\+[1-9][0-9]{6,14}$/;

/**
 * Where a number with no country code is assumed to be from.
 *
 * Only ever consulted for a BARE NATIONAL number. `+91…` is never reinterpreted
 * as Canadian, whatever this says.
 */
export type DefaultRegion = 'CA';

/**
 * Normalise to E.164, or return null.
 *
 * Null rather than a thrown error or a best guess: the caller always has a
 * better refusal to give than this function does, and a number stored in two
 * formats is two customers.
 */
export function normalisePhone(raw: string, region: DefaultRegion = 'CA'): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  /*
   * ⚠ THE `+` IS READ FROM THE ORIGINAL STRING, BEFORE ANYTHING IS STRIPPED.
   * `(+1) 514 555 0142` and `1 514 555 0142` are the same digits and different
   * claims — the first says "this is already international", the second is a
   * national number that happens to start with a 1. Deciding after stripping
   * loses that distinction, and it is the distinction the whole function turns
   * on.
   *
   * `00` is the ITU international prefix and means exactly what `+` means.
   */
  const digits = trimmed.replace(/\D/g, '');
  if (digits === '') return null;

  const international = trimmed.startsWith('+') || digits.startsWith('00');
  const body = international && digits.startsWith('00') ? digits.slice(2) : digits;

  if (international) return check(`+${body}`);

  // Bare national. The only branch that invents a country code.
  if (region === 'CA') {
    if (body.length === 10) return check(`+1${body}`);
    if (body.length === 11 && body.startsWith('1')) return check(`+${body}`);
    return null;
  }

  return null;
}

function check(candidate: string): string | null {
  return E164.test(candidate) ? candidate : null;
}

/** Whether a string is already in E.164. Used to trust a stored value. */
export function isE164(value: string): boolean {
  return E164.test(value);
}

/**
 * Human-readable form, for a screen the owner reads.
 *
 * ⚠ NEVER STORE THE OUTPUT OF THIS. It is display only, and feeding it back
 * into `normalisePhone` for a non-NANP number would not round-trip. The
 * database holds E.164 and nothing else.
 */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m === null ? e164 : `+1 ${m[1]} ${m[2]}-${m[3]}`;
}
