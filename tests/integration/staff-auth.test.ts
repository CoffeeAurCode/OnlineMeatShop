import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { migrateTestDatabase, testPool, truncateAll } from './helpers/db';

/**
 * ⭐ STAFF SIGN-IN. The console's only door.
 *
 * What is checked here, and could not be checked without a real database:
 * that lockout survives on the row, that a deactivated account cannot sign in,
 * and that the cookie is never trusted about whether somebody still works
 * here.
 */

let pool: Pool;
let staffRepo: typeof import('@/db/repositories/staff');
let password: typeof import('@/auth/password');
let session: typeof import('@/auth/session');

const SECRET = 'test-secret-that-is-at-least-32-characters-long';

beforeAll(async () => {
  await migrateTestDatabase();
  pool = testPool();
  process.env.STAFF_SESSION_SECRET = SECRET;
  staffRepo = await import('@/db/repositories/staff');
  password = await import('@/auth/password');
  session = await import('@/auth/session');
});

afterAll(async () => {
  await pool.end();
  const { pool: appPool } = await import('@/db/client');
  await appPool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

describe('password hashing', () => {
  it('round-trips, and rejects the wrong password', async () => {
    const hash = await password.hashPassword('correct horse battery staple');
    expect(await password.verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await password.verifyPassword('Correct horse battery staple', hash)).toBe(false);
  });

  it('salts, so two identical passwords do not share a hash', async () => {
    const a = await password.hashPassword('same');
    const b = await password.hashPassword('same');
    expect(a).not.toBe(b);
    expect(await password.verifyPassword('same', a)).toBe(true);
    expect(await password.verifyPassword('same', b)).toBe(true);
  });

  it('⭐ carries its parameters, so an OLD hash still verifies', async () => {
    // The whole reason the cost lives in the string. A weaker historical hash
    // must keep working, or raising the cost silently locks everybody out and
    // the symptom looks like "the password stopped working".
    const weak = 'scrypt$1024$8$1$';
    const { randomBytes, scryptSync } = await import('node:crypto');
    const salt = randomBytes(16);
    const derived = scryptSync('legacy', salt, 64, { N: 1024, r: 8, p: 1, maxmem: 128 * 1024 * 8 * 2 });
    const stored = `${weak}${salt.toString('base64')}$${derived.toString('base64')}`;

    expect(await password.verifyPassword('legacy', stored)).toBe(true);
    expect(password.needsRehash(stored)).toBe(true);
  });

  it('refuses a malformed hash instead of throwing', async () => {
    // A corrupted row must fail the login, not crash the route.
    for (const bad of ['', 'nonsense', 'scrypt$x$8$1$a$b', 'bcrypt$1$2$3$4$5']) {
      expect(await password.verifyPassword('x', bad)).toBe(false);
    }
  });

  it('⭐ refuses an absurd cost rather than allocating it', async () => {
    // These numbers come out of the database and feed a memory allocation. A
    // row claiming N = 2^30 would be an out-of-memory crash triggered by a
    // login attempt, which is a denial of service with a very short payload.
    const huge = `scrypt$1073741824$8$1$AAAA$AAAA`;
    expect(await password.verifyPassword('x', huge)).toBe(false);
  });
});

describe('signIn', () => {
  it('accepts the right password and resets the failure counter', async () => {
    await staffRepo.upsertStaff('owner', 'a-very-good-password');
    await pool.query(`UPDATE staff SET failed_attempts = 3`);

    const result = await staffRepo.signIn('owner', 'a-very-good-password', Date.now());
    expect(result.ok).toBe(true);

    const { rows } = await pool.query(`SELECT failed_attempts, last_login_at FROM staff`);
    expect(rows[0].failed_attempts).toBe(0);
    expect(rows[0].last_login_at).not.toBeNull();
  });

  it('is case insensitive about the username but not the password', async () => {
    await staffRepo.upsertStaff('Owner', 'a-very-good-password');
    expect((await staffRepo.signIn('OWNER', 'a-very-good-password', Date.now())).ok).toBe(true);
    expect((await staffRepo.signIn('owner', 'A-Very-Good-Password', Date.now())).ok).toBe(false);
  });

  it('⭐ gives the SAME answer for an unknown user and a wrong password', async () => {
    await staffRepo.upsertStaff('owner', 'a-very-good-password');

    const unknown = await staffRepo.signIn('nobody', 'whatever', Date.now());
    const wrong = await staffRepo.signIn('owner', 'whatever', Date.now());

    // Anything else turns the form into an account oracle.
    expect(unknown).toEqual({ ok: false, reason: 'invalid' });
    expect(wrong).toEqual({ ok: false, reason: 'invalid' });
  });

  it('⭐ refuses a DEACTIVATED account, and does not say why', async () => {
    await staffRepo.upsertStaff('owner', 'a-very-good-password');
    await pool.query(`UPDATE staff SET active = false`);

    const result = await staffRepo.signIn('owner', 'a-very-good-password', Date.now());
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('⭐ locks out after five wrong attempts, ON THE ROW', async () => {
    await staffRepo.upsertStaff('owner', 'a-very-good-password');
    const now = Date.now();

    for (let i = 0; i < 5; i += 1) {
      expect((await staffRepo.signIn('owner', 'wrong', now)).ok).toBe(false);
    }

    // The lockout is persisted, which is what makes it survive a redeploy.
    const { rows } = await pool.query(`SELECT failed_attempts, locked_until FROM staff`);
    expect(rows[0].failed_attempts).toBe(5);
    expect(rows[0].locked_until).not.toBeNull();

    // And now even the CORRECT password is refused.
    const locked = await staffRepo.signIn('owner', 'a-very-good-password', now);
    expect(locked.ok).toBe(false);
    expect(locked).toMatchObject({ reason: 'locked' });
  });

  it('lets the right password through once the lockout expires', async () => {
    await staffRepo.upsertStaff('owner', 'a-very-good-password');
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) await staffRepo.signIn('owner', 'wrong', now);

    const later = now + 16 * 60 * 1000;
    expect((await staffRepo.signIn('owner', 'a-very-good-password', later)).ok).toBe(true);
  });

  it('a password reset clears the lockout', async () => {
    await staffRepo.upsertStaff('owner', 'a-very-good-password');
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) await staffRepo.signIn('owner', 'wrong', now);

    await staffRepo.upsertStaff('owner', 'a-different-good-password');
    expect((await staffRepo.signIn('owner', 'a-different-good-password', now)).ok).toBe(true);
  });
});

describe('activeStaffById, the check that runs on every admin action', () => {
  it('returns the row while active and NULL the moment it is not', async () => {
    const id = await staffRepo.upsertStaff('owner', 'a-very-good-password');
    expect(await staffRepo.activeStaffById(id)).toMatchObject({ username: 'owner' });

    await pool.query(`UPDATE staff SET active = false WHERE id = $1`, [id]);

    // ⭐ This is what makes revocation immediate rather than "when the twelve
    // hour cookie expires". The cookie is still perfectly valid at this point.
    expect(await staffRepo.activeStaffById(id)).toBeNull();
  });

  it('returns null for an id that does not exist', async () => {
    expect(await staffRepo.activeStaffById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('the session cookie', () => {
  const now = 1_760_000_000_000;

  it('round-trips a valid token', () => {
    const token = session.issueSession('abc', now);
    expect(token).not.toBeNull();
    const read = session.readSession(token ?? undefined, now + 1000);
    expect(read).toMatchObject({ ok: true, payload: { sub: 'abc' } });
  });

  it('⭐ refuses a token whose payload was EDITED', () => {
    const token = session.issueSession('abc', now) ?? '';
    const [v, body, sig] = token.split('.') as [string, string, string];

    // Re-encode the payload with a different subject, keeping the signature.
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.sub = 'somebody-else';
    const forged = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    expect(session.readSession(`${v}.${forged}.${sig}`, now)).toEqual({
      ok: false,
      reason: 'badSignature',
    });
  });

  it('refuses an expired token', () => {
    const token = session.issueSession('abc', now) ?? '';
    expect(session.readSession(token, now + session.SESSION_TTL_MS + 1)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('refuses garbage without throwing', () => {
    for (const bad of ['', 'x', 'v1.only-two', 'v2.a.b', 'v1...']) {
      const result = session.readSession(bad, now);
      expect(result.ok).toBe(false);
    }
  });

  it('⭐ FAILS CLOSED with no signing secret', () => {
    const saved = process.env.STAFF_SESSION_SECRET;
    try {
      delete process.env.STAFF_SESSION_SECRET;
      expect(session.sessionsConfigured()).toBe(false);
      expect(session.issueSession('abc', now)).toBeNull();
      expect(session.readSession('anything', now)).toEqual({ ok: false, reason: 'notConfigured' });

      // A short secret is refused too: it looks configured, which is worse
      // than being obviously absent.
      process.env.STAFF_SESSION_SECRET = 'too-short';
      expect(session.sessionsConfigured()).toBe(false);
    } finally {
      process.env.STAFF_SESSION_SECRET = saved;
    }
  });

  it('renews only when the session is close to expiry', () => {
    const fresh = { sub: 'a', iat: now, exp: now + session.SESSION_TTL_MS, nonce: 'n' };
    expect(session.shouldRenew(fresh, now)).toBe(false);
    expect(session.shouldRenew(fresh, now + 7 * 60 * 60 * 1000)).toBe(true);
  });
});
