import { NextResponse } from 'next/server';

/**
 * Health check. Render gates deploys on this, so it must be honest:
 * a dishonest health check turns zero-downtime deploys into zero-downtime
 * outages.
 *
 * Increment 0 checks only that the process is up. The database reachability
 * check is added as soon as a Supabase project exists — a health check that
 * returns 200 while the database is unreachable is worse than none, because
 * it will happily promote a broken deploy.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      // TODO(increment 0, once Supabase exists): add { database: 'ok' | 'unreachable' }
      // and return 503 when the database cannot be reached.
      checks: { process: 'ok' },
    },
    { status: 200 },
  );
}
