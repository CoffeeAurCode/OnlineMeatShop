import { describe, expect, it } from 'vitest';

import {
  cartFingerprint,
  evaluatePlacement,
  type PlacementContext,
  type PlacementInput,
  type ProductView,
  type StockView,
} from '@/domain/placement';
import type { ZoneFee } from '@/domain/serviceability';
import type { SlotView } from '@/domain/slots';
import { cents, grams } from '@/domain/types';

/**
 * Every one of the eight failure paths, reachable from plain objects with no
 * database. DTM §7.4 requires each to be reachable in a test; this is where
 * that requirement is discharged cheaply, so the concurrency suite can spend
 * its much more expensive time on the ones that need real row locks.
 *
 * ⚠ Fictional FSAs, prices and quantities throughout — this repo is public.
 */

const NOW = Date.UTC(2026, 7, 12, 12, 0);
const HOUR = 3_600_000;

const ZONE: ZoneFee = { zoneId: 'z1', feeCents: cents(500), freeAboveCents: cents(5000) };
const ZONES = new Map<string, ZoneFee>([['A1A', ZONE]]);

const CHICKEN: ProductView = {
  id: 'p-chicken',
  name: 'Sample Chicken',
  handling: 'RAW',
  pricing: { mode: 'perKg', ratePerKg: cents(1200), minOrder: grams(500), step: grams(250) },
  taxCode: 'ZERO_RATED_BASIC_GROCERY',
  active: true,
};

const HOT_CURRY: ProductView = {
  id: 'p-hot',
  name: 'Sample Hot Curry',
  handling: 'COOKED_HOT',
  pricing: { mode: 'pack', price: cents(1500), wMin: grams(400), wMax: grams(500) },
  taxCode: 'STANDARD',
  active: true,
};

const SLOT: SlotView = {
  id: 's1',
  startsAtMs: NOW + 6 * HOUR,
  endsAtMs: NOW + 8 * HOUR,
  cutoffAtMs: NOW + 2 * HOUR,
  capacity: 10,
  bookedCount: 0,
  hotEligible: false,
  active: true,
};

function ctx(over: Partial<PlacementContext> = {}): PlacementContext {
  return {
    slot: SLOT,
    zones: ZONES,
    // No circles by default. The postal path is still the default path, so
    // every existing case here goes through it unchanged.
    geoZones: [],
    products: new Map([
      [CHICKEN.id, CHICKEN],
      [HOT_CURRY.id, HOT_CURRY],
    ]),
    stock: new Map<string, StockView>([
      [CHICKEN.id, { stockedG: grams(10_000), reservedG: grams(0) }],
      [HOT_CURRY.id, { stockedG: grams(10_000), reservedG: grams(0) }],
    ]),
    ...over,
  };
}

function input(over: Partial<PlacementInput> = {}): PlacementInput {
  return {
    postalCode: 'A1A 1A1',
    point: null,
    lines: [{ productId: CHICKEN.id, prepOptionId: null, requestedG: grams(1000) }],
    nowMs: NOW,
    catalogVersion: 7,
    quote: null,
    ...over,
  };
}

describe('the accepted case', () => {
  it('prices the basket and adds the delivery fee', () => {
    const d = evaluatePlacement(input(), ctx());
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.estLineTotalCents).toBe(1200);
    expect(d.deliveryFeeCents).toBe(500);
    expect(d.estTotalCents).toBe(1700);
    expect(d.hasHotLine).toBe(false);
  });

  it('applies free delivery once the LINE subtotal reaches the threshold', () => {
    // The fee is decided on the line subtotal, never on a total that already
    // includes the fee — that would make the fee depend on itself.
    const d = evaluatePlacement(
      input({ lines: [{ productId: CHICKEN.id, prepOptionId: null, requestedG: grams(5000) }] }),
      ctx(),
    );
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.estLineTotalCents).toBe(6000);
    expect(d.deliveryFeeCents).toBe(0);
    expect(d.estTotalCents).toBe(6000);
  });
});

describe('P1 — outsideDeliveryArea', () => {
  it('refuses an unserved FSA and a malformed postal code', () => {
    for (const postalCode of ['Z9Z 9Z9', 'nonsense']) {
      expect(evaluatePlacement(input({ postalCode }), ctx())).toEqual({
        ok: false,
        reason: 'outsideDeliveryArea',
      });
    }
  });
});

describe('P2 — slotCutoffPassed', () => {
  it('refuses at and after the cutoff', () => {
    const atCutoff = evaluatePlacement(input({ nowMs: SLOT.cutoffAtMs }), ctx());
    expect(atCutoff).toMatchObject({ ok: false, reason: 'slotCutoffPassed' });
  });

  it('refuses a slot that did not resolve to a row', () => {
    expect(evaluatePlacement(input(), ctx({ slot: null }))).toMatchObject({
      ok: false,
      reason: 'slotCutoffPassed',
    });
  });
});

