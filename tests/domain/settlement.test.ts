import { describe, expect, it } from 'vitest';

import {
  allPerKgLinesWeighed,
  recordActualWeight,
  toleranceBand,
  unweighedLineIds,
  type WeighableLine,
} from '@/domain/weighing';
import {
  describeDelta,
  finalise,
  releasedFromHold,
  settlementPath,
  stripeKeys,
  type FinalisableLine,
} from '@/domain/settlement';
import { basisPoints, lineTax, taxByRate, totalTax } from '@/domain/tax';
import { cents, grams } from '@/domain/types';

/**
 * ⭐ THE GATE for increment 5: settlement logic tested with ZERO network calls.
 *
 * Which is achievable only because none of these modules can make one — the
 * domain boundary is what turns "we should test this without Stripe" into
 * "this cannot reach Stripe".
 */

const PER_KG: WeighableLine['pricing'] = {
  mode: 'perKg',
  ratePerKg: cents(1200),
  minOrder: grams(500),
  step: grams(250),
};
const PACK: WeighableLine['pricing'] = {
  mode: 'pack',
  price: cents(1500),
  wMin: grams(400),
  wMax: grams(500),
};

function line(over: Partial<WeighableLine> = {}): WeighableLine {
  return {
    lineId: 'l1',
    pricing: PER_KG,
    requestedG: grams(1000),
    actWeightG: null,
    varianceApproved: false,
    ...over,
  };
}

describe('recordActualWeight (spec §5.4)', () => {
  it('accepts a weight inside the band and prices it on the actual weight', () => {
    const r = recordActualWeight('PREPARING', line(), grams(1050));
    expect(r).toEqual({ ok: true, actWeightG: 1050, actAmountCents: 1260 });
  });

  it('accepts exactly at both edges of the band', () => {
    expect(recordActualWeight('PREPARING', line(), grams(900)).ok).toBe(true);
    expect(recordActualWeight('PREPARING', line(), grams(1100)).ok).toBe(true);
  });

  it('REFUSES outside the band — it does not clamp and does not charge', () => {
    // The band is not a rounding allowance. Outside it, this is a different
    // purchase and the customer has to agree to it; a butcher cannot decide
    // unilaterally that someone is buying 30% more meat.
    const r = recordActualWeight('PREPARING', line(), grams(1300));
    expect(r).toMatchObject({ ok: false, reason: 'varianceApprovalRequired' });
    if (!r.ok) {
      expect(r.detail?.lowerG).toBe(900);
      expect(r.detail?.upperG).toBe(1100);
    }
  });

  it('lets an APPROVED variance through — the only way out of the band', () => {
    const r = recordActualWeight('PREPARING', line({ varianceApproved: true }), grams(1300));
    expect(r).toEqual({ ok: true, actWeightG: 1300, actAmountCents: 1560 });
  });

  it('refuses to weigh a pack line at all (inv-O6)', () => {
    expect(recordActualWeight('PREPARING', line({ pricing: PACK }), grams(450))).toEqual({
      ok: false,
      reason: 'packLineNotWeighable',
    });
  });

  it('refuses unless the order is PREPARING', () => {
    // PLACED means the butcher has not started. WEIGHED means re-weighing
    // after the final total was computed, which silently invalidates it.
    for (const status of ['PLACED', 'WEIGHED', 'READY', 'DELIVERED', 'CANCELLED'] as const) {
      expect(recordActualWeight(status, line(), grams(1000))).toEqual({
        ok: false,
        reason: 'orderNotInPreparation',
      });
    }
  });

  it('reports the band for the console to show BEFORE the scale is read', () => {
    expect(toleranceBand(grams(1000))).toEqual({ lowerG: 900, upperG: 1100 });
    // Inclusive rounding: ceil the lower bound, floor the upper, so a weight
    // shown as acceptable really is.
    expect(toleranceBand(grams(755))).toEqual({ lowerG: 680, upperG: 830 });
  });
});

