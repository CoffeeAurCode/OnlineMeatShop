import { describe, expect, it } from 'vitest';

import {
  checkServiceabilityAt,
  distanceMetres,
  isValidPoint,
  resolveDestinationZone,
  type GeoZone,
  type ZoneFee,
} from '@/domain/serviceability';
import { cents } from '@/domain/types';

/**
 * Serviceability by distance.
 *
 * Every coordinate here is a real, public place, and no real customer address
 * appears: the repository is public, and a test fixture is exactly the kind of
 * file where an address gets left behind. City centres are fine, and they have
 * the advantage that the distances between them are independently checkable.
 */

// Public landmarks, to six decimals.
const MONTREAL = { lat: 45.5019, lng: -73.5674 };
const TORONTO = { lat: 43.6532, lng: -79.3832 };
const VANCOUVER = { lat: 49.2827, lng: -123.1207 };
const MUMBAI = { lat: 19.076, lng: 72.8777 };
const LAVAL = { lat: 45.6066, lng: -73.7124 };

function zone(over: Partial<GeoZone> & Pick<GeoZone, 'zoneId' | 'centre' | 'radiusM'>): GeoZone {
  return { feeCents: cents(599), freeAboveCents: cents(7500), ...over };
}

describe('distanceMetres', () => {
  /*
   * Checked against published great-circle distances rather than against this
   * function's own output. A test that asserts what the code already does
   * proves only that the code is deterministic.
   *
   * The tolerance is 0.5%, which is the honest accuracy of a spherical model
   * against the WGS84 ellipsoid. Tightening it would be asserting a precision
   * the formula does not have.
   */
  const within = (actual: number, expected: number) =>
    Math.abs(actual - expected) / expected < 0.005;

  it('agrees with the published distance Montreal to Toronto (~505 km)', () => {
    expect(within(distanceMetres(MONTREAL, TORONTO), 505_000)).toBe(true);
  });

  it('agrees with the published distance Montreal to Vancouver (~3679 km)', () => {
    expect(within(distanceMetres(MONTREAL, VANCOUVER), 3_679_000)).toBe(true);
  });

  it('stays honest across a continent-and-an-ocean, Montreal to Mumbai (~12,070 km)', () => {
    // The case an equirectangular approximation gets wrong by thousands of
    // kilometres, and the reason this is haversine. It is also the case that
    // matters for accepting test orders placed from India.
    expect(within(distanceMetres(MONTREAL, MUMBAI), 12_070_000)).toBe(true);
  });

  it('is zero for a point against itself, with no floating-point residue', () => {
    // `Math.sqrt` of a value that should be exactly 0 has produced 1e-9 before
    // now, and a distance of "0.000001 m" against a radius is only ever
    // confusing. The rounding in the implementation is what guarantees this.
    expect(distanceMetres(MONTREAL, MONTREAL)).toBe(0);
  });

  it('is symmetric', () => {
    expect(distanceMetres(MONTREAL, LAVAL)).toBe(distanceMetres(LAVAL, MONTREAL));
  });

  it('returns whole metres', () => {
    expect(Number.isInteger(distanceMetres(MONTREAL, TORONTO))).toBe(true);
  });

  it('crosses the antimeridian without going the long way round', () => {
    // 179.9°E to 179.9°W is 0.2° apart, not 359.8°. A naive longitude
    // subtraction reports about 22,000 km here instead of about 22 km.
    const east = { lat: 0, lng: 179.9 };
    const west = { lat: 0, lng: -179.9 };
    expect(distanceMetres(east, west)).toBeLessThan(23_000);
  });
});

describe('isValidPoint', () => {
  it('accepts a real place', () => {
    expect(isValidPoint(MONTREAL)).toBe(true);
  });

  it.each([
    ['NaN latitude', { lat: Number.NaN, lng: -73.5674 }],
    ['NaN longitude', { lat: 45.5019, lng: Number.NaN }],
    ['Infinity', { lat: Number.POSITIVE_INFINITY, lng: 0 }],
    ['latitude past the pole', { lat: 91, lng: 0 }],
    ['longitude past the antimeridian', { lat: 0, lng: 181 }],
  ])('refuses %s', (_label, point) => {
    expect(isValidPoint(point)).toBe(false);
  });
});

