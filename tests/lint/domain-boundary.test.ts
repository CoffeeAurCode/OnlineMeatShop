import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Executable tests for the src/domain purity boundary.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The boundary was originally verified by hand: write a file that violates it,
 * run eslint, watch it fail, delete the file. That proved the rules I had
 * written worked — and said nothing about the rules I had *not* written.
 * A review then showed `node:fs`, `child_process` and `globalThis.fetch` all
 * passed cleanly, while the documentation claimed "no I/O of any kind".
 *
 * A manual probe verifies a moment. This file verifies every commit.
 *
 * When you add a rule to the domain block in eslint.config.mjs, add a probe
 * here. When you are tempted to relax one, this file is where you will find
 * out what you are actually giving up.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Loading the real config chain (eslint-config-next + the TypeScript parser)
 * costs roughly a minute on first use, then microseconds per lint. Warming it
 * here keeps that one-off cost out of the first test's budget, where it looked
 * like a failure rather than a slow import.
 *
 * These probes deliberately run against the PRODUCTION config rather than a
 * trimmed-down one. A cheaper harness would test rules that are not the rules
 * actually in force, which is the failure mode this whole file exists to catch.
 */
const BOOT_TIMEOUT_MS = 180_000;
const CASE_TIMEOUT_MS = 30_000;

let eslint: ESLint;
beforeAll(async () => {
  eslint = new ESLint({ cwd: repoRoot });
  await eslint.lintText('export const warmup = 1;\n', {
    filePath: path.join(repoRoot, 'src/domain/__warmup__.ts'),
    warnIgnored: false,
  });
}, BOOT_TIMEOUT_MS);

/** Lint a snippet as if it lived in src/domain, and return its error count. */
async function errorsInDomain(code: string): Promise<number> {
  const results = await eslint.lintText(code, {
    filePath: path.join(repoRoot, 'src/domain/__lint_probe__.ts'),
    warnIgnored: false,
  });
  return results.reduce((n, r) => n + r.errorCount, 0);
}

/** The same snippet outside the domain, where it is perfectly legitimate. */
async function errorsInAdapters(code: string): Promise<number> {
  const results = await eslint.lintText(code, {
    filePath: path.join(repoRoot, 'src/adapters/__lint_probe__.ts'),
    warnIgnored: false,
  });
  return results.reduce((n, r) => n + r.errorCount, 0);
}

// Each entry must produce at least one ESLint error inside src/domain.
const forbidden: ReadonlyArray<readonly [string, string]> = [
  ['framework import', `import { NextResponse } from 'next/server'; export const a = NextResponse;`],
  ['database driver', `import { drizzle } from 'drizzle-orm/node-postgres'; export const a = drizzle;`],
  ['raw pg', `import pg from 'pg'; export const a = pg;`],
  ['payment SDK', `import Stripe from 'stripe'; export const a = Stripe;`],
  ['adapter layer', `import { x } from '@/adapters/payments'; export const a = x;`],
  ['http client', `import axios from 'axios'; export const a = axios;`],

  // Node built-ins — the gap the review found. Both prefixed and bare.
  ['node: filesystem', `import fs from 'node:fs'; export const a = fs;`],
  ['bare filesystem', `import fs from 'fs'; export const a = fs;`],
  ['child_process', `import { exec } from 'child_process'; export const a = exec;`],
  ['node: http', `import http from 'node:http'; export const a = http;`],
  ['path', `import path from 'path'; export const a = path;`],
  ['crypto', `import crypto from 'node:crypto'; export const a = crypto;`],

  // Ambient capabilities, bare.
  ['bare fetch', `export const a = () => fetch('https://example.com');`],
  ['bare process', `export const a = () => process.env.SECRET;`],
  ['setTimeout', `export const a = () => setTimeout(() => {}, 1);`],

  // Ambient capabilities, qualified — the second half of the gap.
  ['globalThis.fetch', `export const a = () => globalThis.fetch('https://example.com');`],
  ['globalThis.process', `export const a = () => globalThis.process.env.SECRET;`],
  ['global.fetch', `export const a = () => (global as any).fetch('https://x.com');`],
  ['window.localStorage', `export const a = () => (window as any).localStorage.getItem('k');`],

  // ── Adversarial probes from the second review ──────────────────────────
  // The denylist caught named I/O libraries but waved through first-party
  // modules and computed property access. A denylist cannot enumerate every
  // route to I/O; these two are why the rule is now an allowlist.
  [
    'first-party @/server-env (hands out every credential)',
    `import { serverEnv } from '@/server-env'; export const a = () => serverEnv.databaseUrl();`,
  ],
  ['first-party @/db', `import { db } from '@/db'; export const a = db;`],
  ['first-party @/adapters', `import { pay } from '@/adapters/payments'; export const a = pay;`],
  [
    'computed globalThis["fetch"]',
    `export const a = () => globalThis['fetch']('https://example.com');`,
  ],
  ['computed global["process"]', `export const a = () => (global as any)['process'].env;`],
  ['dynamic import of a builtin', `export const a = () => import('node:fs');`],
  ['re-export from outside the domain', `export * from '@/db';`],
  ['type-only import from outside', `import type { X } from '@/db'; export type Y = X;`],
  ['an unapproved package', `import lodash from 'lodash'; export const a = lodash;`],

  // Non-determinism: unusable in property-based tests, which increments 4 and 5 depend on.
  ['Date.now', `export const a = () => Date.now();`],
  ['new Date()', `export const a = () => new Date();`],
  ['Date.parse', `export const a = () => Date.parse('2026-01-01');`],
  ['Math.random', `export const a = () => Math.random();`],

  // Money-specific.
  ['Math.round on money', `export const a = (n: number) => Math.round(n);`],

  // Purity.
  ['await', `export const a = async () => { await Promise.resolve(1); };`],
];

// Each entry must produce ZERO errors — the boundary must not be so broad
// that it blocks ordinary pure code. A rule that cries wolf gets disabled.
const permitted: ReadonlyArray<readonly [string, string]> = [
  ['arithmetic', `export const a = (n: number) => Math.ceil(n / 1000);`],
  ['Math.min/max', `export const a = (x: number, y: number) => Math.min(x, y);`],
  ['time as a parameter', `export const a = (now: number, cutoff: number) => now < cutoff;`],
  ['a Date built from an argument', `export const a = (ms: number) => new Date(ms).getUTCFullYear();`],
  ['array work', `export const a = (xs: number[]) => xs.reduce((s, x) => s + x, 0);`],
  ['importing another domain module', `import { cents } from './types'; export const a = cents;`],
  ['re-exporting a sibling domain module', `export * from './types';`],
  ['a named re-export from a sibling', `export { cents } from './types';`],
  ['plain exported function', `export function f(x: number): number { return x + 1; }`],
  ['exported type and interface', `export type T = number; export interface I { a: T }`],
];

describe('src/domain purity boundary is enforced by ESLint', () => {
  it.each(forbidden)(
    'rejects %s',
    async (_label, code) => {
      expect(await errorsInDomain(code)).toBeGreaterThan(0);
    },
    CASE_TIMEOUT_MS,
  );

  it.each(permitted)(
    'allows %s',
    async (_label, code) => {
      expect(await errorsInDomain(code)).toBe(0);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'applies only to src/domain — the same I/O is fine in an adapter',
    async () => {
      const io = `import fs from 'node:fs'; export const a = () => fs.readFileSync('x');`;
      expect(await errorsInDomain(io)).toBeGreaterThan(0);
      expect(await errorsInAdapters(io)).toBe(0);
    },
    CASE_TIMEOUT_MS,
  );
});
