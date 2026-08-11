import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { migrateTestDatabase, testPool, truncateAll } from './helpers/db';

/**
 * The scheduler's advisory locking, against a real PostgreSQL — because the
 * whole point of the design is a property of `pg_try_advisory_xact_lock` that
 * a fake would simply assert into existence.
 */

let pool: Pool;
let sched: typeof import('@/jobs/scheduler');

beforeAll(async () => {
  await migrateTestDatabase();
  pool = testPool();
  sched = await import('@/jobs/scheduler');
});

afterAll(async () => {
  await pool.end();
  const { pool: appPool } = await import('@/db/client');
  await appPool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

describe('lock ids', () => {
  it('are stable and inside the SIGNED bigint range Postgres accepts', () => {
    const id = sched.lockIdFor('drain-outbox');
    expect(id).toBe(sched.lockIdFor('drain-outbox'));
    // Above 2^63−1 is an overflow rather than a lock.
    expect(id).toBeLessThanOrEqual(0x7fffffffffffffffn);
    expect(id).toBeGreaterThanOrEqual(0n);
  });

  it('refuse to start when two jobs collide', () => {
    const a = sched.defineJob('same', async () => {});
    const b = { ...sched.defineJob('other', async () => {}), lockId: a.lockId };
    expect(() => sched.assertDistinctLockIds([a, b])).toThrow(/silently take turns/);
  });
});

describe('the lock actually excludes', () => {
  it('a second runner SKIPS a job the first is holding', async () => {
    let released!: () => void;
    const gate = new Promise<void>((resolve) => {
      released = resolve;
    });

    const slow = sched.defineJob('slow-job', async () => {
      await gate;
    });

    const first = sched.tick([slow]);
    // Give the first tick time to take the lock before the second tries.
    await new Promise((r) => setTimeout(r, 200));
    const second = await sched.tick([slow]);

    released();
    const firstResult = await first;

    expect(firstResult[0]?.outcome).toBe('ran');
    // Skipped, NOT failed — another instance holds it, which is the mechanism
    // working rather than an error.
    expect(second[0]?.outcome).toBe('skipped');
  });

  it('releases the lock on ROLLBACK, so a throwing job does not wedge itself', async () => {
    // This is the failure the session-scoped variant produces: the lock is
    // never released, so the job is silently skipped forever after one
    // hiccup. Silently is the worst property a scheduler can have.
    let attempts = 0;
    const flaky = sched.defineJob('flaky-job', async () => {
      attempts++;
      if (attempts === 1) throw new Error('boom');
    });

    const first = await sched.tick([flaky]);
    expect(first[0]?.outcome).toBe('failed');

    // The very next tick must be able to take the lock again.
    const second = await sched.tick([flaky]);
    expect(second[0]?.outcome).toBe('ran');
    expect(attempts).toBe(2);
  });
});

describe('one lock per job, not one for the batch', () => {
  it('a job that fails does not stop the jobs after it', async () => {
    const ran: string[] = [];
    const jobs = [
      sched.defineJob('first', async () => {
        ran.push('first');
      }),
      sched.defineJob('explodes', async () => {
        throw new Error('boom');
      }),
      sched.defineJob('third', async () => {
        ran.push('third');
      }),
    ];

    const results = await sched.tick(jobs);
    expect(results.map((r) => r.outcome)).toEqual(['ran', 'failed', 'ran']);
    // The third job still ran. With a single batch lock and no containment it
    // would not have.
    expect(ran).toEqual(['first', 'third']);
  });

  it('a job holding its lock does not block a different job', async () => {
    let released!: () => void;
    const gate = new Promise<void>((resolve) => {
      released = resolve;
    });

    const slow = sched.defineJob('slow', async () => {
      await gate;
    });
    const quick = sched.defineJob('quick', async () => {});

    const held = sched.tick([slow]);
    await new Promise((r) => setTimeout(r, 200));

    // A different job, while `slow` is mid-flight. With one lock for the whole
    // batch the outbox would stop draining whenever the nightly check ran.
    const other = await sched.tick([quick]);
    expect(other[0]?.outcome).toBe('ran');

    released();
    await held;
  });
});

describe('the job body runs inside the locked transaction', () => {
  it('rolls its writes back when it throws', async () => {
    const { sql } = await import('drizzle-orm');
    const job = sched.defineJob('writes-then-throws', async (tx) => {
      await tx.execute(
        sql`INSERT INTO audit_log (actor, action, entity, entity_id) VALUES ('job', 'x', 'y', 'z')`,
      );
      throw new Error('after the write');
    });

    expect((await sched.tick([job]))[0]?.outcome).toBe('failed');

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM audit_log`);
    expect(rows[0].n).toBe(0);
  });
});
