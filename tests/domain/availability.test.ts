import { describe, expect, it } from 'vitest';

import {
  available,
  canOpenBusinessDay,
  canReserve,
  declaredStockIsInCatalog,
  demandByProduct,
  holdsInvA3,
  isIsoDate,
  isSoldOut,
  release,
  reserve,
} from '@/domain/availability';
import { grams } from '@/domain/types';

const g = grams;

describe('available / sold out', () => {
  it('is stocked minus reserved', () => {
    expect(available(g(1500), g(400))).toBe(1100);
  });

  it('clamps at zero rather than reporting negative stock', () => {
    // Only reachable if inv-A3 has already been violated. Returning -200 here
    // would let a caller "have" negative stock and produce arithmetic that
    // looks fine all the way to an order confirmation.
    expect(available(g(100), g(300))).toBe(0);
  });

  it('is sold out exactly when nothing is left', () => {
    expect(isSoldOut(g(500), g(500))).toBe(true);
    expect(isSoldOut(g(500), g(499))).toBe(false);
    expect(isSoldOut(g(0), g(0))).toBe(true);
  });
});

describe('reserve / release', () => {
  it('reserves up to exactly the stocked quantity', () => {
    expect(reserve(g(1000), g(0), g(1000))).toBe(1000);
  });

  it('throws rather than clamping when a reservation would breach inv-A3', () => {
    // Clamping would be worse than throwing: the caller would believe it had
    // reserved 600g and write an order line for 600g against 500g of stock.
    expect(() => reserve(g(500), g(0), g(600))).toThrow(/inv-A3/);
  });

  it('releases, and floors at zero without throwing', () => {
    expect(release(g(600), g(200))).toBe(400);
    // Asymmetric with reserve on purpose — over-releasing frees stock that was
    // already free; refusing to release would strand it for the whole day.
    expect(release(g(100), g(500))).toBe(0);
  });
});

describe('demandByProduct — the aggregation that stops an ordinary oversell', () => {
  it('sums duplicate product lines instead of treating them separately', () => {
    // The motivating case, and it is the NORMAL one: prep options do not
    // create separate products, so 1kg curry cut + 1kg biryani cut is one
    // product on two lines.
    const demand = demandByProduct([
      { productId: 'chicken', requestedG: g(1000) },
      { productId: 'chicken', requestedG: g(1000) },
      { productId: 'lamb', requestedG: g(500) },
    ]);
    expect(demand.get('chicken')).toBe(2000);
    expect(demand.get('lamb')).toBe(500);
  });

  it('is what makes the difference between accepting and refusing', () => {
    const stocked = g(1500);
    const reserved = g(0);
    const lines = [
      { productId: 'chicken', requestedG: g(1000) },
      { productId: 'chicken', requestedG: g(1000) },
    ];

    // Per line, twice — the wrong way. Each line individually fits.
    expect(lines.every((l) => canReserve(stocked, reserved, l.requestedG))).toBe(true);

    // Aggregated — the right way. 2000 > 1500.
    const total = demandByProduct(lines).get('chicken');
    expect(total).toBe(2000);
    expect(canReserve(stocked, reserved, g(total ?? 0))).toBe(false);
  });

  it('is empty for an empty basket', () => {
    expect(demandByProduct([]).size).toBe(0);
  });
});

describe('canOpenBusinessDay (spec §5.1 pre: d? > businessDate)', () => {
  it('allows the first day ever', () => {
    expect(canOpenBusinessDay(null, '2026-08-11')).toBe(true);
  });

  it('allows a strictly later date', () => {
    expect(canOpenBusinessDay('2026-08-11', '2026-08-12')).toBe(true);
    expect(canOpenBusinessDay('2026-12-31', '2027-01-01')).toBe(true);
  });

  it('refuses the past', () => {
    expect(canOpenBusinessDay('2026-08-11', '2026-08-10')).toBe(false);
  });

  it('refuses RE-opening the same day', () => {
    // Strictly greater, not greater-or-equal, and this is the case that
    // matters. Re-opening resets `reserved` to empty (spec: reserved' = ∅)
    // while orders already placed today still hold that stock — every one of
    // them becomes unfunded at once, and nothing surfaces it.
    expect(canOpenBusinessDay('2026-08-11', '2026-08-11')).toBe(false);
  });

  it('refuses a malformed or impossible date', () => {
    expect(canOpenBusinessDay(null, '11-08-2026')).toBe(false);
    expect(canOpenBusinessDay(null, '2026-02-31')).toBe(false);
    expect(canOpenBusinessDay(null, '2026-13-01')).toBe(false);
  });
});

