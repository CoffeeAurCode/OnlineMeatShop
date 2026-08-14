import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';
import { staff } from '@/db/schema';
import { hashPassword, needsRehash, verifyPassword } from '@/auth/password';

/**
 * Staff sign-in, and the lockout that stops it being brute forced.
 *
 * ⚠ LOCKOUT LIVES ON THE ROW, NOT IN MEMORY. The process restarts on every
 * deploy and the free instance spins down after fifteen minutes idle, so an
 * in-memory counter is one that resets itself for free. A lockout a redeploy
 * clears is not a lockout.
 */

/** Five wrong passwords, then fifteen minutes. */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface StaffRow {
  readonly id: string;
  readonly username: string;
  readonly role: 'OWNER' | 'STAFF';
  readonly active: boolean;
}

export type SignInResult =
  | { readonly ok: true; readonly staff: StaffRow }
  | { readonly ok: false; readonly reason: 'invalid' }
  | { readonly ok: false; readonly reason: 'locked'; readonly untilMs: number };

/**
 * Verify a username and password.
 *
 * ⚠ AN UNKNOWN USERNAME AND A WRONG PASSWORD RETURN THE SAME `invalid`, and
 * the unknown-username path still pays the cost of a hash. Skipping the KDF
 * when the user does not exist makes that path measurably faster, which turns
 * the login form into a username oracle: an attacker learns which accounts
 * exist by timing, without ever guessing a password.
 *
 * ⚠ A DEACTIVATED ACCOUNT ALSO RETURNS `invalid`, for the same reason. "That
 * account is disabled" confirms the account.
 */
export async function signIn(
  username: string,
  password: string,
  nowMs: number,
  tx: Tx | typeof db = db,
): Promise<SignInResult> {
  const normalised = username.trim().toLowerCase();

  const rows = await tx
    .select({
      id: staff.id,
      username: staff.username,
      passwordHash: staff.passwordHash,
      role: staff.role,
      active: staff.active,
      failedAttempts: staff.failedAttempts,
      lockedUntil: staff.lockedUntil,
    })
    .from(staff)
    .where(eq(staff.username, normalised))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    // The timing equaliser. Hashing a throwaway value costs the same as the
    // real path, so a missing user is indistinguishable from a wrong password.
    await verifyPassword(password, DUMMY_HASH);
    return { ok: false, reason: 'invalid' };
  }

  if (row.lockedUntil !== null && row.lockedUntil.getTime() > nowMs) {
    // Told plainly, because at this point the credentials were already correct
    // or already wrong enough times that the account is known to exist, and a
    // locked-out operator at 6am needs to know to wait rather than to keep
    // trying.
    return { ok: false, reason: 'locked', untilMs: row.lockedUntil.getTime() };
  }

  const correct = await verifyPassword(password, row.passwordHash);

  if (!correct || !row.active) {
    const attempts = row.failedAttempts + 1;
    await tx
      .update(staff)
      .set({
        failedAttempts: attempts,
        lockedUntil: attempts >= MAX_ATTEMPTS ? new Date(nowMs + LOCKOUT_MS) : row.lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(staff.id, row.id));
    return { ok: false, reason: 'invalid' };
  }

  // Success resets the counter, so five wrong guesses spread over a week do
  // not eventually lock out a legitimate operator.
  await tx
    .update(staff)
    .set({
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(nowMs),
      // Transparent upgrade: a hash made with weaker parameters is rewritten
      // now that we hold the plaintext, which is the only moment we can.
      ...(needsRehash(row.passwordHash) ? { passwordHash: await hashPassword(password) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(staff.id, row.id));

  return {
    ok: true,
    staff: { id: row.id, username: row.username, role: row.role, active: row.active },
  };
}

/**
 * ⭐ RE-READ ON EVERY ADMIN ACTION. Never taken from the cookie.
 *
 * Returns `null` for an unknown or deactivated staff member, which is what
 * makes "revoke access" take effect immediately rather than when a twelve hour
 * token happens to expire.
 */
export async function activeStaffById(
  id: string,
  tx: Tx | typeof db = db,
): Promise<StaffRow | null> {
  const rows = await tx
    .select({
      id: staff.id,
      username: staff.username,
      role: staff.role,
      active: staff.active,
    })
    .from(staff)
    .where(eq(staff.id, id))
    .limit(1);

  const row = rows[0];
  if (row === undefined || !row.active) return null;
  return row;
}

/** Create or reset a staff member. Used by `scripts/create-staff.mjs`. */
export async function upsertStaff(
  username: string,
  password: string,
  role: 'OWNER' | 'STAFF' = 'OWNER',
  tx: Tx | typeof db = db,
): Promise<string> {
  const normalised = username.trim().toLowerCase();
  const passwordHash = await hashPassword(password);

  const rows = await tx
    .insert(staff)
    .values({ username: normalised, passwordHash, role, active: true })
    .onConflictDoUpdate({
      target: staff.username,
      set: {
        passwordHash,
        role,
        active: true,
        // A password reset clears any lockout, which is the whole point of
        // being able to reset it.
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: staff.id });

  const row = rows[0];
  if (row === undefined) throw new Error('staff upsert returned nothing');
  return row.id;
}

/**
 * A real hash of a value nobody knows, used only to burn the same CPU as a
 * genuine verification. Generated once at module load.
 *
 * It is a constant rather than a fresh hash per request because hashing is the
 * expensive part and doing it twice would make the missing-user path SLOWER
 * than the real one, which is the same oracle in the other direction.
 */
const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'ZG8gbm90IHVzZSB0aGlzIHZhbHVlIGZvciBhbnl0aGluZyBhdCBhbGwsIGl0IGlzIGEgdGltaW5nIHBhZA==';
