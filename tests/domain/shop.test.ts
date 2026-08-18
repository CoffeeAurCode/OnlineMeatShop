import { describe, expect, it } from 'vitest';

import {
  EMPTY_IDENTITY,
  addressLines,
  blankHours,
  groupHours,
  hasAddress,
  isProvinceCode,
  isTimeOfDay,
  normaliseTowns,
  openingHoursSpecification,
  townSlug,
  weekOf,
  type DayHours,
  type Weekday,
} from '@/domain/shop';

/**
 * The shop's own identity.
 *
 * These values became owner-editable data on 2026-08-18, having been
 * environment variables that nothing read. The rules worth pinning are the
 * ones a form cannot enforce and a reader would get wrong: what a French place
 * name slugs to, when two towns are one town, and when seven lines of opening
 * hours are really one.
 */

const at = (day: Weekday, opens: string | null, closes: string | null): DayHours => ({
  day,
  opens,
  closes,
});

describe('townSlug', () => {
  it('folds accents instead of dropping the letter', () => {
    // The shop is in Montreal. `montr-al` is both ugly and a different URL
    // from the one anybody would type.
    expect(townSlug('Montréal')).toBe('montreal');
    expect(townSlug('Trois-Rivières')).toBe('trois-rivieres');
    expect(townSlug('Sainte-Anne-de-Bellevue')).toBe('sainte-anne-de-bellevue');
  });

  it('collapses punctuation and spacing to single hyphens', () => {
    expect(townSlug("  L'Île-Bizard  ")).toBe('l-ile-bizard');
    expect(townSlug('Saint   Laurent')).toBe('saint-laurent');
  });

  it('is empty when there is nothing to slug', () => {
    // The caller must refuse this: an empty slug collides with the parent route.
    expect(townSlug('...')).toBe('');
    expect(townSlug('   ')).toBe('');
  });
});

describe('normaliseTowns', () => {
  it('keeps the given order and the given spelling', () => {
    expect(normaliseTowns(['Laval', 'Montréal'])).toEqual([
      { slug: 'laval', name: 'Laval' },
      { slug: 'montreal', name: 'Montréal' },
    ]);
  });

  it('treats two spellings of one town as one town', () => {
    // Two entries would be two URLs serving identical content, which is the
    // doorway-page problem the delivery pages already have to avoid.
    expect(normaliseTowns(['Saint-Laurent', 'saint laurent', 'SAINT LAURENT'])).toEqual([
      { slug: 'saint-laurent', name: 'Saint-Laurent' },
    ]);
  });

  it('drops entries with nothing in them', () => {
    expect(normaliseTowns(['', '   ', '???'])).toEqual([]);
  });
});

describe('the address', () => {
  const full = {
    ...EMPTY_IDENTITY,
    street: '1234 Rue Wellington',
    locality: 'Montreal',
    region: 'QC',
    postalCode: 'H3K1W6',
  };

  it('is nothing at all until there is both a street and a town', () => {
    expect(hasAddress(EMPTY_IDENTITY)).toBe(false);
    expect(hasAddress({ ...EMPTY_IDENTITY, street: '1234 Rue Wellington' })).toBe(false);
    expect(addressLines({ ...EMPTY_IDENTITY, postalCode: 'H3K1W6' })).toEqual([]);
  });

  it('formats the postal code for display and never shows a blank field', () => {
    expect(addressLines(full)).toEqual(['1234 Rue Wellington', 'Montreal, QC  H3K 1W6']);
    expect(addressLines({ ...full, region: '', postalCode: '' })).toEqual([
      '1234 Rue Wellington',
      'Montreal',
    ]);
  });
});

describe('isTimeOfDay', () => {
  it('accepts a 24-hour HH:MM and nothing else', () => {
    expect(isTimeOfDay('09:00')).toBe(true);
    expect(isTimeOfDay('23:59')).toBe(true);
    expect(isTimeOfDay('9:00')).toBe(false);
    expect(isTimeOfDay('24:00')).toBe(false);
    expect(isTimeOfDay('09:60')).toBe(false);
    expect(isTimeOfDay('')).toBe(false);
  });
});

describe('weekOf', () => {
  it('is seven days in working order whatever it was given', () => {
    expect(blankHours().map((d) => d.day)).toEqual([
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat',
      'sun',
    ]);
    expect(weekOf([at('sat', '09:00', '17:00')]).map((d) => d.day)).toEqual([
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat',
      'sun',
    ]);
  });

  it('treats a half-filled day as closed rather than as open', () => {
    // A day with an opening time and no closing time is not a shop that never
    // shuts; it is a row somebody stopped filling in.
    expect(weekOf([at('tue', '09:00', null)])).toContainEqual(at('tue', null, null));
  });
});

describe('groupHours', () => {
  it('collapses a run of identical days into one line', () => {
    const week = [
      at('tue', '09:00', '19:00'),
      at('wed', '09:00', '19:00'),
      at('thu', '09:00', '19:00'),
    ];
    expect(groupHours(week)).toEqual([
      { from: 'tue', to: 'thu', opens: '09:00', closes: '19:00' },
    ]);
  });

  it('breaks the run on a closed day rather than spanning it', () => {
    // A shop shut on Thursday is two runs. One run saying "Tue to Sat" would
    // be a footer that lies about a day the customer might drive over on.
    const week = [
      at('tue', '09:00', '19:00'),
      at('wed', '09:00', '19:00'),
      at('fri', '09:00', '19:00'),
      at('sat', '09:00', '19:00'),
    ];
    expect(groupHours(week)).toEqual([
      { from: 'tue', to: 'wed', opens: '09:00', closes: '19:00' },
      { from: 'fri', to: 'sat', opens: '09:00', closes: '19:00' },
    ]);
  });

  it('breaks the run when the hours differ, even on adjacent days', () => {
    const week = [at('fri', '09:00', '19:00'), at('sat', '09:00', '17:00')];
    expect(groupHours(week)).toEqual([
      { from: 'fri', to: 'fri', opens: '09:00', closes: '19:00' },
      { from: 'sat', to: 'sat', opens: '09:00', closes: '17:00' },
    ]);
  });

  it('is empty when the shop is never open', () => {
    expect(groupHours(blankHours())).toEqual([]);
  });
});

describe('openingHoursSpecification', () => {
  it('names every day in the run, capitalised the way schema.org reads it', () => {
    // Google drops an unrecognised day silently, so the rich result simply
    // never appears. Case is the whole rule here.
    expect(
      openingHoursSpecification([
        at('tue', '09:00', '19:00'),
        at('wed', '09:00', '19:00'),
      ]),
    ).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Tuesday', 'Wednesday'],
        opens: '09:00',
        closes: '19:00',
      },
    ]);
  });

  it('emits nothing rather than an empty specification', () => {
    expect(openingHoursSpecification([])).toEqual([]);
  });
});

describe('isProvinceCode', () => {
  it('accepts the real codes, the empty string, and nothing else', () => {
    expect(isProvinceCode('QC')).toBe(true);
    expect(isProvinceCode('')).toBe(true);
    expect(isProvinceCode('QU')).toBe(false);
    expect(isProvinceCode('Quebec')).toBe(false);
    expect(isProvinceCode('qc')).toBe(false);
  });
});
