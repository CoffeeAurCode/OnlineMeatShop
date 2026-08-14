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

/**
 * ⭐ THE STARTUP GUARD, which is what makes the two refusals above actually
 * mean "in production" rather than "at the first checkout".
 *
 * Both adapters are constructed inside route handlers, so on their own a
 * misconfigured deployment starts happily and fails at the worst possible
 * moment: a real customer, mid-checkout. `src/instrumentation.ts` runs once
 * before the server accepts a request, so the deploy fails its health check
 * and the previous version keeps serving instead.
 */
describe('the startup guard', () => {
  async function register(env: Record<string, string | undefined>) {
    setNodeEnv(env.NODE_ENV ?? 'production');
    process.env.NEXT_RUNTIME = 'nodejs';
    for (const [k, v] of Object.entries(env)) {
      if (k === 'NODE_ENV') continue;
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const mod = await import('@/instrumentation');
    return mod.register();
  }

  const GOOD = {
    ALLOW_STUB_PAYMENTS: 'true',
    STAFF_SESSION_SECRET: 'a-secret-that-is-at-least-32-characters-long',
    DEV_VERIFICATION_CODE: undefined,
  };

  it('⭐ REFUSES TO START with no payment adapter configured', async () => {
    await expect(register({ ...GOOD, ALLOW_STUB_PAYMENTS: undefined })).rejects.toThrow(
      /No real payment adapter is configured/,
    );
  });

  it('⭐ REFUSES TO START with no staff session secret', async () => {
    // Safe but silently useless: the console fails closed and the owner finds
    // out at 6am on the first trading day.
    await expect(register({ ...GOOD, STAFF_SESSION_SECRET: undefined })).rejects.toThrow(
      /STAFF_SESSION_SECRET is missing/,
    );
  });

  it('refuses a session secret that is too short to be one', async () => {
    await expect(register({ ...GOOD, STAFF_SESSION_SECRET: 'short' })).rejects.toThrow(
      /STAFF_SESSION_SECRET is missing or shorter/,
    );
  });

  it('⭐ REFUSES TO START with the dev verification code set', async () => {
    // The one that is a security problem rather than an availability one.
    await expect(register({ ...GOOD, DEV_VERIFICATION_CODE: '424242' })).rejects.toThrow(
      /would expose order history/,
    );
  });

  it('reports EVERY problem at once, not just the first', async () => {
    // An operator fixing these one deploy at a time is an operator doing four
    // deploys to find four variables.
    await expect(
      register({ ALLOW_STUB_PAYMENTS: undefined, STAFF_SESSION_SECRET: undefined }),
    ).rejects.toThrow(/2 configuration problem/);
  });

  it('starts when the deployment is configured deliberately', async () => {
    await expect(register(GOOD)).resolves.toBeUndefined();
  });

  it('does not interfere outside production', async () => {
    // Development has none of these set and must not be blocked by any of it.
    await expect(
      register({ NODE_ENV: 'development', ALLOW_STUB_PAYMENTS: undefined, STAFF_SESSION_SECRET: undefined }),
    ).resolves.toBeUndefined();
  });
});
