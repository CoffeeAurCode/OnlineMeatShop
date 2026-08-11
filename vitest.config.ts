import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirrors the `@/*` path in tsconfig.json. Without it a test importing
  // `@/domain/pricing` fails to resolve, and the workaround — deep relative
  // paths — makes tests break when a file moves.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    /**
     * The FAST suite: pure domain, plus the lint probes and the TLS decision.
     *
     * Integration and concurrency live in vitest.integration.config.ts and are
     * deliberately NOT matched here. They need a real Postgres, and a database
     * in the default suite makes the loop slow enough that people stop running
     * it — which costs more than it catches, because the domain tests find
     * most defects.
     */
    include: ['tests/domain/**/*.test.ts', 'tests/lint/**/*.test.ts', 'tests/db/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', 'tests/integration/**', 'tests/concurrency/**'],
  },
});
