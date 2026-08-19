#!/usr/bin/env node
/**
 * Assert that every picture this repository REFERS to is a picture it HAS.
 *
 * ⚠ THIS CLASS OF BUG IS INVISIBLE TO EVERY OTHER GATE. A wrong image path is
 * a string: it type checks, it lints, it renders, and it passes the unit and
 * integration suites. What it does at runtime is serve a 404 into an
 * `<img>` — which `next/image` draws as an empty box of exactly the right
 * size, so even a screenshot looks plausible until somebody notices the fish
 * is missing. There is no stack trace and nothing in the logs.
 *
 * It is also the failure most likely to happen here, because the catalog's art
 * is addressed by CONVENTION (`/painted/<slug>.webp`, plus a `-thumb` sibling)
 * rather than by an import the bundler could resolve. A renamed product or a
 * half-finished asset run breaks the convention silently.
 *
 * Three things are checked:
 *
 *   1. Every `/painted/...` path written anywhere in `scripts/` or `src/`
 *      resolves to a real file under `public/`.
 *   2. Every full-size painting has the `-thumb` variant that `src/ui/art.ts`
 *      promises the row layouts. `thumb()` rewrites the path unconditionally
 *      for `/painted/`, so a missing sibling is a 404 in the catalog list.
 *   3. No painting is heavy enough to be the wrong file in the wrong slot —
 *      a thumbnail that weighs as much as a card is the symptom of an asset
 *      pipeline that silently skipped its resize step.
 *
 * Usage:  node scripts/check-assets.mjs
 * Exit 0 clean, 1 with a list. Intended for CI beside `check:parity`.
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const PUBLIC = join(ROOT, 'public');

/** A thumbnail has no business being larger than this. 256px of webp is ~10 kB. */
const THUMB_MAX_BYTES = 24_000;
/** A card-sized painting above this is a resize that did not happen. */
const CARD_MAX_BYTES = 220_000;
/**
 * ⚠ THE HERO WASH IS ALLOWED TO BE HEAVY AND IS THE ONLY THING THAT IS. It is a
 * 2200px full-bleed background stretched across the widest viewport the site
 * supports; capping it at the card size would force a resize that shows as
 * banding on a flat teal field, which is the one artefact this band cannot
 * hide.
 */
const BACKDROP_MAX_BYTES = 420_000;

/**
 * Art that is never drawn small, and therefore never needs a `-thumb`.
 *
 * ⚠ THIS IS A RULE ABOUT ROLE, NOT A LIST OF FILES, which is why it is a
 * predicate. `hero-*` are the scattered cut-outs and the wash on the landing
 * band — each is drawn once, at one size, at the top of one page. The three
 * named files are full-width illustrations on a confirmation screen or an empty
 * state. Products and categories are the opposite: they appear in menu rows and
 * in the counter grid at 96-220px, and those are what the thumbnail rule
 * protects.
 */
const NEVER_SMALL = new Set(['order-wrapped.webp', 'delivery-map.webp', 'empty-basket.webp']);
const drawnSmall = (file) => !file.startsWith('hero-') && !NEVER_SMALL.has(file);

const problems = [];

// ── 1. Every referenced path exists ────────────────────────────────────────

/** Walk a directory for source files, skipping the places builds live. */
function sources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (['.ts', '.tsx', '.mjs', '.js', '.css'].includes(extname(entry.name))) out.push(full);
  }
  return out;
}

/*
 * ⚠ ONLY LITERAL PATHS ARE CHECKABLE, and that is the honest limit of this
 * script. `thumb()` builds its path at runtime by rewriting a suffix, so no
 * static scan can see it — which is exactly why rule 2 below exists as a
 * separate, structural check rather than as more regex.
 */
const LITERAL = /['"`](\/painted\/[A-Za-z0-9._-]+\.(?:webp|png|jpg|jpeg))['"`]/g;

const referenced = new Set();
for (const file of [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'scripts'))]) {
  const text = readFileSync(file, 'utf8');
  for (const [, path] of text.matchAll(LITERAL)) {
    referenced.add(path);
    if (!existsSync(join(PUBLIC, path))) {
      problems.push(`missing file: ${path}\n    referenced by ${file.replace(ROOT + '/', '')}`);
    }
  }
}

// ── 2. Every painting has its thumbnail ────────────────────────────────────

const paintedDir = join(PUBLIC, 'painted');
if (!existsSync(paintedDir)) {
  problems.push('public/painted/ does not exist');
} else {
  const files = readdirSync(paintedDir).filter((f) => f.endsWith('.webp'));
  for (const file of files) {
    if (file.endsWith('-thumb.webp')) continue;
    const thumb = file.replace(/\.webp$/, '-thumb.webp');
    if (drawnSmall(file) && !files.includes(thumb)) {
      problems.push(
        `missing thumbnail: painted/${thumb}\n    src/ui/art.ts thumb() rewrites to it unconditionally, so the row layout 404s`,
      );
    }
  }

  // ── 3. Nothing is the wrong weight for its job ───────────────────────────

  for (const file of files) {
    const bytes = statSync(join(paintedDir, file)).size;
    const isThumb = file.endsWith('-thumb.webp');
    const isBackdrop = file === 'hero-wash.webp';
    const cap = isThumb ? THUMB_MAX_BYTES : isBackdrop ? BACKDROP_MAX_BYTES : CARD_MAX_BYTES;
    const role = isThumb ? 'thumbnail' : isBackdrop ? 'backdrop' : 'card image';
    if (bytes > cap) {
      problems.push(
        `oversized: painted/${file} is ${Math.round(bytes / 1024)} kB, cap is ${Math.round(cap / 1024)} kB\n    a ${role} this heavy means the resize step did not run`,
      );
    }
  }
}

// ── Report ─────────────────────────────────────────────────────────────────

if (problems.length > 0) {
  console.error(`\n${problems.length} asset problem(s):\n`);
  for (const p of problems) console.error(`  • ${p}\n`);
  process.exit(1);
}

const count = existsSync(paintedDir)
  ? readdirSync(paintedDir).filter((f) => f.endsWith('.webp')).length
  : 0;
console.log(`Assets OK — ${referenced.size} referenced paths resolve, ${count} painted files.`);
