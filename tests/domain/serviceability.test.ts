import { describe, expect, it } from 'vitest';

import {
  amountToFreeDelivery,
  checkServiceability,
  deliveryFee,
  formatPostalCode,
  fsaOf,
  isValidPostalCode,
  normalisePostalCode,
  type ZoneFee,
} from '@/domain/serviceability';
import { cents } from '@/domain/types';

/**
 * ⚠ FICTIONAL FSAs and fees throughout. Real delivery areas, fees and free
 * thresholds are blocked on the client (DQ-3) and must never appear in this
 * public repository — CLAUDE.md §1.
 */

const NEAR: ZoneFee = { zoneId: 'zone-near', feeCents: cents(499), freeAboveCents: cents(5000) };
const FAR: ZoneFee = { zoneId: 'zone-far', feeCents: cents(899), freeAboveCents: null };

const ZONES = new Map<string, ZoneFee>([
  ['A1A', NEAR],
  ['A1B', FAR],
]);

describe('postal codes', () => {
  it('normalises case and whitespace — one address is one address', () => {
    expect(normalisePostalCode('a1a 1a1')).toBe('A1A1A1');
    expect(normalisePostalCode('  A1A1A1 ')).toBe('A1A1A1');
    expect(normalisePostalCode('A1A  1A1')).toBe('A1A1A1');
  });

  it('validates the pattern against the normalised form', () => {
    expect(isValidPostalCode('a1a 1a1')).toBe(true);
    expect(isValidPostalCode('A1A1A1')).toBe(true);
    expect(isValidPostalCode('11A1A1')).toBe(false);
    expect(isValidPostalCode('A1A1A')).toBe(false);
    expect(isValidPostalCode('12345')).toBe(false); // a US ZIP, not a postal code
  });

  it('accepts letters Canada Post does not actually issue', () => {
    // Deliberate. D/F/I/O/Q/U are unused and W/Z never lead, but that is Canada
    // Post policy rather than a law, and a validator stricter than reality
    // rejects a real customer at checkout. The FSA lookup refuses it a moment
    // later anyway, with a better message.
    expect(isValidPostalCode('D1D 1D1')).toBe(true);
  });

  it('extracts the FSA, and refuses to guess at a malformed code', () => {
    expect(fsaOf('a1a 1a1')).toBe('A1A');
    expect(fsaOf('nonsense')).toBeNull();
  });

  it('formats for display', () => {
    expect(formatPostalCode('a1a1a1')).toBe('A1A 1A1');
  });
});

describe('checkServiceability (spec §5.2)', () => {
  it('returns the zone fee rule for a served FSA', () => {
    const result = checkServiceability('a1a 1a1', ZONES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.zone.zoneId).toBe('zone-near');
  });

  it('refuses an unserved FSA and a malformed code with the same code', () => {
    // Both are `outsideDeliveryArea` on purpose — from the customer's side
    // "we don't deliver there" and "that isn't a postal code" want different
    // copy, but the same precondition (P1) failed, and the FRONTEND owns the
    // wording. Splitting the code here would put copy decisions in the domain.
    expect(checkServiceability('Z9Z 9Z9', ZONES)).toEqual({
      ok: false,
      reason: 'outsideDeliveryArea',
    });
    expect(checkServiceability('nope', ZONES)).toEqual({
      ok: false,
      reason: 'outsideDeliveryArea',
    });
  });
});

describe('deliveryFee', () => {
  it('charges the zone fee below the threshold', () => {
    expect(deliveryFee(NEAR, cents(4999))).toBe(499);
  });

  it('is free at EXACTLY the threshold, not just above it', () => {
    // "Free delivery over $50" is universally read as including $50. An order
    // that misses free delivery by zero cents generates a support message
    // every single time it happens.
    expect(deliveryFee(NEAR, cents(5000))).toBe(0);
    expect(deliveryFee(NEAR, cents(5001))).toBe(0);
  });

  it('never goes free in a zone with no threshold', () => {
    // `null` means never free. Distinct from `0`, which would make EVERY order
    // free delivery — the two are one typo apart and the difference is the
    // entire delivery margin.
    expect(deliveryFee(FAR, cents(1_000_000))).toBe(899);
  });
});

describe('amountToFreeDelivery — the "spend $X more" nudge', () => {
  it('reports the shortfall', () => {
    expect(amountToFreeDelivery(NEAR, cents(4350))).toBe(650);
  });

  it('is null once free, and null where free is impossible', () => {
    expect(amountToFreeDelivery(NEAR, cents(5000))).toBeNull();
    expect(amountToFreeDelivery(FAR, cents(100))).toBeNull();
  });
});