describe('checkServiceabilityAt', () => {
  // 20 km, because Laval is 16.2 km from downtown and this circle is meant to
  // contain it. A radius chosen to make an assertion pass is a radius that
  // proves nothing, so the number follows the geography.
  const local = zone({ zoneId: 'local', centre: MONTREAL, radiusM: 20_000 });

  it('serves a point inside the circle, and says how far away it is', () => {
    const r = checkServiceabilityAt(LAVAL, [local]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.zone.zoneId).toBe('local');
    expect(r.distanceM).toBeGreaterThan(0);
    expect(r.distanceM).toBeLessThanOrEqual(20_000);
  });

  it('refuses a point outside every circle', () => {
    const r = checkServiceabilityAt(TORONTO, [local]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('outsideDeliveryArea');
  });

  it('refuses when there are no circles at all', () => {
    // The state of the live database before a geo zone is seeded. It must
    // refuse, not throw, and not accept.
    expect(checkServiceabilityAt(MONTREAL, []).ok).toBe(false);
  });

  it('includes the boundary — a point exactly at the radius is served', () => {
    const d = distanceMetres(MONTREAL, LAVAL);
    const exact = zone({ zoneId: 'exact', centre: MONTREAL, radiusM: d });
    expect(checkServiceabilityAt(LAVAL, [exact]).ok).toBe(true);
  });

  it('excludes one metre past the boundary', () => {
    const d = distanceMetres(MONTREAL, LAVAL);
    const short = zone({ zoneId: 'short', centre: MONTREAL, radiusM: d - 1 });
    expect(checkServiceabilityAt(LAVAL, [short]).ok).toBe(false);
  });

  it('⭐ picks the SMALLEST containing circle, so an inner ring beats an outer one', () => {
    // The whole reason overlapping zones are allowed: a cheap inner ring
    // inside an expensive outer one. If the outer won, every close-in customer
    // would be quoted the far-away fee.
    const inner = zone({
      zoneId: 'inner',
      centre: MONTREAL,
      radiusM: 20_000,
      feeCents: cents(299),
    });
    const outer = zone({
      zoneId: 'outer',
      centre: MONTREAL,
      radiusM: 600_000,
      feeCents: cents(1299),
    });

    const near = checkServiceabilityAt(LAVAL, [outer, inner]);
    expect(near.ok && near.zone.feeCents).toBe(299);

    // And the outer ring still catches what the inner one does not.
    const far = checkServiceabilityAt(TORONTO, [outer, inner]);
    expect(far.ok && far.zone.feeCents).toBe(1299);
  });

  it('is deterministic when two equal circles both contain the point', () => {
    // A data mistake. A stable wrong answer is diagnosable; an unstable one
    // produces a fee that changes between the quote and the order.
    const a = zone({ zoneId: 'aaa', centre: MONTREAL, radiusM: 30_000, feeCents: cents(100) });
    const b = zone({ zoneId: 'bbb', centre: MONTREAL, radiusM: 30_000, feeCents: cents(900) });
    expect(checkServiceabilityAt(LAVAL, [b, a]).ok && checkServiceabilityAt(LAVAL, [b, a])).toEqual(
      checkServiceabilityAt(LAVAL, [a, b]),
    );
  });

  it('⚠ refuses a NaN coordinate rather than serving it', () => {
    // `NaN > radiusM` is false, so an unchecked NaN falls THROUGH the
    // exclusion test and reads as inside every circle. This is the assertion
    // that keeps `isValidPoint` in front of the loop.
    const r = checkServiceabilityAt({ lat: Number.NaN, lng: Number.NaN }, [
      zone({ zoneId: 'any', centre: MONTREAL, radiusM: 20_000 }),
    ]);
    expect(r.ok).toBe(false);
  });
});

describe('resolveDestinationZone', () => {
  const byFsa = new Map<string, ZoneFee>([
    ['H2X', { zoneId: 'postal', feeCents: cents(599), freeAboveCents: cents(7500) }],
  ]);
  const geo = [zone({ zoneId: 'geo', centre: MONTREAL, radiusM: 20_000, feeCents: cents(299) })];

  it('uses the postal code when that is all there is', () => {
    const r = resolveDestinationZone({ point: null, postalCode: 'H2X 1Y4' }, { byFsa, geo });
    expect(r.ok && r.zone.zoneId).toBe('postal');
  });

  it('uses the coordinate when that is all there is', () => {
    const r = resolveDestinationZone({ point: LAVAL, postalCode: null }, { byFsa, geo });
    expect(r.ok && r.zone.zoneId).toBe('geo');
  });

  it('⭐ prefers the coordinate when both are given', () => {
    // The postal code is what somebody typed. The coordinate is where the
    // phone says they are standing, and it is the one holding the parcel.
    const r = resolveDestinationZone({ point: LAVAL, postalCode: 'H2X 1Y4' }, { byFsa, geo });
    expect(r.ok && r.zone.zoneId).toBe('geo');
  });

  it('⚠ does NOT fall back to the postal code when the coordinate is refused', () => {
    // The friendly-looking mistake. Falling back would re-admit an address the
    // distance rule had just refused, which makes the radius decorative.
    const r = resolveDestinationZone({ point: TORONTO, postalCode: 'H2X 1Y4' }, { byFsa, geo });
    expect(r.ok).toBe(false);
  });

  it('DOES fall back when the coordinate is not a coordinate at all', () => {
    // Garbage in the lat/lng is not the customer telling us they are in
    // Toronto. It is the absence of a coordinate, so the postal code stands.
    const r = resolveDestinationZone(
      { point: { lat: Number.NaN, lng: 0 }, postalCode: 'H2X 1Y4' },
      { byFsa, geo },
    );
    expect(r.ok && r.zone.zoneId).toBe('postal');
  });

  it('refuses a destination that names nowhere', () => {
    expect(resolveDestinationZone({ point: null, postalCode: null }, { byFsa, geo }).ok).toBe(false);
  });
});
