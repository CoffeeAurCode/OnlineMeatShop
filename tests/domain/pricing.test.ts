import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TOLERANCE,
  authorisationCeiling,
  cappedTotal,
  inBand,
  isLegalQuantity,
  isValidPackPricing,
  isValidPerKgPricing,
  isValidPricing,
  lineEst,
  sumCents,
} from '@/domain/pricing';
import { cents, grams, type Pricing } from '@/domain/types';

/**
 * A seeded generator, so a failure is reproducible from the file alone.
 *
 * Deliberately not `fast-check`: this needs uniform integers in known ranges
 * and a fixed seed, which is a dozen lines, and the domain's whole point is
 * that it has no dependencies to reason about.
 */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    // xorshift32
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
}
const between = (rng: () => number, lo: number, hi: number) =>
  lo + Math.floor(rng() * (hi - lo + 1));

/**
 * The oracle: exact integer ceiling division in BigInt, which cannot round.
 * Testing the implementation against a restatement of itself would prove
 * nothing, so the reference is arithmetic of a different kind.
 */
const exactCeilDiv1000 = (rate: number, g: number): number => {
  const n = BigInt(rate) * BigInt(g);
  const q = n / 1000n;
  return Number(n % 1000n === 0n ? q : q + 1n);
};

const perKg = (rate: number, minOrder: number, step: number): Pricing => ({
  mode: 'perKg',
  ratePerKg: cents(rate),
  minOrder: grams(minOrder),
  step: grams(step),
});
const pack = (price: number, wMin: number, wMax: number): Pricing => ({
  mode: 'pack',
  price: cents(price),
  wMin: grams(wMin),
  wMax: grams(wMax),
});

describe('inv-C1 — pack pricing', () => {
  it('accepts a sane range', () => {
    expect(isValidPackPricing(cents(1499), grams(450), grams(550))).toBe(true);
  });

  it('accepts an exact declared weight (wMin === wMax)', () => {
    // The spec says wMin ≤ wMax. A tray that is always 500 g is legitimate.
    expect(isValidPackPricing(cents(1499), grams(500), grams(500))).toBe(true);
  });

  it.each([
    ['zero price', 0, 450, 550],
    ['zero wMin', 1499, 0, 550],
    ['inverted range', 1499, 900, 500],
  ])('rejects %s', (_label, price, wMin, wMax) => {
    expect(isValidPackPricing(cents(price), grams(wMin), grams(wMax))).toBe(false);
  });
});

describe('inv-C2 — per-kg pricing', () => {
  it('accepts rate > 0, step > 0, minOrder >= step', () => {
    expect(isValidPerKgPricing(cents(2199), grams(500), grams(250))).toBe(true);
  });

  it('accepts minOrder exactly one step', () => {
    expect(isValidPerKgPricing(cents(2199), grams(250), grams(250))).toBe(true);
  });

  it('rejects minOrder below one step — nothing would be orderable', () => {
    // Every legal quantity is a multiple of step and at least minOrder. With
    // minOrder < step the smallest satisfying value is step anyway, so a
    // catalog row like this is a mistake being silently corrected.
    expect(isValidPerKgPricing(cents(2199), grams(100), grams(250))).toBe(false);
  });

  it.each([
    ['zero rate', 0, 500, 250],
    ['zero step', 2199, 500, 0],
  ])('rejects %s', (_label, rate, minOrder, step) => {
    expect(isValidPerKgPricing(cents(rate), grams(minOrder), grams(step))).toBe(false);
  });

  it('isValidPricing dispatches on mode', () => {
    expect(isValidPricing(perKg(2199, 500, 250))).toBe(true);
    expect(isValidPricing(perKg(2199, 100, 250))).toBe(false);
    expect(isValidPricing(pack(1499, 450, 550))).toBe(true);
    expect(isValidPricing(pack(1499, 900, 500))).toBe(false);
  });
});

describe('isLegalQuantity — P5', () => {
  const p = perKg(2199, 500, 250);

  it('accepts the minimum and exact multiples above it', () => {
    expect(isLegalQuantity(p, grams(500))).toBe(true);
    expect(isLegalQuantity(p, grams(750))).toBe(true);
    expect(isLegalQuantity(p, grams(2000))).toBe(true);
  });

  it('rejects below the minimum, even on a step boundary', () => {
    expect(isLegalQuantity(p, grams(250))).toBe(false);
  });

  it('rejects a quantity the butcher cannot cut', () => {
    expect(isLegalQuantity(p, grams(437))).toBe(false);
  });

  it('is vacuously true for packs — a pack has no weight input', () => {
    expect(isLegalQuantity(pack(1499, 450, 550), grams(1))).toBe(true);
  });
});

