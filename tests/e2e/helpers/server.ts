import { spawn, type ChildProcess } from 'node:child_process';

import { TEST_DATABASE_URL } from '../../integration/helpers/db';

/**
 * Boot the application for the duration of a suite.
 *
 * ⚠ `.env.local` IN THIS CHECKOUT POINTS AT THE REAL SUPABASE PROJECT, and
 * `next dev` loads it. What keeps this suite off production data is that
 * `@next/env` does not overwrite a variable that is already set in the
 * process environment, so the `DATABASE_URL` passed below wins.
 *
 * That is a guarantee about a third party's precedence rules, which is not
 * something to take on trust when the downside is a test suite writing to the
 * live shop. `console.test.ts` therefore ASSERTS it: the first thing it checks
 * is that a product seeded into the throwaway database is visible through the
 * server. If precedence ever changed, that assertion fails before anything is
 * written.
 *
 * `next dev`, not `next start`, and that is forced rather than lazy: the admin
 * guard refuses outright when `NODE_ENV=production`, which is exactly what
 * `next start` sets. That refusal is the guard's most important property while
 * staff sign-in does not exist, so the test runs the app in the only mode in
 * which the console is reachable at all.
 *
 * The consequence is written down rather than worked around: **this suite does
 * not exercise a production build.** `npm run build` covers that separately.
 */

export const E2E_PORT = 3987;
export const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;
export const E2E_STAFF_USER = 'e2e-owner';
export const E2E_STAFF_PASSWORD = 'e2e-console-password';
/** At least 32 characters, or the guard fails closed and every admin test 404s. */
export const E2E_SESSION_SECRET = 'e2e-staff-session-secret-of-sufficient-length';

/**
 * The fixed code `StubPhoneVerifier` accepts, for the CUSTOMER sign-in.
 *
 * ⭐ THE SUITE RUNS AGAINST THE STUB VERIFIER ON PURPOSE, AND THE ENV BELOW
 * IS WHAT FORCES IT.
 *
 * `phoneVerifier()` prefers Supabase whenever `NEXT_PUBLIC_SUPABASE_*` are
 * set — and `.env.local` in this checkout sets them, pointing at the REAL
 * project. Without blanking them here, every e2e run would ask Supabase to
 * send a real SMS to a fictional number, would fail in CI (no credentials, no
 * network to it), and would bill the shop for the privilege.
 *
 * Blanking them plus setting this code selects the stub, which exercises every
 * part of the flow that belongs to this codebase — the routes, the
 * normalisation, the customer upsert, the signed cookie, the checkout gate —
 * and fakes only the one part that belongs to a phone network.
 */
export const E2E_VERIFICATION_CODE = '424242';
/** Fictional, per CLAUDE.md §1. Reserved 555 range, so it cannot be anybody. */
export const E2E_CUSTOMER_PHONE = '+15145550142';

/**
 * The signed session cookie, obtained ONCE by actually signing in.
 *
 * Deliberately not forged locally. Going through `/api/admin/login` means the
 * console suite exercises the real door -- password verification, session
 * issuing, and the cookie attributes -- rather than a test-only shortcut that
 * could keep passing after the real login broke.
 */
let staffCookie: string | null = null;

let server: ChildProcess | null = null;

