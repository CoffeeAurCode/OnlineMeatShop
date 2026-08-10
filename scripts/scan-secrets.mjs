#!/usr/bin/env node
/**
 * Two-part guard against shipping a server secret to the browser.
 *
 * WHY THE OBVIOUS CHECK DOES NOT WORK
 * -----------------------------------
 * The first version of this grepped the built bundle for strings like
 * "SUPABASE_SERVICE_ROLE_KEY". That cannot work. Next.js replaces every
 * `process.env.NEXT_PUBLIC_*` reference with its VALUE at build time, so the
 * variable name never appears in the output — only the secret does. And in CI
 * no real values are set, so anything referenced compiles to `undefined`. The
 * check passed on every build and would have passed on a real leak too.
 *
 * So:
 *   Part A — refuse the naming mistake at source. A secret can only reach the
 *            browser if someone gives it a NEXT_PUBLIC_ name; catch that.
 *   Part B — build with canary VALUES for the names people get wrong, then
 *            look for the canaries in the output. If a canary appears, that
 *            value would have been a real credential in production.
 *
 * Part B also catches the subtler leak: a server component reading a secret
 * and passing it as a prop to a client component, which serialises it into
 * the RSC payload in the HTML.
 *
 * Run locally:  npm run scan:secrets
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const SOURCE_DIRS = ['src'];
const BUILD_DIRS = ['.next/static', '.next/server', '.next/standalone'];
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

/**
 * Public-prefixed names that must never exist. If any of these is referenced,
 * its value is inlined into the browser bundle by design — the framework is
 * working correctly and the name is the bug.
 */
const FORBIDDEN_PUBLIC_NAMES = [
  /NEXT_PUBLIC_\w*SERVICE_ROLE\w*/i,
  /NEXT_PUBLIC_\w*SECRET\w*/i,
  /NEXT_PUBLIC_\w*PRIVATE\w*/i,
  /NEXT_PUBLIC_\w*PASSWORD\w*/i,
  /NEXT_PUBLIC_\w*TOKEN\w*/i,
  /NEXT_PUBLIC_\w*CREDENTIAL\w*/i,
  /NEXT_PUBLIC_STRIPE_SECRET\w*/i,
  /NEXT_PUBLIC_DATABASE_URL/i,
  /NEXT_PUBLIC_DIRECT_DATABASE_URL/i,
  /NEXT_PUBLIC_TWILIO_AUTH\w*/i,
  /NEXT_PUBLIC_RESEND\w*/i,
];

/**
 * Canary values injected at build time. The key is the env var; the value is a
 * marker we then hunt for. Server-only names are included deliberately: if one
 * shows up in client output, something serialised it across the boundary.
 */
export const CANARIES = {
  SUPABASE_SERVICE_ROLE_KEY: 'cnry_service_role_MUST_NOT_SHIP',
  STRIPE_SECRET_KEY: 'cnry_stripe_secret_MUST_NOT_SHIP',
  STRIPE_WEBHOOK_SECRET: 'cnry_stripe_webhook_MUST_NOT_SHIP',
  DATABASE_URL: 'cnry_database_url_MUST_NOT_SHIP',
  DIRECT_DATABASE_URL: 'cnry_direct_db_MUST_NOT_SHIP',
  TWILIO_AUTH_TOKEN: 'cnry_twilio_auth_MUST_NOT_SHIP',
  RESEND_API_KEY: 'cnry_resend_MUST_NOT_SHIP',
  // The mistaken public names. If code references one, Next inlines the value.
  NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'cnry_public_service_role_MUST_NOT_SHIP',
  NEXT_PUBLIC_STRIPE_SECRET_KEY: 'cnry_public_stripe_secret_MUST_NOT_SHIP',
};

/** `.next/static` is the browser bundle; the rest can still reach the client via RSC payloads. */
const CLIENT_REACHABLE = ['.next/static', '.next/server', '.next/standalone'];

function walk(dir, exts = null) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...walk(full, exts));
    else if (!exts || exts.has(extname(full))) out.push(full);
  }
  return out;
}

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`::error::${msg}`);
};

// ── Part A: no secret-shaped NEXT_PUBLIC_ names anywhere in source ────────
console.log('Part A — scanning source for public-prefixed secret names...');
let sourceFiles = 0;
for (const dir of SOURCE_DIRS) {
  for (const file of walk(dir, SOURCE_EXTS)) {
    sourceFiles++;
    const text = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN_PUBLIC_NAMES) {
      const hit = text.match(pattern);
      if (hit) {
        fail(
          `${file}: "${hit[0]}" — a NEXT_PUBLIC_ prefix publishes this value to every visitor's browser. ` +
            `Drop the prefix and read it server-side only.`,
        );
      }
    }
  }
}
console.log(`  ${sourceFiles} source files scanned.`);

// Same check over .env.example, where the mistake is equally easy to make.
try {
  const example = readFileSync('.env.example', 'utf8');
  for (const pattern of FORBIDDEN_PUBLIC_NAMES) {
    const hit = example.match(pattern);
    if (hit) fail(`.env.example: "${hit[0]}" documents a secret under a public name.`);
  }
} catch {
  /* absent is fine */
}

// ── Part B: no canary values in anything the client can reach ─────────────
const buildPresent = BUILD_DIRS.some((d) => {
  try {
    return statSync(d).isDirectory();
  } catch {
    return false;
  }
});

if (!buildPresent) {
  console.log('Part B — skipped: no build output. Run `npm run build` first.');
  if (process.env.CI) {
    fail('Part B cannot be skipped in CI. The build must run before this scan.');
  }
} else {
  console.log('Part B — scanning build output for canary values...');
  let scanned = 0;
  for (const dir of CLIENT_REACHABLE) {
    for (const file of walk(dir)) {
      scanned++;
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const [name, canary] of Object.entries(CANARIES)) {
        if (text.includes(canary)) {
          fail(
            `${file} contains the canary for ${name}. In production that position would hold a ` +
              `real credential. Something is serialising a server secret toward the client.`,
          );
        }
      }
    }
  }
  console.log(`  ${scanned} build artifacts scanned.`);
}

if (failed) {
  console.error('\nSecret scan FAILED.');
  process.exit(1);
}
console.log('\nSecret scan passed.');
