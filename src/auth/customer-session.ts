import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The CUSTOMER session cookie, minted only after a real OTP check.
 *
 * `c1.<payloadB64url>.<sigB64url>`, payload `{ sub, phone, iat, exp, nonce }`.
 *
 * ══ WHY THIS EXISTS NOW, WHEN THE COMMENT IT REPLACES SAID NOT TO ═════════
 *
 * `/api/session/customer` used to return the order list for one request and
 * refuse to set any cookie, and its comment explained why in strong terms:
 *
 *     "A cookie would be a durable credential minted from an unverified claim."
 *
 * ⭐ THAT REASONING WAS CORRECT AND ITS PREMISE IS NOW FALSE. The claim is no
 * longer unverified — a code was texted to the number and typed back. The
 * whole objection was to durability on top of nothing; durability on top of a
 * proven number is just a login, and it is the thing the shop asked for.
 *
 * ══ DELIBERATELY SEPARATE FROM THE STAFF SESSION ══════════════════════════
 *
 * Different cookie name, different token version prefix, different derived
 * key. A customer token and a staff token must be mutually unforgeable even
 * though one secret is behind both:
 *
 *   - The KEY is derived from `STAFF_SESSION_SECRET` through an HMAC with a
 *     fixed, distinct label. Two derived keys from one secret, and neither can
 *     produce a signature the other verifies.
 *   - The VERSION prefix differs (`c1` vs `v1`), so even with equal keys a
 *     token from one space would be rejected by the other's parser.
 *
 * ⚠ WHY DERIVE RATHER THAN ADD `CUSTOMER_SESSION_SECRET`: a second secret is a
 * second thing to set on Render, and the failure mode of forgetting is that
 * customer login silently stops working in production while every test passes.
 * Domain separation gives the property that actually matters — the two token
 * spaces are disjoint — without a new deployment step that can be skipped.
 *
 * ══ WHAT THE COOKIE IS NOT ════════════════════════════════════════════════
 *
 * ⚠ SIGNED, NOT ENCRYPTED. The phone number is readable by anyone holding the
 * cookie. That is acceptable because the holder is the person whose number it
 * is; it is in here at all so that `/api/checkout` can insist the order's phone
 * matches the PROVEN one rather than trusting a field in the request body.
 *
 * ⚠ IT IS NOT AUTHORISATION TO SEE AN ORDER. Order tracking is still gated on
 * `order.public_token`, which is unguessable and works with no account at all.
 * This cookie answers one narrower question: which number's history to list.
 */

const VERSION = 'c1';

/**
 * 30 days. Much longer than the staff session's 12 hours, and the difference
 * is not carelessness.
 *
 * A staff token is a key to stock and money on a shared shop phone, so it
 * expires within a shift. A customer token is "this phone belongs to this
 * person", which stays true, and the cost of it expiring is that a regular
 * buying the same two fish every week has to re-do an SMS round trip to see
 * their own order — friction on the customer this shop actually lives on.
 */
export const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const CUSTOMER_SESSION_COOKIE = 'ps_customer';

export interface CustomerSessionPayload {
  /** `customer.id`. Not a permission. */
  readonly sub: string;
  /** E.164, PROVEN. The reason this is worth putting in a signed token. */
  readonly phone: string;
  readonly iat: number;
  readonly exp: number;
  readonly nonce: string;
}

/**
 * ⭐ FAIL CLOSED ON A MISSING SECRET. No default key, ever — a default signing
 * key is the same as no signing key, because it is in the repository.
 *
 * Read lazily rather than at module load so a build, which has no secrets,
 * does not fail on import.
 */
function key(): Buffer | null {
  const raw = process.env.STAFF_SESSION_SECRET;
  if (raw === undefined || raw.length < 32) return null;
  // The domain-separation label. Changing this string invalidates every issued
  // customer cookie, which is the intended way to revoke them all at once.
  return createHmac('sha256', raw).update('ps:customer-session:v1').digest();
}

export function customerSessionsConfigured(): boolean {
  return key() !== null;
}

function sign(payloadB64: string, k: Buffer): string {
  return createHmac('sha256', k).update(payloadB64).digest('base64url');
}

export function issueCustomerSession(
  customerId: string,
  phoneE164: string,
  nowMs: number,
): string | null {
  const k = key();
  if (k === null) return null;

  const payload: CustomerSessionPayload = {
    sub: customerId,
    phone: phoneE164,
    iat: nowMs,
    exp: nowMs + CUSTOMER_SESSION_TTL_MS,
    nonce: randomBytes(9).toString('base64url'),
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${VERSION}.${body}.${sign(body, k)}`;
}

export type CustomerRefusal = 'notConfigured' | 'malformed' | 'badSignature' | 'expired';

export function readCustomerSession(
  token: string | undefined,
  nowMs: number,
): { ok: true; payload: CustomerSessionPayload } | { ok: false; reason: CustomerRefusal } {
  const k = key();
  if (k === null) return { ok: false, reason: 'notConfigured' };
  if (token === undefined || token === '') return { ok: false, reason: 'malformed' };

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, reason: 'malformed' };
  const [, body, presented] = parts as [string, string, string];

  /*
   * ⚠ THE SIGNATURE IS CHECKED BEFORE THE PAYLOAD IS PARSED. Reversing these
   * means feeding attacker-controlled bytes to `JSON.parse` and then deciding
   * whether to trust them. Same rule as the staff session, stated again
   * because this is the file somebody will copy from next.
   */
  const expected = Buffer.from(sign(body, k), 'utf8');
  const got = Buffer.from(presented, 'utf8');
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return { ok: false, reason: 'badSignature' };
  }

  let payload: CustomerSessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CustomerSessionPayload;
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

/**
 * The cookie attributes, in one place so no route can set a weaker set.
 *
 * `secure` is off outside production only because the dev server is plain
 * HTTP; it is on everywhere the cookie could actually be intercepted.
 */
export function customerCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
