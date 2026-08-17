import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, isLocale } from '@/i18n';

/**
 * Locale routing.
 *
 * ⚠ THIS FILE IS `proxy.ts`, NOT `middleware.ts`. The `middleware` convention
 * is deprecated in this version of Next and renamed to `proxy`. A file named
 * `middleware.ts` still runs, but it is the deprecated path and will stop
 * working; the two must not both exist.
 *
 * The job is narrow on purpose: decide a locale for a request that has not
 * stated one, and redirect. Everything else about a request is decided by the
 * route it reaches.
 *
 * Note the ORDER of preference below, which is not the order most examples
 * use. A previously chosen locale beats `Accept-Language`, because a
 * francophone browser whose owner deliberately clicked EN should get English,
 * and the header cannot know that. The header is only consulted for a first
 * visit.
 */

/** Anything under these is not a page and must never be redirected. */
const PASSTHROUGH = [
  '/api',
  '/admin',
  /*
   * ⚠ The driver portal is a TOOL, not a shopfront, and it has no locale — same
   * reasoning as `/admin`. Left out of this list it would be redirected to
   * `/en-CA/driver`, which does not exist, and every link in every dispatch SMS
   * would 404. The SMS is not editable once sent.
   */
  '/driver',
  // The dispatch SMS's sign-in link. Same reason as `/driver`, and it matters
  // more here: the URL is already printed in somebody's text messages.
  '/d',
  '/healthz',
  '/_next',
  '/fonts',
  '/sherbrooke',
  '/robots.txt',
  '/sitemap.xml',
  '/favicon.ico',
  '/icon',
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PASSTHROUGH.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const first = pathname.split('/')[1];
  if (isLocale(first)) {
    // Already localised. Remember the choice so the next bare `/` lands in the
    // same language, and so a shared link teaches the recipient nothing wrong.
    const response = NextResponse.next();
    if (request.cookies.get(LOCALE_COOKIE)?.value !== first) {
      response.cookies.set(LOCALE_COOKIE, first, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
      });
    }
    return response;
  }

  const locale = chooseLocale(request);
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

function chooseLocale(request: NextRequest): string {
  const remembered = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(remembered)) return remembered;

  /*
   * A deliberately small `Accept-Language` reader rather than Negotiator plus
   * intl-localematcher. There are two locales and no regional variants to
   * match, so the whole problem is "does this header prefer French or
   * English", and the two packages exist for the case where it is not.
   *
   * Quality values are parsed because they are how a browser expresses a real
   * preference order, and ignoring them gets `en;q=0.9, fr;q=1.0` backwards.
   */
  const header = request.headers.get('accept-language');
  if (header !== null) {
    const ranked = header
      .split(',')
      .map((part) => {
        const [tag = '', ...params] = part.trim().split(';');
        const q = params.find((p) => p.trim().startsWith('q='));
        const quality = q === undefined ? 1 : Number.parseFloat(q.trim().slice(2));
        return { base: tag.trim().toLowerCase().split('-')[0], quality: Number.isNaN(quality) ? 0 : quality };
      })
      .filter((entry) => entry.base !== undefined && entry.quality > 0)
      .sort((a, b) => b.quality - a.quality);

    for (const { base } of ranked) {
      if (LOCALES.some((l) => l === base)) return base as string;
    }
  }

  return DEFAULT_LOCALE;
}

export const config = {
  /*
   * Everything except Next's internals and anything with a file extension.
   * The extension test is what keeps `/sherbrooke/salmon.webp` from being
   * redirected to `/fr/sherbrooke/salmon.webp`, which would 404 every image on
   * the site and look like a broken deploy rather than a routing rule.
   */
  matcher: ['/((?!_next/static|_next/image|.*\\..*).*)'],
};
