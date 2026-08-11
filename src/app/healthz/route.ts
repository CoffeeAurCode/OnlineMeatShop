import { NextResponse } from 'next/server';

import { pool } from '@/db/client';

/**
 * Health check. Render gates deploys on this, so it must be honest:
 * a dishonest health check turns zero-downtime deploys into zero-downtime
 * outages, because it promotes a broken release over a working one.
 *
 * It reports the database because "the process is running" is not a useful
 * claim about this application. Every page that matters reads the catalog, and
 * the database is in a different country from the app.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 *   - It does not return the error text. A `pg` connection failure message can
 *     carry the host, the user, and in some failure modes the connection
 *     string itself. This endpoint is public and unauthenticated, so it
 *     returns a bare state word and logs the detail server-side.
 *   - It does not touch application tables. `select 1` proves reachability,
 *     authentication and TLS without depending on a schema that migrations
 *     may be in the middle of changing.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Below Render's own health-check timeout, so a hung database produces a
 * decisive 503 rather than a request that Render eventually gives up on. The
 * two failures look identical in the dashboard and are not identical to debug.
 */
const DB_TIMEOUT_MS = 5_000;

/**
 * WHY THIS BORROWS A CLIENT INSTEAD OF CALLING pool.query()
 * ---------------------------------------------------------
 * The first version raced `pool.query('select 1')` against a timer and
 * returned 503 when the timer won. Racing a promise does not cancel the thing
 * it raced — it only stops waiting for it. The query kept its connection, and
 * that connection was never handed back.
 *
 * The pool holds 5. Render probes this endpoint on a schedule, an uptime cron
 * probes it too, and a stalled database is exactly when both probe hardest. So
 * a stall consumed one slot per probe until the pool was empty — at which
 * point every real request queued behind an exhausted pool and the site was
 * down for a reason unrelated to the original stall. The health check made the
 * outage instead of reporting it.
 *
 * Taking the client explicitly is what makes the timeout able to DESTROY the
 * connection rather than abandon it. `client.release(err)` with a truthy
 * argument tells `pg` to end that connection instead of returning it to the
 * pool, which both frees the slot and terminates the query server-side.
 */
async function checkDatabase(): Promise<'ok' | 'unreachable'> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${DB_TIMEOUT_MS}ms`)),
      DB_TIMEOUT_MS,
    );
  });

  // Acquire-and-query as one unit, so that every exit path from here — success,
  // failure, or timeout — returns or destroys the connection. If `connect()`
  // itself is what stalls, this promise stays pending after we have already
  // answered 503, and cleans up on its own whenever it eventually settles.
  // `Promise.race` below subscribes to it, so its rejection is never unhandled.
  const probe = (async () => {
    const client = await pool.connect();
    try {
      await Promise.race([client.query('select 1'), deadline]);
      client.release();
    } catch (err) {
      client.release(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  })();

  try {
    await Promise.race([probe, deadline]);
    return 'ok';
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        at: 'healthz.database',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const database = await checkDatabase();
  const healthy = database === 'ok';

  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', checks: { process: 'ok', database } },
    {
      status: healthy ? 200 : 503,
      // A cached health check is not a health check.
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
