import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_DATABASE_URL } from './helpers/db';

/**
 * ⭐ THE TWO STUBS CANNOT REACH PRODUCTION.
 *
 * Both are development stand-ins for something that has real consequences, and
 * both fail at STARTUP rather than at first use:
 *
 *   `StubPaymentAdapter`  places real orders and reserves real stock while
 *                         taking no money. Reaching production with it is the
 *                         most expensive failure this shop can have.
 *   `StubPhoneVerifier`   accepts one fixed code for every number, so anyone
 *                         who knows it can read anyone's order history.
 *
 * ⚠ A DEVELOPMENT BACKDOOR THAT SURVIVES TO PRODUCTION is the single most
 * common way this class of prototype becomes an incident. These are tests
 * rather than comments because the guard is one `if` and one `if` is easy to
 * delete while chasing something else.
 *
 * Lives in the integration suite despite touching no database, because both
 * modules are `server-only` and that import is stubbed by the integration
 * config alone.
 */

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  // `@/adapters/payments` pulls in the database client, which reads this at
  // import time. No query is ever run here; the pool just has to construct.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

/**
 * `NODE_ENV` is read-only in the type system and writable at runtime. Assigned
 * through `Object.defineProperty` because a plain assignment is refused under
 * this tsconfig, and the alternative would be an `any`.
 */
function setNodeEnv(value: string): void {
  Object.defineProperty(process.env, 'NODE_ENV', {
    value,
    configurable: true,
    writable: true,
    // Required: `process.env` refuses a descriptor that is not enumerable.
    enumerable: true,
  });
}

describe('the stub payment adapter', () => {
  it('⭐ REFUSES to construct in production', async () => {
    setNodeEnv('production');
    delete process.env.ALLOW_STUB_PAYMENTS;

    const { paymentAdapter } = await import('@/adapters/payments');
    expect(() => paymentAdapter()).toThrow(/must never be reached in production/);
  });

  it('is available in development without any flag', async () => {
    setNodeEnv('development');
    const { paymentAdapter } = await import('@/adapters/payments');
    expect(paymentAdapter().name).toBe('stub');
  });

  it('has ONE deliberate escape hatch, for a no-money demo deployment', async () => {
    // A demo deployment that takes no money is a coherent thing to want, and
    // it has to be asked for explicitly and in writing.
    setNodeEnv('production');
    process.env.ALLOW_STUB_PAYMENTS = 'true';

    const { paymentAdapter } = await import('@/adapters/payments');
    expect(paymentAdapter().name).toBe('stub');
  });

  it('is not fooled by a truthy-looking value', async () => {
    setNodeEnv('production');
    for (const value of ['1', 'yes', 'TRUE', ' true']) {
      process.env.ALLOW_STUB_PAYMENTS = value;
      vi.resetModules();
      const { paymentAdapter } = await import('@/adapters/payments');
      expect(() => paymentAdapter(), value).toThrow();
    }
  });
});

describe('the stub phone verifier', () => {
  it('⭐ REFUSES to construct in production, with NO escape hatch at all', async () => {
    // Deliberately unlike payments. There is no version of "hand out other
    // people's order history to anyone who knows the dev code" that is a
    // coherent thing to deploy.
    setNodeEnv('production');
    process.env.DEV_VERIFICATION_CODE = '000000';

    const { phoneVerifier } = await import('@/adapters/phone-verifier');
    expect(() => phoneVerifier()).toThrow(/never be reachable in production/);
  });

  it('reports itself unavailable in production rather than throwing at the caller', async () => {
    setNodeEnv('production');
    process.env.DEV_VERIFICATION_CODE = '000000';

    const { verificationAvailable } = await import('@/adapters/phone-verifier');
    expect(verificationAvailable()).toBe(false);
  });

  it('is unavailable when no code is configured, which is the safe default', async () => {
    setNodeEnv('development');
    delete process.env.DEV_VERIFICATION_CODE;

    const { phoneVerifier, verificationAvailable } = await import('@/adapters/phone-verifier');
    expect(verificationAvailable()).toBe(false);
    expect(() => phoneVerifier()).toThrow(/DEV_VERIFICATION_CODE is not set/);
  });

  it('accepts only the configured code, in development', async () => {
    setNodeEnv('development');
    process.env.DEV_VERIFICATION_CODE = '424242';

    const { phoneVerifier } = await import('@/adapters/phone-verifier');
    const verifier = phoneVerifier();

    expect(await verifier.check('+15145550100', '424242')).toBe(true);
    // Trimmed, because a pasted code often carries whitespace.
    expect(await verifier.check('+15145550100', ' 424242 ')).toBe(true);
    expect(await verifier.check('+15145550100', '000000')).toBe(false);
    expect(await verifier.check('+15145550100', '')).toBe(false);
  });

  it('leaves phone_verified_at unset, because it verifies nothing', async () => {
    // The seam, stated as a test: the stub must not pretend. Stamping the
    // column would tell every future reader that this number was proven.
    setNodeEnv('development');
    process.env.DEV_VERIFICATION_CODE = '424242';

    const { phoneVerifier } = await import('@/adapters/phone-verifier');
    expect(phoneVerifier().name).toBe('stub');
  });
});
