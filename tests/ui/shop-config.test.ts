import { afterEach, describe, expect, it } from 'vitest';

import { portalOrigin, siteOrigin } from '@/ui/shop-config';

/**
 * The predicate that decides whether a driver gets a tappable link.
 *
 * 🔴 WHY THIS FILE EXISTS. On 2026-08-17 the production deployment had no
 * `NEXT_PUBLIC_SITE_ORIGIN`. Every dispatch SMS went out with the sign-in line
 * omitted — correctly, because the alternative is a link to
 * `https://example.invalid` — and nothing reported it. The behaviour was right;
 * the silence was the defect, and the silence is now the caller's job (the
 * `jobLink` field on `/api/admin/dispatch`, and the banner on
 * `/admin/partners`). This pins the part they both depend on.
 *
 * ⚠ THE FALLBACK IS A WELL-FORMED URL, which is exactly what makes it
 * dangerous: every `new URL()`, every `startsWith('https://')` and every
 * truthiness check passes on it. Only naming the placeholder catches it.
 */

const KEY = 'NEXT_PUBLIC_SITE_ORIGIN';
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe('portalOrigin', () => {
  it('is null when the variable is absent', () => {
    delete process.env[KEY];
    expect(siteOrigin()).toContain('example.invalid');
    expect(portalOrigin()).toBeNull();
  });

  it('is null when the variable is present but empty or whitespace', () => {
    process.env[KEY] = '   ';
    expect(portalOrigin()).toBeNull();
  });

  it('is null for the placeholder itself, however it is written', () => {
    for (const value of [
      'https://example.invalid',
      'https://example.invalid/',
      'https://shop.example.invalid',
    ]) {
      process.env[KEY] = value;
      expect(portalOrigin()).toBeNull();
    }
  });

  it('is the origin, without a trailing slash, once configured', () => {
    process.env[KEY] = 'https://shop.example.com/';
    expect(portalOrigin()).toBe('https://shop.example.com');
  });
});
