import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration and concurrency suites need a real Postgres and are added
    // with increments 2 and 4. They will run in a separate CI step so a slow
    // database never blocks the fast pure-domain feedback loop.
    exclude: ['node_modules/**', '.next/**'],
  },
});
