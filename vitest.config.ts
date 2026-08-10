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
    include: ['tests/**/*.test.ts'],
    // Integration and concurrency suites need a real Postgres and are added
    // with increments 2 and 4. They will run in a separate CI step so a slow
    // database never blocks the fast pure-domain feedback loop.
    exclude: ['node_modules/**', '.next/**'],
  },
});
