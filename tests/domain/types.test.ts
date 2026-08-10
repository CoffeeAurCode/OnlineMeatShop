import { describe, expect, it } from 'vitest';
import { cents, grams } from '../../src/domain/types';

/**
 * Smoke tests for increment 0. Their job is to prove the test pipeline runs,
 * and to pin down the one rule that is expensive to relax later: money and
 * weight are integers.
 *
 * The real domain suites — property-based, and the concurrency tests that
 * gate increment 4 — arrive with the code they test.
 */
describe('money and weight are integers', () => {
  it('accepts whole cents', () => {
    expect(cents(4820)).toBe(4820);
  });

  it('rejects fractional cents', () => {
    // A float that reaches the money model is a defect, not a rounding detail.
    expect(() => cents(48.2)).toThrow(/integer cents/);
  });

  it('accepts whole grams', () => {
    expect(grams(2000)).toBe(2000);
  });

  it('rejects fractional grams', () => {
    expect(() => grams(1.5)).toThrow(/integer grams/);
  });
});
