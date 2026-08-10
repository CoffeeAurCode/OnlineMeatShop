import { describe, expect, it } from 'vitest';
import { cents, delta, differenceCents, grams } from '../../src/domain/types';

/**
 * The formal model defines MONEY and GRAMS as ℕ. These tests pin that down at
 * the constructor, which is the only place a bad value can enter.
 *
 * The negative and unsafe-integer cases were added after review: the first
 * version checked only `Number.isInteger`, so `cents(-1)` and `cents(2**60)`
 * both passed through a boundary described as unbypassable.
 *
 * The real domain suites — property-based, and the concurrency tests that
 * gate order placement — arrive with the code they test.
 */

describe('Cents — money is a non-negative safe integer', () => {
  it('accepts whole cents', () => {
    expect(cents(4820)).toBe(4820);
  });

  it('accepts zero', () => {
    // A free line and a zero delivery fee are both legitimate.
    expect(cents(0)).toBe(0);
  });

  it('rejects fractional cents', () => {
    // A float that reaches the money model is a defect, not a rounding detail.
    expect(() => cents(48.2)).toThrow(/safe integer/);
  });

  it('rejects negative money', () => {
    // Prices, line amounts, totals and fees are all ℕ. Signed differences
    // are a different type on purpose — see Delta.
    expect(() => cents(-1)).toThrow(/must not be negative/);
  });

  it('points at Delta when given a negative', () => {
    expect(() => cents(-500)).toThrow(/Delta/);
  });

  it('rejects integers beyond the safe range', () => {
    // Past 2^53, n === n + 1 can hold. Such a value would compare equal to
    // its neighbour and pass arithmetic checks while being wrong.
    expect(() => cents(2 ** 53)).toThrow(/safe integer/);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => cents(Number.NaN)).toThrow(/safe integer/);
    expect(() => cents(Number.POSITIVE_INFINITY)).toThrow(/safe integer/);
    expect(() => cents(Number.NEGATIVE_INFINITY)).toThrow(/safe integer/);
  });
});

describe('Grams — weight is a non-negative safe integer', () => {
  it('accepts whole grams', () => {
    expect(grams(2000)).toBe(2000);
  });

  it('rejects fractional grams', () => {
    expect(() => grams(1.5)).toThrow(/safe integer/);
  });

  it('rejects negative weight', () => {
    expect(() => grams(-1)).toThrow(/must not be negative/);
  });

  it('rejects NaN', () => {
    expect(() => grams(Number.NaN)).toThrow(/safe integer/);
  });
});

describe('Delta — signed, because settlement genuinely needs it', () => {
  it('accepts a negative difference', () => {
    // The meat weighed less than estimated: we owe the customer.
    expect(delta(-320)).toBe(-320);
  });

  it('accepts a positive difference', () => {
    expect(delta(150)).toBe(150);
  });

  it('still rejects fractions', () => {
    expect(() => delta(1.5)).toThrow(/safe integer/);
  });

  it('computes final − estimate, negative when we owe the customer', () => {
    expect(differenceCents(cents(4500), cents(4820))).toBe(-320);
    expect(differenceCents(cents(4900), cents(4820))).toBe(80);
    expect(differenceCents(cents(4820), cents(4820))).toBe(0);
  });
});