describe('isIsoDate', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true); // leap year
    expect(isIsoDate('2026-02-29')).toBe(false); // not one
    expect(isIsoDate('2000-02-29')).toBe(true); // divisible by 400
    expect(isIsoDate('1900-02-29')).toBe(false); // divisible by 100, not 400
    expect(isIsoDate('2026-04-31')).toBe(false);
    expect(isIsoDate('2026-1-01')).toBe(false);
  });
});

describe('declaredStockIsInCatalog (inv-A1)', () => {
  it('refuses stocking a product that is not in the catalog', () => {
    const catalog = new Set(['a', 'b']);
    expect(declaredStockIsInCatalog(['a'], catalog)).toBe(true);
    expect(declaredStockIsInCatalog(['a', 'c'], catalog)).toBe(false);
    expect(declaredStockIsInCatalog([], catalog)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// THE GATE for this increment: inv-A3 over generated operation sequences.
// ─────────────────────────────────────────────────────────────────────────

/**
 * A seeded PRNG, so a failure is reproducible from the seed printed in the
 * message rather than being a test that fails once and never again.
 *
 * mulberry32 — small, fast, and adequate for generating test inputs. It is
 * not used for anything that needs cryptographic quality.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Op = { kind: 'reserve' | 'release'; amount: number };

describe('PROPERTY: inv-A3 holds over generated operation sequences', () => {
  it('reserved never exceeds stocked, and never goes negative, over 20k sequences', () => {
    const SEQUENCES = 20_000;
    let checked = 0;

    for (let seed = 1; seed <= SEQUENCES; seed++) {
      const rand = mulberry32(seed);
      const stocked = grams(Math.floor(rand() * 5000));
      let reserved = grams(0);

      const opCount = 1 + Math.floor(rand() * 12);
      const applied: Op[] = [];

      for (let i = 0; i < opCount; i++) {
        const kind = rand() < 0.6 ? 'reserve' : 'release';
        // Deliberately generate amounts that OVERSHOOT — the interesting
        // sequences are the ones that try to break the invariant, not the
        // ones that politely stay inside it.
        const amount = Math.floor(rand() * 3000);
        applied.push({ kind, amount });

        if (kind === 'reserve') {
          // The caller contract: check first, then reserve. A caller that
          // skips the check gets an exception, which is also covered above.
          if (canReserve(stocked, reserved, grams(amount))) {
            reserved = reserve(stocked, reserved, grams(amount));
          }
        } else {
          reserved = release(reserved, grams(amount));
        }

        if (!holdsInvA3(stocked, reserved)) {
          throw new Error(
            `inv-A3 violated at seed ${seed}, op ${i}: ` +
              `reserved=${reserved} stocked=${stocked} ops=${JSON.stringify(applied)}`,
          );
        }
        checked++;
      }
    }

    // Guard against the property test silently checking nothing — an empty
    // generator would otherwise pass with a green tick.
    expect(checked).toBeGreaterThan(SEQUENCES);
  });

  it('a basket of generated lines never reserves more than it aggregates', () => {
    for (let seed = 1; seed <= 5_000; seed++) {
      const rand = mulberry32(seed * 7919);
      const productIds = ['p1', 'p2', 'p3'];
      const lineCount = 1 + Math.floor(rand() * 6);

      const lines = Array.from({ length: lineCount }, () => ({
        productId: productIds[Math.floor(rand() * productIds.length)] ?? 'p1',
        requestedG: grams(Math.floor(rand() * 2000)),
      }));

      const demand = demandByProduct(lines);

      // The aggregate must equal the sum of the parts, per product. This is
      // the property that per-line checking silently violates.
      for (const id of productIds) {
        const expected = lines
          .filter((l) => l.productId === id)
          .reduce((sum, l) => sum + l.requestedG, 0);
        expect(demand.get(id) ?? 0).toBe(expected);
      }

      // And the total across the map must equal the total across the lines —
      // nothing is dropped, nothing is double-counted.
      const mapTotal = [...demand.values()].reduce((a, b) => a + b, 0);
      const lineTotal = lines.reduce((a, l) => a + l.requestedG, 0);
      expect(mapTotal).toBe(lineTotal);
    }
  });
});
