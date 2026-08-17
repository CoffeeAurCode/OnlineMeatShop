import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Pool } from 'pg';

/**
 * Test-database plumbing: connect, migrate once, truncate between tests.
 *
 * WHY A REAL POSTGRES AND NOT A FAKE
 * ----------------------------------
 * Everything these suites exist to check is a property of the database, not of
 * the application: `FOR UPDATE` actually serialising, the CHECK constraints
 * actually refusing, the canonical lock order actually preventing a deadlock,
 * a failed transaction actually rolling back to a byte-identical state. A fake
 * has none of those. A fake that claimed to have them would be a second
 * implementation of Postgres, tested against nothing.
 */

/**
 * Loopback by default, which is also what `postgresTls()` recognises as safe
 * to reach in plaintext — see src/db/ssl.ts. In CI this is the service
 * container; locally it is whatever `npm run db:test:up` started.
 *
 * ⚠ PORT 5433, NOT 5432, AND THAT IS DELIBERATE.
 *
 * `migrateTestDatabase` runs `DROP SCHEMA public CASCADE`. On 5432 — the
 * PostgreSQL default — that lands on whatever local database the developer
 * already has installed. This is not hypothetical: the first run of this
 * harness connected to a local PostgreSQL instance rather than to the test
 * container, because both were bound to 5432 and the local one answered
 * first. It was stopped only by the password being wrong.
 *
 * A destructive harness must not share a port with the most common default in
 * the ecosystem.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/postgres';

/**
 * Refuse to touch anything that is not plainly a local throwaway.
 *
 * The guard is loopback-only. It cannot tell a test database from a real one
 * on the same host — nothing can, from a connection string — so the port
 * choice above is the other half of the protection, and the two together are
 * what make `DROP SCHEMA` an acceptable thing for a test to run.
 */
function assertDisposable(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    throw new Error(`TEST_DATABASE_URL is not a URL: ${url}`);
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(
      `Refusing to run the destructive test harness against a non-loopback host (${host}). ` +
        'These suites DROP SCHEMA public. Point TEST_DATABASE_URL at a throwaway database.',
    );
  }
  if (/supabase\.(com|co)$/.test(host)) {
    throw new Error('Refusing to run the test harness against Supabase.');
  }
}

assertDisposable(TEST_DATABASE_URL);

/**
 * The application reads `DATABASE_URL` through `serverEnv`, so it has to be
 * set before anything imports `@/db/client` — that module builds its pool at
 * import time. Assigning here, at the top of a module every suite imports
 * first, is what makes that ordering reliable.
 */
process.env.DATABASE_URL = TEST_DATABASE_URL;

/** Tables emptied between tests, children before parents. */
const TABLES_IN_DEPENDENCY_ORDER = [
  'notification_outbox',
  'stripe_event',
  'payment',
  'order_line',
  'checkout_attempt',
  '"order"',
  'audit_log',
  'stock_item',
  'business_day',
  'slot',
  'serviceable_fsa',
  'zone',
  'prep_option',
  'product',
  'customer',
  /*
   * ⚠ ADDED 2026-08-17, AND THEY HAD BEEN MISSING SINCE MIGRATION 0008.
   *
   * Nothing had noticed because no suite seeded a partner. The first one that
   * did failed on `partner_phone_active` — a driver seeded by one test was
   * still there for the next, so the second insert of the same number
   * collided. The symptom looked like a bug in the new test rather than a hole
   * in the harness, which is the expensive kind.
   *
   * ⭐ THE RULE THIS RESTATES: a migration that adds a table must add it here
   * in the same commit, or the leak stays invisible until a suite happens to
   * write to it.
   */
  /*
   * ⚠ Listed explicitly even though it CASCADEs from `delivery_partner`.
   * Relying on the cascade means the day somebody drops that FK, this table
   * silently starts leaking rows between tests — which is the same failure
   * that cost a run above, one level deeper and harder to see.
   */
  'driver_link',
  'delivery_partner',
  'shop_setting',
];

let migrated = false;

/**
 * Apply every migration in order, exactly as `drizzle-kit migrate` would.
 *
 * Read straight from the checked-in SQL rather than from the drizzle schema
 * object. If a migration and the schema ever disagree, this suite must fail —
 * production runs the migrations, not the schema, and a test harness that
 * builds its tables from the schema would be the one place that never noticed.
 */
export async function migrateTestDatabase(): Promise<void> {
  if (migrated) return;

  const pool = new Pool({ connectionString: TEST_DATABASE_URL, ssl: false, max: 1 });
  try {
    const dir = join(process.cwd(), 'src', 'db', 'migrations');
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // A clean slate every run. These suites own this database; sharing it with
    // anything else is not supported, and `DROP SCHEMA` says so unambiguously.
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');

    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      // drizzle's own separator. Splitting on bare semicolons would break
      // every function body and every CHECK containing one.
      for (const statement of sql.split('--> statement-breakpoint')) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) await pool.query(trimmed);
      }
    }
    migrated = true;
  } finally {
    await pool.end();
  }
}

/**
 * Empty every table, and do it with TRUNCATE rather than DELETE so a suite
 * that leaves a sequence advanced does not change the next suite's IDs.
 *
 * `IF EXISTS` per table because the increments land one at a time and a table
 * that does not exist yet is not an error here.
 */
export async function truncateAll(pool: Pool): Promise<void> {
  const existing: string[] = [];
  for (const table of TABLES_IN_DEPENDENCY_ORDER) {
    const bare = table.replaceAll('"', '');
    const { rows } = await pool.query('SELECT to_regclass($1) AS oid', [`public.${bare}`]);
    if (rows[0]?.oid) existing.push(table);
  }
  if (existing.length > 0) {
    await pool.query(`TRUNCATE ${existing.join(', ')} RESTART IDENTITY CASCADE`);
  }
  // catalog_version is seeded by migration 0001 and truncating it would delete
  // the single row P8 compares against. Reset it instead.
  await pool.query(
    `INSERT INTO catalog_version (id, version) VALUES (1, 1)
       ON CONFLICT (id) DO UPDATE SET version = 1`,
  );
}

/** A pool for direct SQL in tests — assertions, fixtures, and truncation. */
export function testPool(): Pool {
  return new Pool({ connectionString: TEST_DATABASE_URL, ssl: false, max: 10 });
}
