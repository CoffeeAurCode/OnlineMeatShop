#!/usr/bin/env node
/**
 * Request-time half of the secret scan.
 *
 * WHY BUILD-OUTPUT SCANNING IS NOT ENOUGH
 * ---------------------------------------
 * scan-secrets.mjs Part B reads what `next build` produced, which catches
 * leaks on prerendered routes. But the admin console and every order route
 * will be `force-dynamic`: their HTML and RSC payloads are generated when a
 * request arrives and exist nowhere in the build output. A secret serialised
 * on one of those routes is invisible to a build-artifact scan and perfectly
 * visible to the customer's browser.
 *
 * So: start the real production server with canary secrets, request the
 * dynamic probe route, and read what actually comes back over HTTP.
 *
 * This is the check that would have caught the leak in the shape it will
 * actually occur.
 *
 * Usage: node scripts/scan-runtime.mjs      (expects a completed `next build`)
 */

import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const PORT = process.env.SCAN_PORT ?? '3987';
const BASE = `http://127.0.0.1:${PORT}`;

/** Must match the values CI builds with. */
const CANARIES = {
  SUPABASE_SERVICE_ROLE_KEY: 'cnry_service_role_MUST_NOT_SHIP',
  MONERIS_API_TOKEN: 'cnry_moneris_token_MUST_NOT_SHIP',
  STRIPE_SECRET_KEY: 'cnry_stripe_secret_MUST_NOT_SHIP',
  STRIPE_WEBHOOK_SECRET: 'cnry_stripe_webhook_MUST_NOT_SHIP',
  DATABASE_URL: 'cnry_database_url_MUST_NOT_SHIP',
  DIRECT_DATABASE_URL: 'cnry_direct_db_MUST_NOT_SHIP',
  TWILIO_AUTH_TOKEN: 'cnry_twilio_auth_MUST_NOT_SHIP',
  RESEND_API_KEY: 'cnry_resend_MUST_NOT_SHIP',
};

/**
 * Routes to fetch. Add every new dynamic route that touches secrets — an
 * admin page, a checkout step, an order detail view.
 */
/*
 * ⚠ A NEW DYNAMIC ROUTE THAT TOUCHES SECRETS MUST BE ADDED HERE.
 *
 * `/driver` is included because it is the one surface outside `/admin` that
 * renders behind a signed session and reads customer addresses — exactly the
 * shape where a server prop leaks into the RSC payload. Signed out it renders
 * the sign-in form, which is what this scan sees, and that is still worth
 * scanning: the layout runs either way.
 */
const ROUTES = ['/', '/healthz', '/driver', '/d/not-a-real-token'];

const env = { ...process.env, ...CANARIES, NODE_ENV: 'production', PORT };

console.log(`Starting production server on ${BASE} ...`);
// Spawn Next's JS entrypoint directly rather than via npx.
// Node 20+ refuses to spawn .cmd/.bat without a shell (CVE-2024-27980), and
// using a shell puts cmd.exe between us and the server, which then survives
// kill(). A plain .js file sidesteps both.
const nextBin = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
const server = spawn(process.execPath, [nextBin, 'start', '-p', PORT], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d.toString()));
server.stderr.on('data', (d) => (serverLog += d.toString()));

/**
 * Any HTTP response means the server is listening, which is all this needs to
 * know before it starts reading bodies.
 *
 * It deliberately does NOT require a 2xx. `/healthz` now reports database
 * reachability, and this scan runs with a canary `DATABASE_URL` that is not a
 * real database — so a healthy server correctly answers 503 here. Waiting for
 * `res.ok` would block until the timeout and then report "server did not
 * become ready", which is a confident and completely wrong diagnosis.
 */
async function waitForReady(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/healthz`);
      return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`::error::${msg}`);
};

try {
  if (!(await waitForReady())) {
    console.error(serverLog);
    throw new Error(`Server did not become ready on ${BASE}`);
  }
  console.log('Server ready. Fetching routes...\n');

  for (const route of ROUTES) {
    let body;
    try {
      const res = await fetch(`${BASE}${route}`, {
        // Ask for the RSC payload as well as the HTML — a leaked prop shows up
        // there even when the rendered markup looks innocent.
        headers: { RSC: '1' },
      });
      body = await res.text();
    } catch (err) {
      fail(`Could not fetch ${route}: ${err.message}`);
      continue;
    }

    let clean = true;
    for (const [name, canary] of Object.entries(CANARIES)) {
      if (body.includes(canary)) {
        clean = false;
        fail(
          `${route} response contains the canary for ${name}. In production that ` +
            `position would hold a real credential, sent to the browser.`,
        );
      }
    }
    console.log(`  ${clean ? 'clean' : 'LEAK '}  ${route}`);
  }
} finally {
  stopServer();
}

if (failed) {
  console.error('\nRuntime secret scan FAILED.');
  process.exit(1);
}
console.log('\nRuntime secret scan passed.');
// Explicit exit: `next start` can leave handles that keep the event loop
// alive even after the child is gone, and a scan that never returns looks
// exactly like a scan that is still working.
process.exit(0);

/**
 * Kill the whole process tree.
 *
 * `server.kill()` alone is not enough on Windows: spawning through a shell
 * puts cmd.exe between us and node, so killing the child kills the wrapper
 * and leaves the server holding the port. The symptom is a script that hangs
 * forever with no output — which is how this was found.
 */
function stopServer() {
  if (!server.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }
}
