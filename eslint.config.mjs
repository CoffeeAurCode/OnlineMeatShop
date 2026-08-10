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
            group: ['resend', 'twilio', 'node-fetch', 'axios', 'undici'],
            message: 'src/domain must not perform I/O of any kind.',
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
    ],
    'no-restricted-globals': [
      'error',
      { name: 'fetch', message: 'src/domain must not perform I/O.' },
      { name: 'process', message: 'src/domain must not read the environment.' },
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
