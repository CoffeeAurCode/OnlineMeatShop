import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { migrateTestDatabase, testPool, truncateAll } from './helpers/db';

/**
 * ⭐ THE PARTIAL-INDEX UPSERT, against a real PostgreSQL.
 *
 * This file exists because of a defect that migration 0006 introduced and
 * that NOTHING ELSE COULD HAVE CAUGHT:
 *
 * Making `email` optional meant replacing `UNIQUE (email)` with
 * `UNIQUE (email) WHERE email IS NOT NULL`. Postgres infers the arbiter index
 * for `ON CONFLICT` by matching the column list AND the index predicate, so a
 * bare `ON CONFLICT (email)` stopped matching anything and began failing with
 *
 *     there is no unique or exclusion constraint matching
 *     the ON CONFLICT specification
 *
 * The typechecker is happy, the unit tests are happy, drizzle is happy. It
 * surfaces as an HTTP 500 on the second checkout from a returning customer —
 * a long way from the migration that caused it.
 *
 * ⚠ Every assertion here needs a SECOND call with the same identifier. The
 * first insert takes the fast path and never reaches `ON CONFLICT`, so a test
 * that only inserts once passes against the broken code.
 */

let pool: Pool;
let repo: typeof import('@/db/repositories/customers');

beforeAll(async () => {
  await migrateTestDatabase();
  pool = testPool();
  repo = await import('@/db/repositories/customers');
});

afterAll(async () => {
  await pool.end();
  const { pool: appPool } = await import('@/db/client');
  await appPool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

describe('findOrCreateCustomer — email, now a partial unique index', () => {
  it('returns the SAME row on the second call rather than raising ON CONFLICT', async () => {
    const first = await repo.findOrCreateCustomer('repeat@example.test', 'Sample Customer', null);
    const second = await repo.findOrCreateCustomer('repeat@example.test', null, null);

    expect(second).toBe(first);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM customer`);
    expect(rows[0].n).toBe(1);
  });

  it('refreshes contact details without ever blanking them', async () => {
    const id = await repo.findOrCreateCustomer('keep@example.test', 'Sample Customer', '+15550100');
    // A later guest checkout supplies no phone. The stored number must survive:
    // it is the one the shop rings about a weight variance.
    await repo.findOrCreateCustomer('keep@example.test', null, null);

    const { rows } = await pool.query(`SELECT name, phone FROM customer WHERE id = $1`, [id]);
    expect(rows[0]).toEqual({ name: 'Sample Customer', phone: '+15550100' });
  });

  it('allows MANY customers with no email, which the old NOT NULL UNIQUE forbade', async () => {
    await pool.query(`INSERT INTO customer (phone) VALUES ('+15550001'), ('+15550002')`);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM customer WHERE email IS NULL`,
    );
    expect(rows[0].n).toBe(2);
  });
});

describe('findOrCreateCustomerByPhone — the prototype’s primary path', () => {
  it('returns the SAME row on the second call', async () => {
    const first = await repo.findOrCreateCustomerByPhone('+15144865246', 'Sample Customer', null);
    const second = await repo.findOrCreateCustomerByPhone('+15144865246', null, null);

    expect(second).toBe(first);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM customer`);
    expect(rows[0].n).toBe(1);
  });

  it('never blanks an email the customer gave earlier', async () => {
    const id = await repo.findOrCreateCustomerByPhone('+15550111', null, 'first@example.test');
    await repo.findOrCreateCustomerByPhone('+15550111', 'Sample Customer', null);

    const { rows } = await pool.query(`SELECT name, email FROM customer WHERE id = $1`, [id]);
    expect(rows[0]).toEqual({ name: 'Sample Customer', email: 'first@example.test' });
  });

  it('refuses a second row for the same number even when raced', async () => {
    // The reason this is an upsert and not select-then-insert.
    const ids = await Promise.all(
      Array.from({ length: 8 }, () => repo.findOrCreateCustomerByPhone('+15550222', null, null)),
    );
    expect(new Set(ids).size).toBe(1);
  });

  it('leaves phone_verified_at NULL, because nothing verifies anything yet', async () => {
    const id = await repo.findOrCreateCustomerByPhone('+15550333', null, null);
    const { rows } = await pool.query(`SELECT phone_verified_at FROM customer WHERE id = $1`, [id]);
    expect(rows[0].phone_verified_at).toBeNull();
  });
});

describe('normalisePhone', () => {
  it('accepts the shapes a customer actually types', () => {
    for (const raw of ['514-486-5246', '(514) 486-5246', '+1 514 486 5246', '15144865246']) {
      expect(repo.normalisePhone(raw)).toBe('+15144865246');
    }
  });

  it('returns null rather than guessing at anything else', () => {
    // A number stored in two formats is two customers, so refusing beats
    // improvising. `+44` is not `+1` and must not be coerced into it.
    for (const raw of ['', '12345', '+44 20 7946 0958', 'not a number']) {
      expect(repo.normalisePhone(raw)).toBeNull();
    }
  });
});
