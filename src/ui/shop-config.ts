/**
 * Everything about the real shop that must NOT be in this repository.
 *
 * ⚠ THIS REPOSITORY IS PUBLIC. The shop's name, address, phone, licence
 * number, the towns it serves and its delivery FSAs are client data, and git
 * history is permanent. Every value here therefore arrives at runtime through
 * an environment variable, and every fallback is obviously fictional.
 *
 * The fallbacks are not placeholders to be "filled in later" in this file.
 * They are what the application shows when it has not been configured, and
 * they are deliberately implausible so that an unconfigured deployment is
 * obvious rather than subtly wrong. See CLAUDE.md §1.
 */

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

export function shopName(): string {
  return env('NEXT_PUBLIC_SHOP_NAME', 'Test Butcher Ltd');
}

export function shopLocality(): string {
  return env('SHOP_LOCALITY', 'Sample Town');
}

export function shopRegion(): string {
  return env('SHOP_REGION', 'ON');
}

export function shopStreet(): string {
  return env('SHOP_STREET', '1 Sample Street');
}

export function shopPostalCode(): string {
  return env('SHOP_POSTAL_CODE', 'A1A 1A1');
}

export function shopPhone(): string {
  return env('SHOP_PHONE', '');
}

/** Absolute origin, needed for canonical URLs, JSON-LD and the sitemap. */
export function siteOrigin(): string {
  return env('NEXT_PUBLIC_SITE_ORIGIN', 'https://example.invalid').replace(/\/$/, '');
}

/**
 * The towns the shop delivers to, as `slug|Display Name` pairs.
 *
 * 🔴 BLOCKED ON DQ-1 AND DQ-3. The real list is client data and does not
 * belong here in any form.
 *
 * ⚠ These become `/delivery/[town]` routes, and a set of near-duplicate pages
 * differing only by a place name is what Google's doorway-page guidance
 * targets. `04-PLAN` §10.5: a town that cannot sustain genuinely unique
 * content is a SECTION on the delivery page, not a route of its own. Do not
 * expand this list from an FSA list alone.
 */
export function deliveryTowns(): readonly { slug: string; name: string }[] {
  const raw = env('DELIVERY_TOWNS', 'sample-town|Sample Town');
  return raw
    .split(',')
    .map((entry) => entry.split('|'))
    .filter((parts): parts is [string, string] => parts.length === 2)
    .map(([slug, name]) => ({ slug: slug.trim(), name: name.trim() }))
    .filter((t) => t.slug !== '' && t.name !== '');
}

/** Opening hours for the LocalBusiness markup, as schema.org day specs. */
export function openingHours(): readonly string[] {
  return env('SHOP_OPENING_HOURS', 'Tu-Su 09:00-19:00')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
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
