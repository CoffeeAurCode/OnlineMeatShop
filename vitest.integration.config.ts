import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Integration and concurrency suites — they need a REAL PostgreSQL.
 *
 * Kept in a separate config, and out of `npm test`, for one reason: the pure
 * domain suite must stay fast enough to run on every save. A database in the
 * default suite makes the feedback loop slow enough that people stop running
 * it, and the domain tests are the ones that catch most defects.
 *
 *   npm run test:db      — against $TEST_DATABASE_URL (default: local docker)
 *
 * There is no mocking here on purpose. The things these suites verify —
 * row locks, CHECK constraints, deadlock ordering, transaction rollback — do
 * not exist in a fake, and a fake that pretended to have them would be
 * testing the fake.
 */
export default defineConfig({
  resolve: {
    // ⚠ ORDER MATTERS. Vite takes the FIRST entry whose key prefixes the
    // import, so the two specific aliases must precede the '@' catch-all.
    alias: {
      'server-only': fileURLToPath(
        new URL('./tests/integration/helpers/server-only-stub.ts', import.meta.url),
      ),
      '@/server-env': fileURLToPath(
        new URL('./tests/integration/helpers/server-env-stub.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts', 'tests/concurrency/**/*.test.ts'],
    // Suites share one database. Running files in parallel would have them
    // truncating each other's fixtures mid-assertion.
    fileParallelism: false,
    // A concurrency test that spawns 50 placements against a cold pool is not
    // a 5-second test.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
