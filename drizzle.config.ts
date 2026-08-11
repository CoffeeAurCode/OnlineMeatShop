import { defineConfig } from 'drizzle-kit';

import { postgresTls } from './src/db/ssl';

/**
 * Drizzle Kit configuration — schema generation and migration application.
 *
 * This runs under the `drizzle-kit` CLI in plain Node, not inside Next.js, so
 * it cannot import `@/server-env` (that module is `server-only` and would
 * throw). Reading `process.env` directly here is correct and is why this file
 * lives outside `src/`.
 *
 * `DIRECT_DATABASE_URL`, NOT `DATABASE_URL`
 * -----------------------------------------
 * Migrations issue DDL, take locks and must hold a stable session, none of
 * which survive a transaction pooler that hands the connection back after
 * every statement. So this uses the **session** pooler (port 5432).
 *
 * That is emphatically not the same thing as the "direct connection" string
 * the Supabase dashboard shows, `db.<ref>.supabase.co:5432`. That hostname
 * publishes an AAAA record and no A record — it is IPv6-only. GitHub Actions
 * runners have no IPv6, so the migration job would fail there with
 * `ENOTFOUND`, an error that reads like a typo rather than like a network
 * capability mismatch. Measured, both ways, on 2026-08-10. Use the pooler
 * hostname on port 5432.
 *
 * Migrations are applied by a CI job and never at application startup: with
 * health-check-gated deploys two app versions are briefly live at once and
 * would race the same migration, and a failure would become a crash-loop
 * instead of a failed pipeline.
 */

// Node 21+ built-in. Present for local runs, absent in CI, where the value
// arrives as a real environment variable.
try {
  process.loadEnvFile('.env.local');
} catch {
  /* no .env.local — expected in CI */
}

const url = process.env.DIRECT_DATABASE_URL;
if (!url) {
  throw new Error(
    'DIRECT_DATABASE_URL is not set. It is the SESSION pooler ' +
      '(aws-0-<region>.pooler.supabase.com:5432), not db.<ref>.supabase.co.',
  );
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url,
    // The SAME decision the application makes, from the same function, rather
    // than a second copy of it. This file used to inline the pinned CA, so the
    // two could drift — and did: both demanded TLS unconditionally, which made
    // it impossible to run migrations against the local or CI Postgres that
    // the integration suite needs. See src/db/ssl.ts.
    ssl: postgresTls(url),
  },

  // Forward-only, checked into git. Refuse to generate anything that would
  // drop or truncate without an explicit prompt.
  strict: true,
  verbose: true,
});
