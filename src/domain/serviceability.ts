/**
 * Serviceability — Canadian postal codes, delivery zones, delivery fees.
 *
 * PURE. No I/O, no clock. See eslint.config.mjs.
 *
 * Spec §4 (Fulfilment, inv-F1/inv-F2) and §5.2 (CheckServiceability).
 * Locale per DTM §6.4: FSAs, not pincodes.
 */

import { cents, type Cents } from './types';

// ── Postal codes ─────────────────────────────────────────────────────────

/**
 * The full Canadian postal code, normalised: uppercase, no space.
 *
 * `A1A 1A1` and `a1a1a1` are the same address and must not produce two
 * different rows or two different serviceability answers. Normalise on the way
 * in; format for display on the way out.
 */
export function normalisePostalCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/**
 * `^[A-Z]\d[A-Z]\d[A-Z]\d$` against the NORMALISED form.
 *
 * Deliberately not validating which letters Canada Post actually uses (D, F,
 * I, O, Q and U never appear, and W and Z never lead). That list is a Canada
 * Post policy rather than a law of nature, and a validator that is stricter
 * than reality rejects a real customer at the checkout page — much worse than
 * accepting a malformed one, which the FSA lookup rejects a moment later
 * anyway.
 */
export function isValidPostalCode(raw: string): boolean {
  return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(normalisePostalCode(raw));
}

/**
 * The Forward Sortation Area — the first three characters.
 *
 * Serviceability is keyed on this rather than the full code: a delivery radius
 * covers areas, not individual houses, and asking the owner to list every
 * postal code in town is not a thing anyone will do correctly.
 */
export function fsaOf(raw: string): string | null {
  const normalised = normalisePostalCode(raw);
  if (!isValidPostalCode(normalised)) return null;
  return normalised.slice(0, 3);
}

/** Display form — `A1A 1A1`. */
export function formatPostalCode(raw: string): string {
  const n = normalisePostalCode(raw);
  return n.length === 6 ? `${n.slice(0, 3)} ${n.slice(3)}` : n;
}

// ── Zones and fees ───────────────────────────────────────────────────────

export interface ZoneFee {
  readonly zoneId: string;
  readonly feeCents: Cents;
  /** `null` means delivery is never free in this zone. Not the same as 0. */
  readonly freeAboveCents: Cents | null;
}

/**
 * `CheckServiceability` (spec §5.2) — is this address served, and at what fee?
 *
 * `zones` is the caller's lookup of FSA → fee rule; the domain does not read a
 * database. P1 is exactly "this returns something".
 */
export function checkServiceability(
  postalCode: string,
  zones: ReadonlyMap<string, ZoneFee>,
): { ok: true; zone: ZoneFee } | { ok: false; reason: 'outsideDeliveryArea' } {
  const fsa = fsaOf(postalCode);
  if (fsa === null) return { ok: false, reason: 'outsideDeliveryArea' };
  const zone = zones.get(fsa);
  if (!zone) return { ok: false, reason: 'outsideDeliveryArea' };
  return { ok: true, zone };
}

/**
 * The delivery fee actually charged, given what the order is worth.
 *
 * The threshold is `>=`, not `>`. "Free delivery over $50" is universally read
 * by customers as including exactly $50, and an order that misses free
 * delivery by zero cents generates a support message every time it happens.
 *
 * The subtotal here is the LINE total — the estimate at checkout, the capped
 * actual at settlement. It never includes the fee itself, which would make the
 * fee depend on itself.
 */
export function deliveryFee(zone: ZoneFee, lineSubtotal: Cents): Cents {
  if (zone.freeAboveCents !== null && lineSubtotal >= zone.freeAboveCents) {
    return cents(0);
  }
  return zone.feeCents;
}

/**
 * How much more the customer must spend for free delivery, or `null` if it is
 * already free or unavailable. Drives the "add $6.50 more for free delivery"
 * nudge, which the competitive analysis found on every serious competitor.
 */
export function amountToFreeDelivery(zone: ZoneFee, lineSubtotal: Cents): Cents | null {
  if (zone.freeAboveCents === null) return null;
  if (lineSubtotal >= zone.freeAboveCents) return null;
  return cents(zone.freeAboveCents - lineSubtotal);
}

// ── Coordinates ──────────────────────────────────────────────────────────

/**
 * ⭐ SERVICEABILITY BY DISTANCE, WHICH IS WHAT IT SHOULD ALWAYS HAVE BEEN.
 *
 * The FSA table above answers "is this three-character prefix on a list".
 * That was the right shape while the only input was a postal code typed into
 * a box, and it has two defects that a delivery business feels immediately:
 * a prefix is not a distance, and a customer who cannot spell their own
 * postal code is told the shop does not deliver to them.
 *
 * A coordinate has neither problem. The customer's phone knows where it is,
 * the shop knows where it is, and the question becomes arithmetic.
 *
 * ⚠ BOTH MECHANISMS EXIST ON PURPOSE and neither is deprecated. The postal
 * path is what a desktop visitor who refuses location permission still gets;
 * the geo path is what a phone gives you for free. `resolveDestinationZone`
 * below is the one place that decides between them, so no caller has to.
 */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/** A zone expressed as a circle rather than as a list of prefixes. */