export async function startServer(): Promise<void> {
  if (server !== null) return;

  server = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['next', 'dev', '--port', String(E2E_PORT), '--hostname', '127.0.0.1'],
    {
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
        STAFF_SESSION_SECRET: E2E_SESSION_SECRET,
        SHOP_TIMEZONE: 'America/Toronto',
        /*
         * ⚠ EMPTY STRINGS, NOT ABSENT. `@next/env` will not overwrite a
         * variable that is already SET in the process environment, and an
         * empty string counts as set — so this is what actually stops
         * `.env.local`'s real Supabase project reaching the suite.
         * `phoneVerifier()` treats '' as absent and falls through to the stub.
         */
        NEXT_PUBLIC_SUPABASE_URL: '',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
        DEV_VERIFICATION_CODE: E2E_VERIFICATION_CODE,
        NODE_ENV: 'development',
        // Fictional, per CLAUDE.md §1. These make the sitemap, the canonical
        // URLs and the JSON-LD deterministic so the suite can assert on them.
        NEXT_PUBLIC_SHOP_NAME: 'Test Butcher Ltd',
        NEXT_PUBLIC_SITE_ORIGIN: 'https://shop.example.invalid',
        DELIVERY_TOWNS: 'sample-town|Sample Town',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    },
  );

  const log: string[] = [];
  server.stdout?.on('data', (d: Buffer) => log.push(d.toString()));
  server.stderr?.on('data', (d: Buffer) => log.push(d.toString()));

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${E2E_ORIGIN}/healthz`);
      // 200 means the server is up AND reached the database. A 503 means it is
      // listening but the database is not there, which is worth waiting out
      // briefly in case the container is still accepting connections.
      if (res.status === 200) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  await stopServer();
  throw new Error(`next dev did not become healthy in 180s.\n${log.join('')}`);
}

export async function stopServer(): Promise<void> {
  if (server === null) return;
  const child = server;
  server = null;

  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    // On Windows a plain kill leaves the real node process behind, because
    // `npx` is the child and `next` is its grandchild.
    if (process.platform === 'win32' && child.pid !== undefined) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
    setTimeout(resolve, 10_000);
  });
}

/**
 * One request builder for both callers.
 *
 * `body` is assigned only when there is one. Under
 * `exactOptionalPropertyTypes` an explicit `body: undefined` is not the same
 * as an absent `body`, and `RequestInit` refuses the former.
 */
function request(path: string, json: unknown, cookie: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie !== null) headers.cookie = cookie;
  if (json !== undefined) headers['content-type'] = 'application/json';

  const init: RequestInit = { method: json === undefined ? 'GET' : 'POST', headers };
  if (json !== undefined) init.body = JSON.stringify(json);

  return fetch(`${E2E_ORIGIN}${path}`, init);
}

/**
 * Create the staff account and sign in, once per suite.
 *
 * Called by `startServer`, so no test has to remember to do it. The account is
 * created directly in the database because there is deliberately no sign-up
 * route -- see `scripts/create-staff.mjs`.
 */
export async function signInAsStaff(): Promise<void> {
  const { upsertStaff } = await import('@/db/repositories/staff');
  await upsertStaff(E2E_STAFF_USER, E2E_STAFF_PASSWORD);

  const res = await fetch(`${E2E_ORIGIN}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: E2E_STAFF_USER, password: E2E_STAFF_PASSWORD }),
  });
  if (!res.ok) throw new Error(`console sign-in failed: ${res.status} ${await res.text()}`);

  const setCookie = res.headers.get('set-cookie');
  if (setCookie === null) throw new Error('sign-in returned no session cookie');
  staffCookie = setCookie.split(';')[0] ?? null;
  if (staffCookie === null) throw new Error('could not read the session cookie');
}

/** A request as the signed-in owner. */
export function asStaff(path: string, init: { json?: unknown } = {}): Promise<Response> {
  if (staffCookie === null) {
    throw new Error('call signInAsStaff() before asStaff()');
  }
  return request(path, init.json, staffCookie);
}

/** The same request with no console cookie at all. */
export function asStranger(path: string, init: { json?: unknown } = {}): Promise<Response> {
  return request(path, init.json, null);
}

let customerCookie: string | null = null;

/**
 * Sign a CUSTOMER in, through the real routes.
 *
 * ⭐ NOT FORGED. Same principle as `signInAsStaff`: it goes through
 * `/api/auth/otp` and `/api/auth/verify`, so the suite exercises the real
 * door — normalisation, the verifier seam, the customer upsert, the
 * `phone_verified_at` stamp and the signed cookie. Only the OTP PROVIDER is a
 * stub, because the alternative is a phone network.
 *
 * A test-only helper that minted the cookie directly would keep passing after
 * the verify route broke, which is the failure this project has already been
 * bitten by once on the tracking page.
 */
export async function signInAsCustomer(phone = E2E_CUSTOMER_PHONE): Promise<string> {
  const start = await fetch(`${E2E_ORIGIN}/api/auth/otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  if (!start.ok) throw new Error(`otp start failed: ${start.status} ${await start.text()}`);

  const res = await fetch(`${E2E_ORIGIN}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code: E2E_VERIFICATION_CODE }),
  });
  if (!res.ok) throw new Error(`customer sign-in failed: ${res.status} ${await res.text()}`);

  const setCookie = res.headers.get('set-cookie');
  if (setCookie === null) throw new Error('verify returned no session cookie');
  const cookie = setCookie.split(';')[0] ?? null;
  if (cookie === null) throw new Error('could not read the customer cookie');
  customerCookie = cookie;
  return cookie;
}

/**
 * A request as a signed-in customer.
 *
 * ⚠ CHECKOUT NOW REFUSES WITHOUT THIS (`signInRequired`, 401), and refuses
 * again if the body's phone is not the one the cookie proves
 * (`phoneMismatch`, 409). Any test placing an order has to use this, and has
 * to send `E2E_CUSTOMER_PHONE` in the body.
 */
export async function asCustomer(
  path: string,
  init: { json?: unknown } = {},
): Promise<Response> {
  if (customerCookie === null) await signInAsCustomer();
  return request(path, init.json, customerCookie);
}
