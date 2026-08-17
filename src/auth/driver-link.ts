import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The token in the dispatch SMS: how it is made, and how it is looked up.
 *
 * ══ WHY THIS IS RANDOM AND STORED, WHERE EVERY OTHER TOKEN HERE IS SIGNED ══
 *
 * The staff, customer and driver SESSIONS are HMAC-signed and stateless: the
 * server can verify one without remembering it, which is exactly what you want
 * from a cookie presented on every request.
 *
 * ⭐ THIS ONE IS THE OPPOSITE ON PURPOSE, AND THE REASON IS SINGLE USE. A
 * signed token is valid every time it is presented, by anyone holding it, until
 * it expires — there is nowhere to record that it has been spent. A link in a
 * text message can be forwarded, screenshotted and posted, so "valid every
 * time" is precisely the property that must not hold. Spending it has to be
 * written down, so the token is random and the row is the truth.
 *
 * ══ 32 BYTES, AND WHY NOT FEWER ═══════════════════════════════════════════
 *
 * 256 bits from `randomBytes`. The customer's tracking token is a v4 UUID (122
 * bits) and that is fine for a receipt; this is a CREDENTIAL that signs
 * somebody in, so it gets the larger one. base64url keeps it to 43 characters,
 * which matters: the whole link has to fit in an SMS that is already three
 * segments.
 */

/** 12 hours — the client's choice, 2026-08-17. Covers a shift, dead by morning. */
export const DRIVER_LINK_TTL_MS = 12 * 60 * 60 * 1000;

export interface MintedDriverLink {
  /** Goes in the SMS. Never stored. */
  readonly token: string;
  /** Goes in the database. Never leaves the server. */
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export function mintDriverLinkToken(nowMs: number): MintedDriverLink {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashDriverLinkToken(token),
    expiresAt: new Date(nowMs + DRIVER_LINK_TTL_MS),
  };
}

/**
 * ⚠ SHA-256, NOT A PASSWORD HASH, AND THAT IS CORRECT HERE.
 *
 * `scrypt` guards `staff.password` because a password is low-entropy and
 * guessable, so the defence has to be making each guess expensive. This token
 * is 256 bits of `randomBytes` — there is nothing to guess and no dictionary to
 * run — so a slow hash would buy nothing and would put a deliberate delay on
 * the one tap a driver makes at a door.
 *
 * What the hash IS for: making the stored row useless to anybody who reads it.
 */
export function hashDriverLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Compare two hashes without leaking where they diverge.
 *
 * ⚠ Belt and braces — the lookup is an indexed equality in Postgres, which is
 * not constant time and cannot be made so. This exists so that any future code
 * path comparing hashes in JavaScript has the right function to hand rather
 * than reaching for `===`.
 */
export function driverLinkHashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The URL that goes in the SMS.
 *
 * ⚠ `/d/`, NOT `/driver/`, AND IT IS NOT COSMETIC. Two reasons, both real:
 *
 *   1. Everything under `/driver` is behind the portal's layout guard, which
 *      renders a sign-in form when there is no session. A link whose entire job
 *      is to CREATE that session cannot live behind it.
 *   2. Every character is billed. The dispatch message is already three SMS
 *      segments; `/d/` over `/driver/link/` saves nine of them.
 */
export function driverLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/d/${token}`;
}