export interface GeoZone extends ZoneFee {
  readonly centre: GeoPoint;
  readonly radiusM: number;
}

/** Coordinates that are actually on Earth. A silent NaN here says "served". */
export function isValidPoint(p: GeoPoint): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

/** Mean Earth radius, metres. The sphere is good to ~0.5% and this is a van. */
const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Great-circle distance in metres, rounded to a whole metre.
 *
 * Haversine rather than the equirectangular approximation, which is faster and
 * wrong by kilometres at continental separations. This function has to answer
 * honestly for a test order placed from another continent, not only for one
 * placed across town.
 *
 * ⚠ Returns an INTEGER. Not because a fractional metre would hurt, but because
 * a boundary comparison that depends on the last bits of a double is a test
 * that fails once a year on one machine. Radii are integers too, so the
 * comparison is integer against integer.
 */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  /*
   * ⚠ THE ONE `Math.round` IN THE DOMAIN, AND IT IS DISABLED DELIBERATELY.
   *
   * The rule bans `Math.round` because MONEY is integer cents and rounding it
   * loses money silently. This is a distance in metres. Nothing here is
   * currency, nothing derived from it becomes currency, and the delivery fee
   * this eventually selects is a flat integer read from a `zone` row rather
   * than anything computed from the distance.
   *
   * The rounding is not cosmetic either. It buys two properties that are
   * asserted in `tests/domain/serviceability-geo.test.ts`: a point against
   * itself is exactly 0 rather than 1e-9, and a boundary comparison is integer
   * against integer, so `radiusM` is either inside or outside and never
   * depends on the last bits of a double.
   */
  // eslint-disable-next-line no-restricted-syntax -- metres, not cents. See above.
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Which zone covers this point, at what fee?
 *
 * ⭐ THE SMALLEST CONTAINING CIRCLE WINS, and that rule is the whole reason
 * overlapping zones are allowed. A shop with a $3 inner ring inside a $8 outer
 * ring is the normal arrangement, and it is expressible only if a point inside
 * both resolves to the tighter one. Ordering by radius makes that automatic
 * rather than something the seed has to get right.
 *
 * Ties are broken by zone id so the answer is deterministic. Two zones with
 * the same radius covering the same point is a data mistake, and a stable
 * wrong answer is far easier to diagnose than an unstable one.
 */
export function checkServiceabilityAt(
  point: GeoPoint,
  zones: readonly GeoZone[],
): { ok: true; zone: GeoZone; distanceM: number } | { ok: false; reason: 'outsideDeliveryArea' } {
  if (!isValidPoint(point)) return { ok: false, reason: 'outsideDeliveryArea' };

  let best: { zone: GeoZone; distanceM: number } | null = null;

  for (const zone of zones) {
    const distanceM = distanceMetres(point, zone.centre);
    if (distanceM > zone.radiusM) continue;
    if (
      best === null ||
      zone.radiusM < best.zone.radiusM ||
      (zone.radiusM === best.zone.radiusM && zone.zoneId < best.zone.zoneId)
    ) {
      best = { zone, distanceM };
    }
  }

  if (best === null) return { ok: false, reason: 'outsideDeliveryArea' };
  return { ok: true, zone: best.zone, distanceM: best.distanceM };
}

/**
 * Where the order is going, however the customer told us.
 *
 * A destination is a coordinate, a postal code, or both. Exactly one of them
 * has to resolve for P1 to pass.
 */
export interface Destination {
  readonly point: GeoPoint | null;
  readonly postalCode: string | null;
}

export interface ZoneLookup {
  /** FSA → fee rule. */
  readonly byFsa: ReadonlyMap<string, ZoneFee>;
  /** Circles. */
  readonly geo: readonly GeoZone[];
}

/**
 * ⭐ THE ONE PLACE THAT CHOOSES BETWEEN THE TWO MECHANISMS.
 *
 * ⚠ COORDINATES WIN WHEN BOTH ARE PRESENT, and that precedence is deliberate.
 * A postal code is what somebody typed; a coordinate is where the phone says
 * they are standing. When the two disagree the second one is the one holding
 * the parcel, and the fee follows the actual distance rather than the string.
 *
 * Falling back to the postal path when the geo path finds nothing would be the
 * friendly-looking mistake: it would quietly re-admit an address the distance
 * rule had just refused, and the refusal is the entire point of a radius. So
 * the fallback runs only when there is no usable coordinate at all.
 */
export function resolveDestinationZone(
  destination: Destination,
  zones: ZoneLookup,
): { ok: true; zone: ZoneFee } | { ok: false; reason: 'outsideDeliveryArea' } {
  if (destination.point !== null && isValidPoint(destination.point)) {
    const geo = checkServiceabilityAt(destination.point, zones.geo);
    return geo.ok ? { ok: true, zone: geo.zone } : { ok: false, reason: 'outsideDeliveryArea' };
  }

  if (destination.postalCode === null) return { ok: false, reason: 'outsideDeliveryArea' };
  return checkServiceability(destination.postalCode, zones.byFsa);
}
