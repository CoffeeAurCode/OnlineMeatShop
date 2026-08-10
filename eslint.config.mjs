import next from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * The domain-purity rules below are the mechanically enforced half of the
 * project's most important convention: src/domain/** must contain pure
 * functions with no I/O.
 *
 * A convention that isn't enforced is a convention that is already broken.
 * If you find yourself wanting to disable one of these, you are about to
 * make a mistake — see CLAUDE.md.
 */
const domainPurity = {
  name: 'domain/purity',
  files: ['src/domain/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['next', 'next/*', 'server-only', 'client-only'],
            message:
              'src/domain must stay framework-free. Move this to src/app or src/adapters.',
          },
          {
            group: ['*/db', '*/db/*', '@/db', '@/db/*', 'drizzle-orm', 'drizzle-orm/*', 'pg'],
            message:
              'src/domain must not touch the database. Pass the data in as an argument.',
          },
          {
            group: ['stripe', 'stripe/*', '@stripe/*'],
            message:
              'src/domain must not call Stripe. Put it behind an adapter in src/adapters/payments.',
          },
          {
            group: ['*/adapters', '*/adapters/*', '@/adapters', '@/adapters/*'],
            message:
              'src/domain must not depend on adapters. Dependencies point inward, not outward.',
          },
          {
            group: ['resend', 'twilio', 'node-fetch', 'axios', 'undici', 'got'],
            message: 'src/domain must not perform I/O of any kind.',
          },
          {
            // Node built-ins, both prefixed and bare. Without these the rule
            // catches libraries but waves through `import fs from "node:fs"`,
            // which is the most direct I/O available.
            group: [
              'node:*',
              'fs',
              'fs/*',
              'path',
              'os',
              'http',
              'https',
              'net',
              'dgram',
              'child_process',
              'worker_threads',
              'cluster',
              'crypto',
              'timers',
              'timers/*',
              'process',
              'stream',
              'zlib',
              'readline',
              'v8',
              'vm',
              'perf_hooks',
              'inspector',
              'diagnostics_channel',
            ],
            message:
              'src/domain must not use Node built-ins — that is I/O, the environment, or a clock. Pass the data in.',
          },
        ],
      },
    ],

    // Time is an INPUT to domain functions, never something they read.
    // The formal spec already models `now?` as a parameter to PlaceOrder.
    // Reading the clock inside the domain makes it untestable and non-deterministic.
    'no-restricted-properties': [
      'error',
      {
        object: 'Date',
        property: 'now',
        message: 'Pass `now` in as a parameter. See CLAUDE.md — time is an input.',
      },
      {
        object: 'Math',
        property: 'random',
        message: 'Domain functions must be deterministic. Pass randomness in.',
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: "NewExpression[callee.name='Date'][arguments.length=0]",
        message: 'Pass `now` in as a parameter. See CLAUDE.md — time is an input.',
      },
      {
        // Money is integer cents. Floats silently lose money.
        selector: "MemberExpression[object.name='Math'][property.name='round']",
        message:
          'Rounding money? Use the explicit ceil rule in src/domain/pricing.ts. See CLAUDE.md.',
      },
      {
        // `no-restricted-globals` only matches BARE identifiers, so it misses
        // `globalThis.fetch(...)` and `global.process.env` entirely. Without
        // these selectors the boundary is trivially bypassed — accidentally or
        // otherwise. Found by review, after the narrower rule was mistakenly
        // described as enforcing "no I/O of any kind".
        selector:
          "MemberExpression[object.name=/^(globalThis|global|window|self)$/][property.name=/^(fetch|process|setTimeout|setInterval|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|crypto|performance|Date)$/]",
        message:
          'src/domain must not reach the host environment, even via globalThis. Pass it in.',
      },
      {
        selector: "MemberExpression[object.name='Date'][property.name='parse']",
        message: 'Parse dates at the boundary, not in the domain. Pass the value in.',
      },
      {
        selector: "AwaitExpression",
        message:
          'src/domain is synchronous and pure. If you need to await something, it belongs in src/adapters or src/db.',
      },
    ],
    'no-restricted-globals': [
      'error',
      { name: 'fetch', message: 'src/domain must not perform I/O.' },
      { name: 'process', message: 'src/domain must not read the environment.' },
      { name: 'XMLHttpRequest', message: 'src/domain must not perform I/O.' },
      { name: 'WebSocket', message: 'src/domain must not perform I/O.' },
      { name: 'localStorage', message: 'src/domain must not touch browser storage.' },
      { name: 'sessionStorage', message: 'src/domain must not touch browser storage.' },
      { name: 'setTimeout', message: 'src/domain must not schedule. Time is an input.' },
      { name: 'setInterval', message: 'src/domain must not schedule. Time is an input.' },
      { name: 'performance', message: 'src/domain must not read a clock.' },
    ],
  },
};

const config = [
  ...next,
  ...nextTs,
  { ignores: ['.next/**', 'node_modules/**', 'drizzle/**'] },
  domainPurity,
];

export default config;
