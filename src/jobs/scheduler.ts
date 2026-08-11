import 'server-only';

import { sql } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';

/**
 * The in-process scheduler (D11, DTM §11.3).
 *
 * It runs inside the web service rather than as a separate Render Cron Job,
 * because a second service is a second billable instance and the web service
 * is already always-on. That "always-on" is what the paid instance buys —
 * a free instance spins down when idle and the scheduler would stop with it.
 *
 * ══ WHY `pg_try_advisory_XACT_lock` AND NOT `pg_try_advisory_lock` ═════════
 *
 * The session-scoped variant is a bug in three ways against a connection pool,
 * and it was in the first draft of this design:
 *
 *   1. The lock attaches to whichever pooled connection happened to run the
 *      query, while the work proceeds on another.
 *   2. Repeat acquisition on the same session STACKS, and needs matching
 *      unlocks that nobody writes.
 *   3. If the handler throws, the lock is never released — so it is held until
 *      that connection is recycled, and every subsequent run of that job is
 *      SILENTLY SKIPPED.
 *
 * Silently is the worst property a scheduler can have. The transaction-scoped
 * variant is released by Postgres on COMMIT or ROLLBACK, which makes all three
 * impossible.
 */

export interface Job {
  readonly name: string;
  /**
   * A stable 64-bit key for the advisory lock. Derived from the name so it
   * cannot drift, and asserted unique across the registry at startup —
   * two jobs sharing a lock id would silently take turns instead of running.
   */
  readonly lockId: bigint;
  /** MUST be idempotent. The lock reduces duplicate work; it does not
   *  guarantee its absence — a lock is not held across a process restart. */
  readonly run: (tx: Tx) => Promise<void>;
}

/**
 * A stable 63-bit hash of the job name (FNV-1a, folded).
 *
 * 63 rather than 64 bits: Postgres advisory lock ids are SIGNED bigints, and
 * handing one a value above 2^63−1 is an overflow rather than a lock.
 */
export function lockIdFor(name: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const ch of name) {
    hash = ((hash ^ BigInt(ch.codePointAt(0) ?? 0)) * prime) & mask;
  }
  return hash & 0x7fffffffffffffffn;
}

export function defineJob(name: string, run: (tx: Tx) => Promise<void>): Job {
  return { name, lockId: lockIdFor(name), run };
}

export interface TickResult {
  readonly name: string;
  readonly outcome: 'ran' | 'skipped' | 'failed';
  readonly error?: string;
}

/**
 * Run each due job, each in its own transaction, each under its own lock.
 *
 * ⚠ ONE LOCK PER JOB, NOT ONE FOR THE WHOLE BATCH. A single batch lock means a
 * slow job blocks every other job behind it, and the outbox stops draining
 * because the nightly consistency check is still running.
 *
 * A job that cannot take its lock is `skipped`, not failed — another instance
 * has it, which is the mechanism working. A job that throws is contained: its
 * transaction rolls back, its lock is released with it, and the remaining jobs
 * still run.
 */
export async function tick(jobs: readonly Job[]): Promise<readonly TickResult[]> {
  const results: TickResult[] = [];

  for (const job of jobs) {
    try {
      const outcome = await db.transaction(async (tx) => {
        const locked = await tx.execute<{ locked: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(${job.lockId}) AS locked`,
        );
        const got = (locked.rows[0] as { locked: boolean } | undefined)?.locked === true;
        if (!got) return 'skipped' as const;

        await job.run(tx);
        return 'ran' as const;
      });
      results.push({ name: job.name, outcome });
    } catch (err) {
      // Contained on purpose. One failing job must not stop the others, and
      // the failure must be visible rather than swallowed — a scheduler that
      // fails quietly is indistinguishable from one that is working.
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({ level: 'error', at: 'scheduler.job', job: job.name, message }),
      );
      results.push({ name: job.name, outcome: 'failed', error: message });
    }
  }

  return results;
}

/**
 * Refuse to start with two jobs sharing a lock id.
 *
 * They would take turns rather than run together, which looks like each job
 * running at half its configured cadence — a symptom nobody diagnoses quickly.
 */
export function assertDistinctLockIds(jobs: readonly Job[]): void {
  const seen = new Map<bigint, string>();
  for (const job of jobs) {
    const clash = seen.get(job.lockId);
    if (clash) {
      throw new Error(
        `Jobs "${clash}" and "${job.name}" share advisory lock id ${job.lockId}. ` +
          'They would silently take turns instead of running independently.',
      );
    }
    seen.set(job.lockId, job.name);
  }
}
