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

async function checkDatabase(): Promise<'ok' | 'unreachable'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pool.query('select 1'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${DB_TIMEOUT_MS}ms`)), DB_TIMEOUT_MS);
      }),
    ]);
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
