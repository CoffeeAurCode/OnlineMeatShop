import 'server-only';

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

import { serverEnv } from '@/server-env';
import { postgresTls } from './ssl';

/**
 * The application's one connection pool.
 *
 * WHICH ENDPOINT, AND WHY IT MATTERS
 * ----------------------------------
 * `DATABASE_URL` is Supabase's **transaction** pooler (port 6543). A pooled
 * connection is handed back after every statement, so:
 *
 *   - Server-side prepared statements must be off. A prepared statement is
 *     bound to a backend connection; with transaction pooling the next
 *     statement may land on a different one, and the failure surfaces as an
 *     intermittent "prepared statement s1 already exists" under load — which
 *     is to say, in production and not in development.
 *   - Session state does not persist between statements. In particular
 *     `pg_advisory_lock` (session-scoped) silently attaches to whichever
 *     backend answered and is never released. The scheduler therefore uses
 *     `pg_try_advisory_xact_lock`, which ends with the transaction.
 *
 * Migrations and `pg_dump` use `DIRECT_DATABASE_URL` — the **session** pooler
 * (5432) — and run outside this process entirely. That variable is
 * deliberately absent from the web service's environment; see server-env.ts.
 *
 * A transaction still gets a single dedicated connection for its whole
 * lifetime, which is what `PlaceOrder`'s row locks require. Transaction
 * pooling pins the connection for the duration of the transaction; it is only
 * between transactions that it is shared.
 */

declare global {
  var __dbPool: Pool | undefined;
}

function createPool(): Pool {
  // Read once: the TLS decision is made FROM this string, so the two must not
  // be able to disagree about which database is being dialled.
  const connectionString = serverEnv.databaseUrl();

  return new Pool({
    connectionString,
    // TLS unless the target is loopback — see ssl.ts. A local test database
    // serves plaintext and has no certificate to pin.
    ssl: postgresTls(connectionString),

    // Small on purpose. One Render Starter instance (0.5 vCPU / 512 MB) does
    // not benefit from a large pool, and Supabase Free's pooler budget is
    // shared with every other client — including the migration job. The
    // bottleneck this project actually has is lock contention inside
    // PlaceOrder, which a bigger pool makes worse, not better.
    max: 5,

    // Trans-continental link (app in US-East, database in ca-central-1), so
    // allow more than the 0ms-away default assumes, but still fail rather
    // than hang: a request that waits forever holds a slot forever.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,

    // Supabase's pooler drops idle connections; without this the pool hands
    // out a dead one and the first query of a quiet morning fails.
    keepAlive: true,
  });
}

/**
 * Reused across hot reloads in development. Without this, every edit leaks a
 * pool and the connection allowance is exhausted within a few minutes of
 * ordinary work.
 */
export const pool: Pool =
  process.env.NODE_ENV === 'production' ? createPool() : (globalThis.__dbPool ??= createPool());

/**
 * A pool-level error handler is not optional. `pg` emits 'error' on idle
 * clients when the server closes a connection; with no listener, Node treats
 * it as an unhandled 'error' event and terminates the process. On a
 * single-instance deployment that is a site outage caused by routine pooler
 * housekeeping.
 */
pool.on('error', (err) => {
  console.error(JSON.stringify({ level: 'error', at: 'pg.pool', message: err.message }));
});

export const db = drizzle(pool);
