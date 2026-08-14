#!/usr/bin/env node
/**
 * Create or reset a staff account.
 *
 * There is deliberately NO sign-up route and no "create the first admin" page.
 * A self-service path to creating an account that can edit stock and money is
 * a door, and this shop needs exactly two accounts ever. Creating them from a
 * shell that already has the database URL is the smaller attack surface.
 *
 * Usage:
 *   SEED_DATABASE_URL=postgres://... node scripts/create-staff.mjs owner
 *
 * The password is READ FROM STDIN, never from an argument: an argument lands
 * in shell history and in the process list, where anyone on the box can read
 * it.
 *
 *   printf 'the-password' | node scripts/create-staff.mjs owner
 */

import { readFileSync } from 'node:fs';
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';

const scrypt = promisify(scryptCb);

try {
  process.loadEnvFile('.env.local');
} catch {
  /* expected in CI */
}

const username = process.argv[2];
if (!username) {
  console.error('Usage: printf <password> | node scripts/create-staff.mjs <username> [role]');
  process.exit(1);
}
const role = process.argv[3] ?? 'OWNER';
if (role !== 'OWNER' && role !== 'STAFF') {
  console.error(`role must be OWNER or STAFF, got ${role}`);
  process.exit(1);
}

const url = process.env.SEED_DATABASE_URL ?? process.env.DIRECT_DATABASE_URL;
if (!url) {
  console.error('Set SEED_DATABASE_URL or DIRECT_DATABASE_URL.');
  process.exit(1);
}

const password = (await readStdin()).replace(/\r?\n$/, '');
if (password.length < 12) {
  // Not a style preference. This account edits stock and money, it is reachable
  // from the public internet, and there are exactly two of them to remember.
  console.error('Password must be at least 12 characters.');
  process.exit(1);
}

/*
 * These parameters MUST match `src/auth/password.ts`. They are duplicated
 * because this script runs under plain node and cannot import a TypeScript
 * module, and the hash carries them anyway, so a drift here produces a hash
 * that still verifies rather than one that silently fails.
 */
const N = 32_768;
const R = 8;
const P = 1;
const salt = randomBytes(16);
const derived = await scrypt(password.normalize('NFKC'), salt, 64, {
  N,
  r: R,
  p: P,
  maxmem: 128 * N * R * 2,
});
const hash = `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;

function tls(connectionString) {
  const host = new URL(connectionString).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
  return { ca: readFileSync('certs/supabase-prod-ca-2021.crt', 'utf8'), rejectUnauthorized: true };
}

const client = new pg.Client({ connectionString: url, ssl: tls(url) });
await client.connect();
try {
  await client.query(
    `INSERT INTO staff (username, password_hash, role, active)
       VALUES ($1, $2, $3, true)
     ON CONFLICT (username) DO UPDATE SET
       password_hash = excluded.password_hash,
       role = excluded.role,
       active = true,
       failed_attempts = 0,
       locked_until = NULL,
       updated_at = now()`,
    [username.trim().toLowerCase(), hash, role],
  );
} finally {
  await client.end();
}

console.log(`Staff account ready: ${username.trim().toLowerCase()} (${role})`);

function readStdin() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      reject(new Error('Pipe the password in: printf <password> | node scripts/create-staff.mjs <user>'));
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
