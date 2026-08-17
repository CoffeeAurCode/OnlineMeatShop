import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The DELIVERY PARTNER's session cookie, minted only after a real OTP check
 * against a number that is on the active roster.
 *
 * `d1.<payloadB64url>.<sigB64url>`, payload `{ sub, phone, iat, exp, nonce }`.
 *
 * ══ WHY A LOGIN AT ALL, WHEN `07-PLAN` SAID A LINK ════════════════════════
 *
 * Part 7 designed a tokenised job sheet — one unguessable URL per order, no
 * account — and argued the case well: an account is a credential, a reset flow
 * and a support burden for somebody who needs to know one address at a time.
 *
 * ⭐ THAT ARGUMENT DIED ON A CHANGE OF REQUIREMENT, NOT ON A CHANGE OF MIND.
 * The client asked for a screen showing ALL of a driver's jobs and their
 * statuses. A per-order token cannot express "all of them" — it names one
 * order by construction — so the credential has to identify the PERSON. Once
 * it does, it is a login, and the only remaining question is which one.
 *
 * ══ WHY THE PHONE, AND NOT A PASSWORD ═════════════════════════════════════
 *
 * The number is already on the roster, already E.164-normalised, already the
 * thing the dispatch SMS goes to, and the OTP round trip is already built and
 * measured. A password would add a reset flow — the exact burden Part 7 was
 * right to refuse — for a worse credential.
 *
 * ⭐ AND REVOCATION COMES FREE AND CORRECT: `delivery_partner.active` is
 * re-read from the database on every driver request (`src/app/driver-guard.ts`),
 * so taking somebody off the roster locks them out on their next tap. The
 * cookie is an identity claim, never a permission — same rule as the staff
 * session, which re-checks `staff.active` for the same reason.
 *
 * ══ DELIBERATELY SEPARATE FROM BOTH OTHER SESSIONS ════════════════════════
 *
 * Third cookie name, third version prefix, third derived key, one secret
 * behind all of them. A driver token, a customer token and a staff token must
 * be mutually unforgeable:
 *
 *   - The KEY is derived from `STAFF_SESSION_SECRET` through an HMAC with a
 *     distinct label, so no derived key can produce a signature another
 *     verifies.
 *   - The VERSION prefix differs (`d1` vs `c1` vs `v1`), so even with equal
 *     keys a token from one space is rejected by another's parser.
 *
 * ⚠ SIGNED, NOT ENCRYPTED — the phone number is readable by whoever holds the
 * cookie, which is the person whose number it is.
 */

const VERSION = 'd1';

/**
 * 30 days, matching the customer session rather than the staff session's 12
 * hours, and the difference is deliberate.
 *
 * A staff token opens stock and money on a shared shop phone and should die
 * within a shift. A driver token opens THIS DRIVER's own jobs and nothing
 * else — no prices, no other driver's work, no console. The cost of expiring
 * it nightly is a worker standing in a van at 7am waiting for an SMS, which is
 * friction on exactly the moment the tool exists to smooth. Revocation is
 * handled by the roster, which is immediate and does not depend on a clock.
 */
export const DRIVER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const DRIVER_SESSION_COOKIE = 'ps_driver';

export interface DriverSessionPayload {
  /** `delivery_partner.id`. An identity, NOT a permission — see the header. */
  readonly sub: string;
  /** E.164, proven by the OTP round trip. */
  readonly phone: string;
  readonly iat: number;
  readonly exp: number;
  readonly nonce: string;
}

/**
 * ⭐ FAIL CLOSED ON A MISSING SECRET. No default key, ever — a default signing
 * key is the same as no signing key, because it is in a public repository.
 *
 * Read lazily rather than at module load, so a build (which has no secrets)
 * does not fail on import.
 */
function key(): Buffer | null {
  const raw = process.env.STAFF_SESSION_SECRET;
  if (raw === undefined || raw.length < 32) return null;
  // The domain-separation label. Changing this string invalidates every issued
  // driver cookie, which is the intended way to revoke them all at once.
  return createHmac('sha256', raw).update('ps:driver-session:v1').digest();
}

export function driverSessionsConfigured(): boolean {
  return key() !== null;
}

function sign(payloadB64: string, k: Buffer): string {
  return createHmac('sha256', k).update(payloadB64).digest('base64url');
}

export function issueDriverSession(
  partnerId: string,
  phoneE164: string,
  nowMs: number,
): string | null {
  const k = key();
  if (k === null) return null;

  const payload: DriverSessionPayload = {
    sub: partnerId,
    phone: phoneE164,
    iat: nowMs,
    exp: nowMs + DRIVER_SESSION_TTL_MS,
    nonce: randomBytes(9).toString('base64url'),
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${VERSION}.${body}.${sign(body, k)}`;
}

export type DriverRefusal = 'notConfigured' | 'malformed' | 'badSignature' | 'expired';

export function readDriverSession(
  token: string | undefined,
  nowMs: number,
): { ok: true; payload: DriverSessionPayload } | { ok: false; reason: DriverRefusal } {
  const k = key();
  if (k === null) return { ok: false, reason: 'notConfigured' };
  if (token === undefined || token === '') return { ok: false, reason: 'malformed' };

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, reason: 'malformed' };
  const [, body, presented] = parts as [string, string, string];

  /*
   * ⚠ THE SIGNATURE IS CHECKED BEFORE THE PAYLOAD IS PARSED. Reversing these
   * means feeding attacker-controlled bytes to `JSON.parse` and then deciding
   * whether to trust them. Stated again here rather than cross-referenced,
   * because this is a file somebody will copy from next.
   */
  const expected = Buffer.from(sign(body, k), 'utf8');
  const got = Buffer.from(presented, 'utf8');
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return { ok: false, reason: 'badSignature' };
  }

  let payload: DriverSessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as DriverSessionPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (
    typeof payload.sub !== 'string' ||
    payload.sub === '' ||
    typeof payload.phone !== 'string' ||
    payload.phone === '' ||
    typeof payload.exp !== 'number' ||
    typeof payload.iat !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.exp <= nowMs) return { ok: false, reason: 'expired' };

  return { ok: true, payload };
}

/** The cookie attributes, in one place so no route can set a weaker set. */
export function driverCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
