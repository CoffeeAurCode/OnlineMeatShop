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
/**
 * Packages src/domain may import. Everything else is refused.
 *
 * The bar: no I/O, no ambient state, no clock. A package here must be a pure
 * computation over values passed to it. Adding to this list is a decision, not
 * a convenience — say why in the commit message.
 */
const DOMAIN_ALLOWED_PACKAGES = ['zod', 'decimal\\.js'];

/** Relative imports (other domain modules), plus the allowlist above. */
const DOMAIN_ALLOWED_IMPORT = `^(\\.\\.?\\/|${DOMAIN_ALLOWED_PACKAGES.map((p) => `${p}$`).join('|')})`;

const domainPurity = {
  name: 'domain/purity',
  files: ['src/domain/**/*.ts'],
  rules: {
    /**
     * ALLOWLIST, not a denylist.
     *
     * The previous version enumerated forbidden modules — next, drizzle, pg,
     * stripe, node builtins — and was therefore incomplete by construction.
     * Review demonstrated the gap by importing `@/server-env` from a domain
     * file: a first-party module, on nobody's denylist, that hands out the
     * database URL and every API credential.
     *
     * You cannot enumerate every way to reach I/O. You can enumerate the small
     * set of things a pure function legitimately needs. So the rule is
     * inverted: anything that is not a sibling domain module or an explicitly
     * approved pure package is refused, including first-party code, dynamic
     * imports and re-exports.
     */
    'no-restricted-syntax': [
      'error',
      {
        selector: `ImportDeclaration[source.value!=/${DOMAIN_ALLOWED_IMPORT}/]`,
        message:
          'src/domain may only import other domain modules or an approved pure package. See DOMAIN_ALLOWED_PACKAGES in eslint.config.mjs.',
      },
      {
        selector: `ImportExpression[source.value!=/${DOMAIN_ALLOWED_IMPORT}/]`,
        message: 'src/domain may not dynamically import outside the domain.',
      },
      {
        selector: `ExportNamedDeclaration[source.type='Literal'][source.value!=/${DOMAIN_ALLOWED_IMPORT}/]`,
        message: 'src/domain may not re-export from outside the domain.',
      },
      {
        selector: `ExportAllDeclaration[source.type='Literal'][source.value!=/${DOMAIN_ALLOWED_IMPORT}/]`,
        message: 'src/domain may not re-export from outside the domain.',
      },
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
        // `globalThis.fetch(...)` entirely.
        selector:
          "MemberExpression[computed=false][object.name=/^(globalThis|global|window|self)$/][property.name=/^(fetch|process|setTimeout|setInterval|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|crypto|performance|Date)$/]",
        message:
          'src/domain must not reach the host environment, even via globalThis. Pass it in.',
      },
      {
        // …and dotted access misses `globalThis['fetch']`. Refuse ALL computed
        // access on the global object rather than trying to list the spellings.
        selector:
          "MemberExpression[computed=true][object.name=/^(globalThis|global|window|self)$/]",
        message:
          'src/domain must not reach the host environment by computed property either.',
      },
      {
        selector: "MemberExpression[object.name='Date'][property.name='parse']",
        message: 'Parse dates at the boundary, not in the domain. Pass the value in.',
      },
      {
        selector: 'AwaitExpression',
        message:
          'src/domain is synchronous and pure. If you need to await something, it belongs in src/adapters or src/db.',
      },
    ],

    /**
     * Kept as a second layer beneath the allowlist. If the allowlist is ever
     * relaxed, these named capabilities still produce a specific, readable
     * error rather than silently becoming reachable.
     */
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
