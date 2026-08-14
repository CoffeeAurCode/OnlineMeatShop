import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The staff session cookie: an HMAC-signed, self-describing token.
 *
 * `v1.<payloadB64url>.<sigB64url>` where the payload is
 * `{ sub, iat, exp, nonce }`.
 *
 * ⚠ SIGNED, NOT ENCRYPTED. Anyone holding the cookie can read the staff id and
 * the timestamps out of it. That is fine and it is deliberate: nothing secret
 * goes in here, and the only thing the signature has to guarantee is that the
 * contents were not EDITED. Reaching for encryption would suggest the payload
 * carries something it must not.
 *
 * ⚠ THE COOKIE IS NEVER THE AUTHORITY ON PERMISSION. It says which staff row
 * to look up. `active`, and the role, are re-read from the database on every
 * admin action, because a cookie describes what was true when it was signed
 * and revoking access has to take effect NOW rather than in twelve hours.
 *
 * Why a signed cookie and not a session table: a session row would need its
 * own sweeper on an instance whose scheduler does not run (the free tier spins
 * down), and a 12 hour expiry inside the token needs no cleanup at all. The
 * trade is that a token cannot be revoked individually before it expires,
 * which is why `staff.active` is checked on every request instead.
 */

const VERSION = 'v1';
/** 12 hours, with sliding renewal on use. One trading day, plus slack. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Renewed when less than this is left, so an active shift never expires. */
const RENEW_WHEN_UNDER_MS = 6 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'staff_session';

export interface SessionPayload {
  /** The `staff.id` to look up. Not a permission. */
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
  /** Makes two tokens issued in the same millisecond differ. */
  readonly nonce: string;
}

/**
 * ⭐ FAIL CLOSED ON A MISSING SECRET.
 *
 * With no `STAFF_SESSION_SECRET` there is no way to sign a cookie, and the
 * only safe behaviour is to refuse every session rather than to fall back to a
 * default key. A default signing key is the same as no signing key, because it
 * is in the repository.
 *
 * Read lazily rather than at module load so that a build, which has no
 * secrets, does not fail on import.
 */
function secret(): Buffer | null {
  const raw = process.env.STAFF_SESSION_SECRET;
  // 32 bytes minimum. A short secret is worse than an obviously absent one
  // because it looks configured.
  if (raw === undefined || raw.length < 32) return null;
  return Buffer.from(raw, 'utf8');
}

export function sessionsConfigured(): boolean {
  return secret() !== null;
}

function sign(payloadB64: string, key: Buffer): string {
  return createHmac('sha256', key).update(payloadB64).digest('base64url');
}

function encode(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function issueSession(staffId: string, nowMs: number): string | null {
  const key = secret();
  if (key === null) return null;

  const payload: SessionPayload = {
    sub: staffId,
    iat: nowMs,
    exp: nowMs + SESSION_TTL_MS,
    nonce: randomBytes(9).toString('base64url'),
  };
  const body = encode(payload);
  return `${VERSION}.${body}.${sign(body, key)}`;
}

export type SessionRefusal = 'notConfigured' | 'malformed' | 'badSignature' | 'expired';

export function readSession(
  token: string | undefined,
  nowMs: number,
): { ok: true; payload: SessionPayload } | { ok: false; reason: SessionRefusal } {
  const key = secret();
  if (key === null) return { ok: false, reason: 'notConfigured' };
  if (token === undefined || token === '') return { ok: false, reason: 'malformed' };

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, reason: 'malformed' };
  const [, body, presented] = parts as [string, string, string];

  /*
   * ⚠ THE SIGNATURE IS CHECKED BEFORE THE PAYLOAD IS PARSED. Reversing these
   * would mean feeding attacker-controlled bytes to `JSON.parse` and then
   * deciding whether to trust them, and every bug in that order is a bug where
   * unverified input has already been acted on.
   */
  const expected = sign(body, key);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'badSignature' };
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (
    typeof payload.sub !== 'string' ||
    payload.sub === '' ||
    typeof payload.exp !== 'number' ||
    typeof payload.iat !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.exp <= nowMs) return { ok: false, reason: 'expired' };

  return { ok: true, payload };
}

/** True when a valid session is close enough to expiry to be worth reissuing. */
export function shouldRenew(payload: SessionPayload, nowMs: number): boolean {
  return payload.exp - nowMs < RENEW_WHEN_UNDER_MS;
}

/**
 * The cookie attributes, in one place so no route can set a weaker set.
 *
 * `secure` is off outside production only because the dev server is plain
 * HTTP; it is on everywhere the cookie could actually be intercepted.
 */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
