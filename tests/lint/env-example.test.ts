import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every configuration variable the application reads must be documented in
 * `.env.example`.
 *
 * 🔴 WHY THIS FILE EXISTS. `.env.example` is not documentation in the
 * decorative sense: it is the list somebody copies into the deployment host's
 * environment editor. A variable missing from it is a variable that never gets
 * set, and the failure lands months later, in production, on whichever feature
 * quietly degrades without it.
 *
 * That is not hypothetical. `NEXT_PUBLIC_SITE_ORIGIN` was read by
 * `src/ui/shop-config.ts` from the day the file was written and appeared in
 * `.env.example` for the first time on 2026-08-18 — after a full day of live
 * dispatch texts went to a driver with the sign-in link silently missing,
 * because the fallback origin is a well-formed dead URL and every check
 * upstream passed on it.
 *
 * ⚠ THE CHECK IS ON THE NAME, NOT THE VALUE. `.env.example` documents names
 * only and must never hold a real value (CLAUDE.md §1) — a commented-out name
 * counts, an assignment with a secret in it is a different defect.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Every `env('NAME', …)` and `process.env.NAME` in a file. */
function variablesRead(file: string): string[] {
  const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  const names = new Set<string>();
  for (const m of source.matchAll(/env\('([A-Z0-9_]+)'/g)) names.add(m[1] as string);
  for (const m of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) names.add(m[1] as string);
  return [...names].sort();
}

describe('.env.example documents the deployment surface', () => {
  const documented = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');

  /*
   * Deliberately just this file for now. It is the one whose variables are all
   * OPTIONAL at runtime — everything else (the database URL, the session
   * secret, the payment credentials) fails loudly or refuses to start when it
   * is absent, and a variable that announces itself does not need this rule.
   * Widen the list rather than the regex if that changes.
   */
  it.each(variablesRead('src/ui/shop-config.ts'))('documents %s', (name) => {
    expect(documented).toContain(name);
  });

  it('reads at least the nine shop-config variables, so the rule cannot pass vacuously', () => {
    expect(variablesRead('src/ui/shop-config.ts').length).toBeGreaterThanOrEqual(9);
  });
});