describe('Finalise preconditions', () => {
  it('ignores pack lines when asking whether weighing is done', () => {
    // Requiring a weight on every line would deadlock any order containing a
    // pack item — it can never be weighed, so it can never be finalised.
    const lines = [line({ lineId: 'a', pricing: PACK }), line({ lineId: 'b', actWeightG: grams(1000) })];
    expect(allPerKgLinesWeighed(lines)).toBe(true);
    expect(unweighedLineIds(lines)).toEqual([]);
  });

  it('names the lines still holding it up', () => {
    const lines = [line({ lineId: 'a' }), line({ lineId: 'b', actWeightG: grams(900) })];
    expect(allPerKgLinesWeighed(lines)).toBe(false);
    expect(unweighedLineIds(lines)).toEqual(['a']);
  });
});

describe('finalise — cappedTotal (spec §5.5)', () => {
  const fee = cents(500);

  function fl(over: Partial<FinalisableLine> = {}): FinalisableLine {
    return { lineId: 'l1', mode: 'perKg', estAmountCents: cents(1200), actAmountCents: null, ...over };
  }

  it('refuses while any per-kg line is unweighed', () => {
    const r = finalise([fl()], fee, cents(1700));
    expect(r).toMatchObject({ ok: false, reason: 'weighingIncomplete' });
    if (!r.ok) expect(r.unweighed).toEqual(['l1']);
  });

  it('charges the actual when it came in UNDER the estimate', () => {
    const r = finalise([fl({ actAmountCents: cents(1080) })], fee, cents(1700));
    expect(r).toMatchObject({ ok: true, finalTotalCents: 1580, cappedAtCeiling: false });
    // Negative delta: we owe the customer the difference, i.e. we hold less.
    if (r.ok) expect(r.deltaCents).toBe(-120);
  });

  it('charges the actual when it came in slightly OVER but inside the cap', () => {
    const r = finalise([fl({ actAmountCents: cents(1260) })], fee, cents(1700));
    expect(r).toMatchObject({ ok: true, finalTotalCents: 1760, cappedAtCeiling: false });
  });

  it('⭐ CAPS at estimate + tolerance when the actual overshoots', () => {
    // 1200 × 1.10 = 1320 line ceiling, + 500 fee = 1820. The actual would be
    // 2000 + 500 = 2500. The customer pays 1820 and the shop eats 680.
    // This is the promise made to the client, in one assertion.
    const r = finalise([fl({ actAmountCents: cents(2000) })], fee, cents(1700));
    expect(r).toMatchObject({ ok: true, finalTotalCents: 1820, cappedAtCeiling: true });
  });

  it('never scales the delivery fee by the tolerance', () => {
    // Fee appears on both sides of the min, so it is added once at face value.
    // Inflating a fixed delivery charge by 10% because the meat came in heavy
    // would be indefensible on an invoice.
    const r = finalise([fl({ actAmountCents: cents(5000) })], cents(999), cents(2199));
    if (r.ok) expect(r.finalTotalCents).toBe(1320 + 999);
  });

  it('treats a pack line as its own actual', () => {
    const r = finalise(
      [fl({ lineId: 'p', mode: 'pack', estAmountCents: cents(1500), actAmountCents: null })],
      cents(0),
      cents(1500),
    );
    expect(r).toMatchObject({ ok: true, finalTotalCents: 1500 });
  });
});

describe('settlementPath (spec §5.6)', () => {
  it('is ONE capture for prepaid — not a charge and a refund', () => {
    // The spec has separate SettleRefund and SettleCollect operations because
    // it assumed a rail that could only charge the estimate and refund the
    // difference (assumption A-2, dead). Stripe holds a ceiling and captures
    // an exact amount, so there is nothing to refund.
    expect(settlementPath('PREPAID', cents(1580), cents(1870))).toEqual({
      kind: 'capture',
      captureCents: 1580,
    });
  });

  it('attaches the amount to the delivery for COD', () => {
    expect(settlementPath('COD', cents(1580), cents(1870))).toEqual({
      kind: 'dueOnDelivery',
      amountDueCents: 1580,
    });
  });

  it('THROWS rather than attempting a capture above the authorisation', () => {
    // Unreachable if cappedTotal is working, which is exactly why it is
    // checked. Stripe refuses this at settlement — long after anyone is
    // watching — so it must fail here instead, loudly.
    expect(() => settlementPath('PREPAID', cents(2000), cents(1870))).toThrow(/cap is broken/);
  });

  it('reports what is released back to the customer', () => {
    expect(releasedFromHold(cents(1870), cents(1580))).toBe(290);
    expect(releasedFromHold(cents(1870), cents(1870))).toBe(0);
  });

  it('describes the direction of the delta for the receipt', () => {
    expect(describeDelta(-120 as never)).toBe('less');
    expect(describeDelta(0 as never)).toBe('same');
    expect(describeDelta(60 as never)).toBe('more');
  });
});

