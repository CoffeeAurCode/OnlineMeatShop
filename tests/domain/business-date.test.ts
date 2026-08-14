import { describe, expect, it } from 'vitest';

import { businessDateIn, businessDatePlus } from '@/ui/business-date';

/**
 * The booking horizon is computed by counting days forward from today in the
 * shop's timezone, and the checkout picker's contents depend on getting that
 * exactly right. These are the cases where the obvious implementation —
 * `now.getTime() + days * 86_400_000` — is wrong.
 */
describe('businessDatePlus', () => {
  const tz = 'America/Toronto';

  it('counts today as day zero', () => {
    const now = new Date('2026-08-14T18:00:00Z');
    expect(businessDatePlus(tz, now, 0)).toBe(businessDateIn(tz, now));
    expect(businessDatePlus(tz, now, 2)).toBe('2026-08-16');
  });

  it('rolls over a month boundary', () => {
    expect(businessDatePlus(tz, new Date('2026-01-30T18:00:00Z'), 3)).toBe('2026-02-02');
  });

  it('handles February in a leap year', () => {
    expect(businessDatePlus(tz, new Date('2028-02-27T18:00:00Z'), 2)).toBe('2028-02-29');
  });

  it('advances exactly one date across spring-forward, late in the evening', () => {
    /*
     * ⭐ THE CASE THAT BREAKS DURATION ARITHMETIC. 23:30 on 2026-03-07 in
     * Toronto is 04:30 UTC on the 8th; the clocks go forward at 02:00 local on
     * the 8th. Adding 24 real hours lands at 00:30 local on the 9th, so a
     * one-day horizon would silently reach two dates ahead.
     */
    const lateEvening = new Date('2026-03-08T04:30:00Z');
    expect(businessDateIn(tz, lateEvening)).toBe('2026-03-07');
    expect(businessDatePlus(tz, lateEvening, 1)).toBe('2026-03-08');
    expect(businessDatePlus(tz, lateEvening, 2)).toBe('2026-03-09');
  });

  it('reckons the day in the SHOP timezone, not UTC', () => {
    // 01:30 UTC on the 15th is still the 14th in Toronto.
    const afterUtcMidnight = new Date('2026-08-15T01:30:00Z');
    expect(businessDateIn(tz, afterUtcMidnight)).toBe('2026-08-14');
    expect(businessDatePlus(tz, afterUtcMidnight, 2)).toBe('2026-08-16');
  });
});