describe('lineEst', () => {
  it('returns the pack price unchanged, whatever weight is passed', () => {
    // inv-O6: pack lines are never re-priced; the estimate IS the actual.
    const p = pack(1499, 450, 550);
    expect(lineEst(p, grams(450))).toBe(1499);
    expect(lineEst(p, grams(550))).toBe(1499);
  });

  it('rounds UP on a partial cent', () => {
    // 2199 c/kg × 333 g = 732,267 / 1000 = 732.267 → 733
    expect(lineEst(perKg(2199, 250, 1), grams(333))).toBe(733);
  });

  it('does not round up when the division is exact', () => {
    // 2000 c/kg × 500 g = 1,000,000 / 1000 = 1000 exactly.
    expect(lineEst(perKg(2000, 250, 250), grams(500))).toBe(1000);
  });

  it('matches exact BigInt ceiling division over 20k generated cases', () => {
    const rng = makeRng(0xbeef);
    for (let i = 0; i < 20_000; i++) {
      const rate = between(rng, 1, 20_000); // up to $200.00/kg
      const g = between(rng, 1, 60_000); // up to 60 kg
      expect(lineEst(perKg(rate, 1, 1), grams(g))).toBe(exactCeilDiv1000(rate, g));
    }
  });

  it('is never below the exact rational amount', () => {
    // The property that actually matters: the quote must cover the true cost,
    // or the authorised ceiling will not cover the capture.
    const rng = makeRng(0x1234);
    for (let i = 0; i < 20_000; i++) {
      const rate = between(rng, 1, 20_000);
      const g = between(rng, 1, 60_000);
      const est = lineEst(perKg(rate, 1, 1), grams(g));
      expect(BigInt(est) * 1000n).toBeGreaterThanOrEqual(BigInt(rate) * BigInt(g));
      // ...and never overcharges by a whole cent more than necessary.
      expect((BigInt(est) - 1n) * 1000n).toBeLessThan(BigInt(rate) * BigInt(g));
    }
  });

  it('is monotonic in weight', () => {
    const p = perKg(1737, 1, 1);
    let prev = 0;
    for (let g = 1; g <= 5_000; g++) {
      const v = lineEst(p, grams(g));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('throws rather than returning a wrong number outside safe-integer range', () => {
    expect(() => lineEst(perKg(2 ** 40, 1, 1), grams(2 ** 20))).toThrow(/safe integer/i);
  });
});

describe('the tolerance band', () => {
  it('defaults to 10%', () => {
    expect(DEFAULT_TOLERANCE).toBe(0.1);
  });

  it('authorises a ceiling above the estimate', () => {
    expect(authorisationCeiling(cents(10_000))).toBe(11_000);
  });

  it('rounds the ceiling up, so the hold always covers the capture', () => {
    // 999 × 1.1 = 1098.9 → 1099, not 1098.
    expect(authorisationCeiling(cents(999))).toBe(1099);
  });

  it('inBand accepts the exact boundaries', () => {
    expect(inBand(grams(1000), grams(900))).toBe(true);
    expect(inBand(grams(1000), grams(1100))).toBe(true);
  });

  it('inBand rejects just outside', () => {
    expect(inBand(grams(1000), grams(899))).toBe(false);
    expect(inBand(grams(1000), grams(1101))).toBe(false);
  });
});

describe('cappedTotal', () => {
  it('charges the actual when it is inside the ceiling', () => {
    // actual 10,500 < ceiling 11,000; fee 500 added on top.
    expect(cappedTotal(cents(10_500), cents(10_000), cents(500))).toBe(11_000);
  });

  it('charges the ceiling when the actual exceeds it — the shop absorbs it', () => {
    // actual 12,000 > ceiling 11,000, so 11,000 + fee.
    expect(cappedTotal(cents(12_000), cents(10_000), cents(500))).toBe(11_500);
  });

  it('does not scale the delivery fee by the tolerance', () => {
    // The fee is fixed. If it were inside the ×1.1 the customer would be
    // charged more for delivery because the meat came in heavy.
    const withFee = cappedTotal(cents(12_000), cents(10_000), cents(500));
    const withoutFee = cappedTotal(cents(12_000), cents(10_000), cents(0));
    expect(withFee - withoutFee).toBe(500);
  });

  it('never exceeds the authorised ceiling plus the fee', () => {
    // The property that makes Stripe's single-capture rule a non-issue.
    const rng = makeRng(0xc0ffee);
    for (let i = 0; i < 10_000; i++) {
      const est = between(rng, 1, 500_000);
      const actual = between(rng, 1, 1_500_000);
      const fee = between(rng, 0, 2_000);
      const total = cappedTotal(cents(actual), cents(est), cents(fee));
      expect(total).toBeLessThanOrEqual(authorisationCeiling(cents(est)) + fee);
    }
  });
});

describe('sumCents', () => {
  it('sums to an exact integer', () => {
    expect(sumCents([cents(1), cents(2), cents(3)])).toBe(6);
  });

  it('is zero for an empty basket', () => {
    expect(sumCents([])).toBe(0);
  });
});
