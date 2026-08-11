import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * End-to-end suite — a REAL Next.js server against a REAL PostgreSQL.
 *
 *   npm run db:test:up && npm run test:e2e
 *
 * Separate from `test:db` because it boots a web server, which is another
 * order of magnitude slower again and has a different failure mode: when this
 * suite goes red it is often the server that did not start rather than the
 * assertion that did not hold, and mixing the two makes both harder to read.
 *
 * There is no browser here. Every screen in this application is server
 * rendered, so driving it over HTTP exercises the routing, the guard, the
 * validation, the repositories, the domain and the SQL — all of it except the
 * client islands. What a browser would add is computed style and the two
 * `use client` forms, and that is written down as a gap rather than faked.
 */
export default defineConfig({
  resolve: {
    // ⚠ ORDER MATTERS — the '@' catch-all must come last. Same reasoning as
    // vitest.integration.config.ts.
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
    include: ['tests/e2e/**/*.test.ts'],
    fileParallelism: false,
    // A cold `next dev` compiles each route on its first request.
    testTimeout: 120_000,
    hookTimeout: 240_000,
  },
});
