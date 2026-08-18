/**
 * The two things about the shop that a BUILD has to know.
 *
 * ⚠ THIS REPOSITORY IS PUBLIC, so neither of them is a literal: both arrive at
 * runtime through an environment variable and both fall back to something
 * obviously fictional, so that an unconfigured deployment is obvious rather
 * than subtly wrong. See CLAUDE.md §1.
 *
 * ══ WHAT USED TO BE HERE, AND WHERE IT WENT (2026-08-18) ══════════════════
 *
 * ⭐ THE SHOP'S ADDRESS, PHONE, OPENING HOURS AND DELIVERY TOWNS ARE NO LONGER
 * ENVIRONMENT VARIABLES. They are rows in `shop_setting`, edited by the owner
 * at `/admin/shop`, and their shape lives in `src/domain/shop.ts`. Six of them
 * were read by nothing at all; the seventh could only be changed by somebody
 * with a hosting dashboard open, which is the wrong answer for a value that
 * changes when a supplier is late.
 *
 * ⚠ THESE TWO STAYED, AND THE REASON IS THE BUILD, NOT SECRECY. The origin is
 * baked into `robots.txt`, `sitemap.xml` and every canonical URL, and the name
 * into the generated icon and the metadata template. Both are read while the
 * site is being compiled, before any database connection is guaranteed to
 * exist — `next build` runs against an invalid connection string in CI on
 * purpose. A value the build needs cannot live in a table the build cannot
 * reach.
 */

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

export function shopName(): string {
  return env('NEXT_PUBLIC_SHOP_NAME', 'Test Butcher Ltd');
}

/** Absolute origin, needed for canonical URLs, JSON-LD and the sitemap. */
export function siteOrigin(): string {
  return env('NEXT_PUBLIC_SITE_ORIGIN', 'https://example.invalid').replace(/\/$/, '');
}

/**
 * The origin to build a real, tappable link from — or null when there is none.
 *
 * ⚠ NULL RATHER THAN A STRING, and every caller must handle it. `siteOrigin()`
 * NEVER returns empty: unconfigured, it returns `https://example.invalid`,
 * which is a perfectly well-formed URL and a dead link. Anything that puts an
 * origin in front of a customer or a driver has to be able to tell the
 * difference, and a `string` cannot say "I do not know".
 *
 * 🔴 THIS COST A LIVE DISPATCH ON 2026-08-17. `NEXT_PUBLIC_SITE_ORIGIN` was
 * never set on Render, so every driver SMS went out with the sign-in line
 * silently omitted, and nothing anywhere said so. Omitting the line is still
 * the right behaviour — a URL that cannot resolve is worse — but the SILENCE
 * was the defect. Callers now report it: see `/api/admin/dispatch` and the
 * banner on `/admin/partners`.
 */
export function portalOrigin(): string | null {
  const origin = siteOrigin();
  if (origin === '' || origin.includes('example.invalid')) return null;
  return origin;
}