describe('P3 — slotFull', () => {
  it('refuses a slot at capacity', () => {
    expect(
      evaluatePlacement(input(), ctx({ slot: { ...SLOT, bookedCount: 10 } })),
    ).toMatchObject({ ok: false, reason: 'slotFull' });
  });
});

describe('P4 — productUnavailable', () => {
  it('refuses a product that does not exist, naming it', () => {
    const d = evaluatePlacement(
      input({ lines: [{ productId: 'p-ghost', prepOptionId: null, requestedG: grams(1000) }] }),
      ctx(),
    );
    expect(d).toMatchObject({ ok: false, reason: 'productUnavailable' });
    if (!d.ok) expect(d.detail?.productId).toBe('p-ghost');
  });

  it('refuses a deactivated product, and gives the frontend its name', () => {
    const d = evaluatePlacement(
      input(),
      ctx({ products: new Map([[CHICKEN.id, { ...CHICKEN, active: false }]]) }),
    );
    expect(d).toMatchObject({ ok: false, reason: 'productUnavailable' });
    if (!d.ok) expect(d.detail?.productName).toBe('Sample Chicken');
  });
});

describe('P5 — invalidQuantity', () => {
  it('refuses below the minimum and off the step, and says what they are', () => {
    const below = evaluatePlacement(
      input({ lines: [{ productId: CHICKEN.id, prepOptionId: null, requestedG: grams(250) }] }),
      ctx(),
    );
    expect(below).toMatchObject({ ok: false, reason: 'invalidQuantity' });
    if (!below.ok) {
      expect(below.detail?.minOrderG).toBe(500);
      expect(below.detail?.stepG).toBe(250);
    }

    const offStep = evaluatePlacement(
      input({ lines: [{ productId: CHICKEN.id, prepOptionId: null, requestedG: grams(700) }] }),
      ctx(),
    );
    expect(offStep).toMatchObject({ ok: false, reason: 'invalidQuantity' });
  });

  it('refuses an empty basket', () => {
    // Not a spec failure code, because the spec does not model an empty
    // basket. It cannot be accepted either: it would book a slot and reserve
    // nothing.
    expect(evaluatePlacement(input({ lines: [] }), ctx())).toMatchObject({
      ok: false,
      reason: 'invalidQuantity',
    });
  });
});

describe('P6 — insufficientStock', () => {
  it('refuses when demand exceeds what is left, reporting the real remainder', () => {
    const d = evaluatePlacement(
      input({ lines: [{ productId: CHICKEN.id, prepOptionId: null, requestedG: grams(1000) }] }),
      ctx({
        stock: new Map([[CHICKEN.id, { stockedG: grams(1000), reservedG: grams(750) }]]),
      }),
    );
    expect(d).toMatchObject({ ok: false, reason: 'insufficientStock' });
    // The real number, so the frontend can say "only 250g left" rather than
    // "out of stock" about something that is not.
    if (!d.ok) expect(d.detail?.availableG).toBe(250);
  });

  it('treats an unstocked product as zero available', () => {
    expect(evaluatePlacement(input(), ctx({ stock: new Map() }))).toMatchObject({
      ok: false,
      reason: 'insufficientStock',
    });
  });

  it('⭐ AGGREGATES duplicate product lines rather than checking each', () => {
    // 1.5kg in stock, basket asks 1kg + 1kg as two lines. This is the ordinary
    // basket — cut preferences do not create separate products.
    const d = evaluatePlacement(
      input({
        lines: [
          { productId: CHICKEN.id, prepOptionId: 'curry', requestedG: grams(1000) },
          { productId: CHICKEN.id, prepOptionId: 'biryani', requestedG: grams(1000) },
        ],
      }),
      ctx({ stock: new Map([[CHICKEN.id, { stockedG: grams(1500), reservedG: grams(0) }]]) }),
    );
    expect(d).toMatchObject({ ok: false, reason: 'insufficientStock' });
  });

  it('accepts the same two lines when the aggregate fits, and reports the sum', () => {
    const d = evaluatePlacement(
      input({
        lines: [
          { productId: CHICKEN.id, prepOptionId: 'curry', requestedG: grams(1000) },
          { productId: CHICKEN.id, prepOptionId: 'biryani', requestedG: grams(1000) },
        ],
      }),
      ctx({ stock: new Map([[CHICKEN.id, { stockedG: grams(2000), reservedG: grams(0) }]]) }),
    );
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.demandByProduct.get(CHICKEN.id)).toBe(2000);
      expect(d.lines).toHaveLength(2);
    }
  });
});

