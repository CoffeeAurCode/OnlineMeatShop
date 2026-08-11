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
