import { describe, expect, it } from 'vitest';

import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import { otherLocale, pathForLocale, t, translator } from '@/i18n';
import { ADMIN_LOCALE, money, ratePerKg, weight } from '@/ui/format';

/**
 * The bilingual guarantees, as tests rather than as intentions.
 *
 * Two of these catch classes of bug that are otherwise invisible until a
 * French-reading customer finds them: a missing translation renders as blank
 * or as English, and a mis-shaped price reads as broken software.
 */

/** Every leaf path in a message bundle, dotted. */
function paths(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([k, v]) => paths(v, prefix === '' ? k : `${prefix}.${k}`));
}

describe('the two message bundles', () => {
  it('⭐ have EXACTLY the same keys, in both directions', () => {
    // Checked both ways on purpose. A one-directional check passes while fr
    // carries orphaned keys from a string that was renamed in en, and those
    // are how a bundle slowly stops being a translation of the other.
    const e = new Set(paths(en));
    const f = new Set(paths(fr));

    expect([...e].filter((k) => !f.has(k)).sort()).toEqual([]);
    expect([...f].filter((k) => !e.has(k)).sort()).toEqual([]);
  });

  it('use the same interpolation placeholders in both languages', () => {
    // `{amount}` renamed in one bundle renders the literal braces on the page.
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of paths(en)) {
      expect(placeholders(t('fr', key)), key).toEqual(placeholders(t('en', key)));
    }
  });

  it('⭐ contain ZERO em-dashes and en-dashes in either language', () => {
    // A house rule for shipped UI copy, and a mechanical check because it is
    // exactly the kind of rule that erodes one string at a time.
    for (const key of paths(en)) {
      for (const locale of ['en', 'fr'] as const) {
        expect(t(locale, key), `${locale}:${key}`).not.toMatch(/[—–]/);
      }
    }
  });

  it('has real accents in the French bundle, not stripped ASCII', () => {
    // Unaccented French reads as broken to a French reader, and it is an easy
    // thing to let through when the author is working in English.
    const french = paths(fr)
      .map((k) => t('fr', k))
      .join(' ');
    expect(french).toMatch(/[éèêàçîôûù]/);
    // A specific one, so the assertion cannot pass on a single stray accent.
    expect(t('fr', 'nav.howItWorks')).toBe('Pesée et paiement');
  });
});

describe('t()', () => {
  it('interpolates named variables', () => {
    expect(t('en', 'shop.leftToday', { amount: '1.5 kg' })).toBe('1.5 kg left today');
    expect(t('fr', 'shop.leftToday', { amount: '1,5 kg' })).toBe("Il reste 1,5 kg aujourd'hui");
  });

  it('returns the KEY when a string is missing, never a blank', () => {
    // A visible `nav.nonsense` on the page is obviously a bug and gets fixed.
    // A blank space looks deliberate and survives to production.
    expect(t('en', 'nav.nonsense')).toBe('nav.nonsense');
    expect(t('en', 'nav')).toBe('nav');
  });

  it('leaves an unknown placeholder alone rather than printing undefined', () => {
    expect(t('en', 'shop.leftToday', { nope: 'x' })).toBe('{amount} left today');
  });

  it('binds a locale', () => {
    expect(translator('fr')('nav.basket')).toBe('Panier');
  });
});

describe('pathForLocale', () => {
  it('swaps the locale segment and preserves the rest', () => {
    expect(pathForLocale('/fr/shop/lobster', 'en')).toBe('/en/shop/lobster');
    expect(pathForLocale('/en/p/atlantic-salmon', 'fr')).toBe('/fr/p/atlantic-salmon');
  });

  it('handles the bare locale root', () => {
    expect(pathForLocale('/fr', 'en')).toBe('/en');
    expect(pathForLocale('/en', 'fr')).toBe('/fr');
  });

  it('does not mangle a path whose next segment merely starts with the locale', () => {
    // `/frais` is not `/fr` + `ais`. The lookahead in the regex is what stops
    // this, and without it the toggle silently corrupts a category slug.
    expect(pathForLocale('/frais', 'en')).toBe('/en/frais');
    expect(pathForLocale('/fr/frais', 'en')).toBe('/en/frais');
  });

  it('round-trips', () => {
    for (const p of ['/fr/shop', '/en/checkout', '/fr/orders/abc-123']) {
      const flipped = pathForLocale(p, otherLocale(p.slice(1, 3) as 'en' | 'fr'));
      expect(pathForLocale(flipped, p.slice(1, 3) as 'en' | 'fr')).toBe(p);
    }
  });
});

describe('money, now locale aware', () => {
  it('⭐ writes fr-CA as `18,40 $` with a NON-BREAKING space', () => {
    const out = money(1840, 'fr');
    expect(out).toBe('18,40 $');
    // Asserted by codepoint because a plain space here is invisible in a diff
    // and lets the price wrap onto two lines at the end of a sentence.
    expect(out).toContain(' ');
    expect(out).not.toContain(' ');
  });

  it('writes en-CA as `$18.40`', () => {
    expect(money(1840, 'en')).toBe('$18.40');
  });

  it('never emits `CA$`', () => {
    // The default `currencyDisplay` does in some ICU builds, and the shop
    // trades in one currency and never needs to disambiguate it.
    expect(money(500, 'en')).not.toContain('CA');
  });

  it('groups thousands the way each locale does', () => {
    expect(money(123456789, 'en')).toBe('$1,234,567.89');
    // fr-CA groups with a narrow no-break space, not a comma.
    expect(money(123456789, 'fr')).toMatch(/^1[  ]234[  ]567,89[ ]\$$/);
  });

  it('⭐ stays EXACT past the point where a float would not', () => {
    // The whole reason the value reaches Intl as a string. Passing a number
    // here yields ...568.00 instead of ...567.89.
    expect(money(1234567890123456789 % Number.MAX_SAFE_INTEGER, 'en')).toBeTypeOf('string');
    expect(money(9007199254740991, 'en')).toBe('$90,071,992,547,409.91');
  });

  it('refuses a non-integer rather than rounding it', () => {
    expect(() => money(10.5, 'en')).toThrow(/integer cents/);
  });

  it('renders negatives, which settlement uses', () => {
    expect(money(-250, 'en')).toBe('-$2.50');
  });
});

describe('weight and rate', () => {
  it('switches the decimal separator with the locale', () => {
    expect(weight(1250, 'en')).toBe('1.25 kg');
    expect(weight(1250, 'fr')).toBe('1,25 kg');
  });

  it('talks grams below a kilo in both languages', () => {
    expect(weight(250, 'en')).toBe('250 g');
    expect(weight(250, 'fr')).toBe('250 g');
  });

  it('trims trailing zeros', () => {
    expect(weight(1500, 'en')).toBe('1.5 kg');
    expect(weight(2000, 'fr')).toBe('2 kg');
  });

  it('formats a per-kg rate in both languages', () => {
    expect(ratePerKg(2500, 'en')).toBe('$25.00/kg');
    expect(ratePerKg(2500, 'fr')).toBe('25,00 $/kg');
  });
});

describe('ADMIN_LOCALE', () => {
  it('is English, because the console is a tool and not a shopfront', () => {
    expect(ADMIN_LOCALE).toBe('en');
    expect(money(1840, ADMIN_LOCALE)).toBe('$18.40');
  });
});