describe('P7 — hotFoodNotAllowedInSlot', () => {
  it('refuses a hot line in a non-hot slot', () => {
    const d = evaluatePlacement(
      input({ lines: [{ productId: HOT_CURRY.id, prepOptionId: null, requestedG: grams(0) }] }),
      ctx(),
    );
    expect(d).toMatchObject({ ok: false, reason: 'hotFoodNotAllowedInSlot' });
  });

  it('accepts a hot line in a hot-eligible slot, and flags the order as hot', () => {
    const d = evaluatePlacement(
      input({ lines: [{ productId: HOT_CURRY.id, prepOptionId: null, requestedG: grams(0) }] }),
      ctx({ slot: { ...SLOT, hotEligible: true } }),
    );
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.hasHotLine).toBe(true);
  });

  it('applies to the WHOLE order — one hot line constrains every other line', () => {
    const d = evaluatePlacement(
      input({
        lines: [
          { productId: CHICKEN.id, prepOptionId: null, requestedG: grams(1000) },
          { productId: HOT_CURRY.id, prepOptionId: null, requestedG: grams(0) },
        ],
      }),
      ctx(),
    );
    expect(d).toMatchObject({ ok: false, reason: 'hotFoodNotAllowedInSlot' });
  });
});

describe('P8 — priceChanged (DTM §7.3)', () => {
  const quote = {
    quotedEstCents: cents(1700),
    quoteVersion: 7,
    authorisedCeilingCents: cents(1870),
  };

  it('accepts when the version and the total both still match', () => {
    expect(evaluatePlacement(input({ quote }), ctx()).ok).toBe(true);
  });

  it('refuses when the catalog version moved, EVEN IF the total is identical', () => {
    // Two products repriced in opposite directions leave the total unchanged.
    // The version is what catches that, which is why both halves are checked
    // rather than only the cheaper-looking one.
    expect(
      evaluatePlacement(input({ quote, catalogVersion: 8 }), ctx()),
    ).toMatchObject({ ok: false, reason: 'priceChanged' });
  });

  it('refuses when the recomputed total differs, and reports the new number', () => {
    const d = evaluatePlacement(
      input({ quote: { ...quote, quotedEstCents: cents(1500) } }),
      ctx(),
    );
    expect(d).toMatchObject({ ok: false, reason: 'priceChanged' });
    // The frontend needs this for the re-confirm screen. It must never
    // auto-accept it — NFR-2, and a promise already made to the client.
    if (!d.ok) expect(d.detail?.recomputedEstCents).toBe(1700);
  });

  it('refuses when the total exceeds the ceiling actually authorised', () => {
    expect(
      evaluatePlacement(
        input({ quote: { ...quote, authorisedCeilingCents: cents(1000) } }),
        ctx(),
      ),
    ).toMatchObject({ ok: false, reason: 'priceChanged' });
  });

  it('skips P8 entirely when there is no quote to have gone stale', () => {
    // An admin-entered order has no earlier authorisation, so there is nothing
    // for P8 to compare against — and it must not fail for lack of one.
    expect(evaluatePlacement(input({ quote: null, catalogVersion: 999 }), ctx()).ok).toBe(true);
  });
});

describe('cartFingerprint', () => {
  const base = {
    point: null,
    postalCode: 'A1A 1A1',
    slotId: 's1',
    payMode: 'PREPAID',
    lines: [
      { productId: 'a', prepOptionId: null, requestedG: grams(1000) },
      { productId: 'b', prepOptionId: 'curry', requestedG: grams(500) },
    ],
  };

  it('is stable under line reordering — that is not a new cart', () => {
    const reversed = { ...base, lines: [...base.lines].reverse() };
    expect(cartFingerprint(base)).toBe(cartFingerprint(reversed));
  });

  it('is stable under postal-code formatting', () => {
    expect(cartFingerprint({ ...base, postalCode: 'a1a1a1' })).toBe(cartFingerprint(base));
  });

  it('CHANGES for every field that changes what is bought', () => {
    // If any of these did not change the fingerprint, the edited cart would
    // reuse the existing hold — the customer authorised for one basket and
    // charged for another.
    const variants = [
      { ...base, slotId: 's2' },
      { ...base, payMode: 'COD' },
      { ...base, postalCode: 'A1A 2B2' },
      {
        ...base,
        lines: [
          { productId: 'a', prepOptionId: null, requestedG: grams(1500) },
          base.lines[1]!,
        ],
      },
      // Prep option changes what is physically produced even though the price
      // is identical, so it is part of the cart's identity.
      {
        ...base,
        lines: [base.lines[0]!, { productId: 'b', prepOptionId: 'mince', requestedG: grams(500) }],
      },
    ];
    for (const v of variants) {
      expect(cartFingerprint(v)).not.toBe(cartFingerprint(base));
    }
  });
});
