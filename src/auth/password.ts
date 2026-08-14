import 'server-only';

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing, with `scrypt` from the standard library.
 *
 * ⚠ NO bcrypt, NO argon2, and that is a decision rather than an omission.
 * `scrypt` is a memory-hard KDF, it is in `node:crypto`, and it needs no
 * native build step. Adding a native dependency to a project that deploys to a
 * 512 MB instance, for one login screen used by one person, is a poor trade.
 *
 * ══ WHY THE PARAMETERS LIVE INSIDE THE HASH ═══════════════════════════════
 *
 * The stored string is `scrypt$N$r$p$salt$hash`. Putting the cost parameters
 * in the string rather than in a constant is what lets the cost be RAISED
 * LATER without invalidating every existing password: an old hash still
 * carries the parameters it was made with, so it still verifies, and it can be
 * transparently upgraded on the next successful sign-in.
 *
 * A constant in the code would mean that raising the cost silently locks out
 * everyone who has not logged in since, and the symptom would be "the password
 * stopped working", which nobody would connect to a config change.
 */

/**
 * N = 2^15. Roughly 32 MB and about 100ms on the target instance.
 *
 * Deliberately not higher: this runs on a 0.5 vCPU / 512 MB box, and a KDF
 * that takes a second there is a login that feels broken and a DoS vector for
 * anyone who can POST to it.
 */
const N = 32_768;
const R = 8;
const P = 1;
const KEYLEN = 64;
/** scrypt's default `maxmem` (32 MB) is BELOW what N = 2^15 needs. */
const MAXMEM = 128 * N * R * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Returns `false` for a malformed or unrecognised hash rather than throwing:
 * a corrupted row must fail the login, not crash the login route, because a
 * crash is a much louder signal to whoever is probing it.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  // Bounded, because these numbers come out of the database and are fed
  // straight into a memory allocation. A row saying N = 2^30 would be an
  // out-of-memory crash triggered by a login attempt.
  if (!Number.isInteger(n) || n < 1024 || n > 1_048_576) return false;
  if (!Number.isInteger(r) || r < 1 || r > 32) return false;
  if (!Number.isInteger(p) || p < 1 || p > 16) return false;

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(hashB64, 'base64');
    actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
      N: n,
      r,
      p,
      maxmem: 128 * n * r * 2,
    });
  } catch {
    return false;
  }

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** True when a hash was made with weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < N;
}