describe('Stripe idempotency keys', () => {
  it('are stable across retries', () => {
    expect(stripeKeys.create('a1', 7)).toBe(stripeKeys.create('a1', 7));
    expect(stripeKeys.capture('o1', cents(1580))).toBe(stripeKeys.capture('o1', cents(1580)));
  });

  it('⭐ CHANGE when the amount changes', () => {
    // Stripe replays the ORIGINAL response for a reused key. A capture key
    // that ignored the amount would silently return the old capture for a new
    // number — a quiet, real-money bug with no error anywhere.
    expect(stripeKeys.capture('o1', cents(1580))).not.toBe(stripeKeys.capture('o1', cents(1600)));
    expect(stripeKeys.create('a1', 7)).not.toBe(stripeKeys.create('a1', 8));
  });

  it('never collide across operations on the same entity', () => {
    const keys = new Set([
      stripeKeys.create('x', 1),
      stripeKeys.cancel('x'),
      stripeKeys.capture('x', cents(1)),
    ]);
    expect(keys.size).toBe(3);
  });
});

describe('tax (DTM §10) — the mechanism; rates are blocked on DQ-2', () => {
  // ⚠ FICTIONAL rates. Real ones come from the client's accountant and are
  // configuration, never code.
  const TABLE = new Map([
    ['ZERO_RATED_BASIC_GROCERY', basisPoints(0)],
    ['GST_ONLY', basisPoints(500)],
    ['HST_13', basisPoints(1300)],
  ]);

  it('computes per line from the explicit code, never from handling', () => {
    expect(lineTax(cents(1000), 'GST_ONLY', TABLE)).toEqual({
      taxCode: 'GST_ONLY',
      rateBasisPoints: 500,
      taxCents: 50,
    });
    expect(lineTax(cents(1000), 'ZERO_RATED_BASIC_GROCERY', TABLE).taxCents).toBe(0);
  });

  it('THROWS on an unknown code rather than defaulting to zero', () => {
    // A missing code silently treated as zero-rated undercharges tax on every
    // sale of that product, and the shortfall is the shop's to pay.
    expect(() => lineTax(cents(1000), 'NOT_CONFIGURED', TABLE)).toThrow(/must not default to zero/);
  });

  it('rounds half up, in integer arithmetic', () => {
    // 1005 × 5% = 50.25 → 50;  1015 × 5% = 50.75 → 51;  1010 × 5% = 50.5 → 51
    expect(lineTax(cents(1005), 'GST_ONLY', TABLE).taxCents).toBe(50);
    expect(lineTax(cents(1015), 'GST_ONLY', TABLE).taxCents).toBe(51);
    expect(lineTax(cents(1010), 'GST_ONLY', TABLE).taxCents).toBe(51);
  });

  it('lets ONE basket mix zero-rated and taxable lines', () => {
    // The reason tax is per line and not per order. An order-level rate cannot
    // represent raw meat next to hot food.
    const lines = [
      lineTax(cents(2000), 'ZERO_RATED_BASIC_GROCERY', TABLE),
      lineTax(cents(1500), 'HST_13', TABLE),
    ];
    expect(totalTax(lines)).toBe(195);
    expect(taxByRate(lines).get(basisPoints(1300))).toBe(195);
    expect(taxByRate(lines).get(basisPoints(0))).toBe(0);
  });

  it('refuses a nonsensical rate at construction', () => {
    expect(() => basisPoints(-1)).toThrow();
    expect(() => basisPoints(10_001)).toThrow();
    expect(() => basisPoints(5.5)).toThrow();
  });
});
