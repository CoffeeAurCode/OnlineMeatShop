import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { migrateTestDatabase, testPool, truncateAll } from '../integration/helpers/db';
import {
  FSA_SERVED,
  seedAuthorisedAttempt,
  seedBusinessDay,
  seedCustomer,
  seedPerKgProduct,
  seedServedArea,
  seedSlot,
} from '../integration/helpers/fixtures';

/**
 * ⭐⭐ THE GATE. If this file is not in CI and green, increment 4 is not done.
 *
 * From the ADR and DTM §7.5, restated as a hard requirement:
 *
 *   N concurrent PlaceOrder calls against 1 unit of stock must yield
 *   EXACTLY 1 acceptance and N−1 insufficientStock.
 *
 * THIS DOES NOT RELAX AT LOW VOLUME. Two customers racing for the last tray is
 * a correctness bug at 3 orders/day exactly as at 300 — just rarer, which
 * makes it worse, because a rare oversell survives review and surfaces at the
 * worst possible moment. The latency benchmarks in DTM §7.5 are advisory
 * (D17); these five are not, and never become so.
 *
 * Every test here asserts TWO things: the right answer, and that the losers
 * left `reserved_g` and `booked_count` byte-identical. The second is the one
 * that catches a partial write.
 */

const POSTAL = `${FSA_SERVED} 1A1`;

/** 50, as specified. Enough that a missing lock loses reliably, not sometimes. */
const N = 50;

let pool: Pool;
let repo: typeof import('@/db/repositories/placement');

beforeAll(async () => {
  await migrateTestDatabase();
  pool = testPool();
  repo = await import('@/db/repositories/placement');
});

afterAll(async () => {
  await pool.end();
  const { pool: appPool } = await import('@/db/client');
  await appPool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

async function stockRow(): Promise<{ stocked_g: number; reserved_g: number }> {
  const { rows } = await pool.query(`SELECT stocked_g, reserved_g FROM stock_item`);
  return rows[0];
}

async function slotRow(): Promise<{ capacity: number; booked_count: number }> {
  const { rows } = await pool.query(`SELECT capacity, booked_count FROM slot`);
  return rows[0];
}

async function orderCount(): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "order"`);
  return rows[0].n;
}

function tally(results: readonly { ok: boolean; reason?: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) {
    const key = r.ok ? 'accepted' : (r.reason ?? 'unknown');
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

describe('1. N buyers, ONE unit of stock', () => {
  it(`${N} concurrent placements against 1kg yield exactly 1 acceptance`, async () => {
    await seedServedArea(pool);
    const chicken = await seedPerKgProduct(pool, {
      slug: 'chicken',
      ratePerKgCents: 1200,
      minOrderG: 1000,
      stepG: 1000,
    });
    // Exactly one unit. Capacity is generous so the SLOT cannot be what
    // rejects anyone — this test must fail for the stock reason or not at all.
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 1000 },
    ]);
    const slotId = await seedSlot(pool, { capacity: N + 10 });

    const customers = await Promise.all(
      Array.from({ length: N }, (_, i) => seedCustomer(pool, `buyer${i}@example.test`)),
    );

    const results = await Promise.all(
      customers.map((customerId) =>
        repo.placeOrder({
          attemptId: null,
          customerId,
          postalCode: POSTAL,
          slotId,
          businessDayId: dayId,
          payMode: 'PREPAID',
          lines: [{ productId: chicken.id, prepOptionId: null, requestedG: 1000 as never }],
          nowMs: Date.now(),
        }),
      ),
    );

    expect(tally(results)).toEqual({ accepted: 1, insufficientStock: N - 1 });
    expect(await orderCount()).toBe(1);

    // The winner reserved everything; the 49 losers changed nothing.
    expect(await stockRow()).toEqual({ stocked_g: 1000, reserved_g: 1000 });
    expect((await slotRow()).booked_count).toBe(1);
  });
});

describe('1b. N buyers, ONE unit of stock, DIFFERENT slots', () => {
  /**
   * ⚠ THIS TEST EXISTS BECAUSE TEST 1 PASSES FOR THE WRONG REASON.
   *
   * Test 1 puts every buyer in the same slot, and the slot is locked FOR
   * UPDATE first. So all N placements serialise on the SLOT row and the stock
   * lock is never what protects the stock. Demonstrated by mutation: deleting
   * `FOR UPDATE` from the stock read *and* the guarded WHERE from the
   * reservation left test 1 green.
   *
   * A gate that cannot fail is not a gate. Giving every buyer their own slot
   * removes the incidental serialisation and leaves the stock lock as the only
   * thing standing between 50 buyers and 1kg of chicken — which is what the
   * requirement actually says.
   *
   * The real-world shape of this: two customers, one ordering into the 5pm
   * window and one into the 7pm window, both taking the last tray.
   */
  it(`${N} concurrent placements across ${N} slots still yield exactly 1 acceptance`, async () => {
    await seedServedArea(pool);
    const chicken = await seedPerKgProduct(pool, {
      slug: 'chicken',
      ratePerKgCents: 1200,
      minOrderG: 1000,
      stepG: 1000,
    });
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 1000 },
    ]);

    // One slot each: no two placements contend on a slot row.
    const slotIds = await Promise.all(
      Array.from({ length: N }, () => seedSlot(pool, { capacity: 5 })),
    );
    const customers = await Promise.all(
      Array.from({ length: N }, (_, i) => seedCustomer(pool, `xslot${i}@example.test`)),
    );

    const results = await Promise.all(
      customers.map((customerId, i) =>
        repo.placeOrder({
          attemptId: null,
          customerId,
          postalCode: POSTAL,
          slotId: slotIds[i] as string,
          businessDayId: dayId,
          payMode: 'PREPAID',
          lines: [{ productId: chicken.id, prepOptionId: null, requestedG: 1000 as never }],
          nowMs: Date.now(),
        }),
      ),
    );

    expect(tally(results)).toEqual({ accepted: 1, insufficientStock: N - 1 });
    expect(await orderCount()).toBe(1);
    expect(await stockRow()).toEqual({ stocked_g: 1000, reserved_g: 1000 });

    // Exactly one slot took a booking, and the other 49 are untouched.
    const { rows } = await pool.query(
      `SELECT coalesce(sum(booked_count), 0)::int AS total FROM slot`,
    );
    expect(rows[0].total).toBe(1);
  });
});

describe('2. N buyers, slot capacity ONE', () => {
  it(`${N} concurrent placements against a 1-place slot yield exactly 1 acceptance`, async () => {
    await seedServedArea(pool);
    const chicken = await seedPerKgProduct(pool, {
      slug: 'chicken',
      ratePerKgCents: 1200,
      minOrderG: 1000,
      stepG: 1000,
    });
    // Stock is generous so the STOCK cannot be what rejects anyone.
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 1000 * (N + 10) },
    ]);
    const slotId = await seedSlot(pool, { capacity: 1 });

    const customers = await Promise.all(
      Array.from({ length: N }, (_, i) => seedCustomer(pool, `slotbuyer${i}@example.test`)),
    );

    const results = await Promise.all(
      customers.map((customerId) =>
        repo.placeOrder({
          attemptId: null,
          customerId,
          postalCode: POSTAL,
          slotId,
          businessDayId: dayId,
          payMode: 'PREPAID',
          lines: [{ productId: chicken.id, prepOptionId: null, requestedG: 1000 as never }],
          nowMs: Date.now(),
        }),
      ),
    );

    expect(tally(results)).toEqual({ accepted: 1, slotFull: N - 1 });
    expect(await orderCount()).toBe(1);
    expect(await slotRow()).toEqual({ capacity: 1, booked_count: 1 });

    // ⚠ The one that would be easy to miss: the 49 rejections must not have
    // reserved stock on their way to being refused for the SLOT.
    expect((await stockRow()).reserved_g).toBe(1000);
  });
});

describe('3. The same product on TWO lines of one basket', () => {
  it('aggregates demand across lines instead of checking each one', async () => {
    await seedServedArea(pool);
    const chicken = await seedPerKgProduct(pool, {
      slug: 'chicken',
      ratePerKgCents: 1200,
      minOrderG: 500,
      stepG: 500,
    });
    // 1.5kg in stock. The basket asks for 1kg + 1kg as two lines — the NORMAL
    // case, because cut preferences do not create separate products. Per-line
    // checking sees 1 <= 1.5 twice and accepts. Aggregation sees 2 > 1.5.
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 1500 },
    ]);
    const slotId = await seedSlot(pool, { capacity: 10 });
    const customerId = await seedCustomer(pool);

    const result = await repo.placeOrder({
      attemptId: null,
      customerId,
      postalCode: POSTAL,
      slotId,
      businessDayId: dayId,
      payMode: 'PREPAID',
      lines: [
        { productId: chicken.id, prepOptionId: null, requestedG: 1000 as never },
        { productId: chicken.id, prepOptionId: null, requestedG: 1000 as never },
      ],
      nowMs: Date.now(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('insufficientStock');

    expect(await orderCount()).toBe(0);
    expect(await stockRow()).toEqual({ stocked_g: 1500, reserved_g: 0 });
    expect((await slotRow()).booked_count).toBe(0);
  });

  it('accepts two lines of one product when the AGGREGATE fits, and reserves the sum', async () => {
    await seedServedArea(pool);
    const chicken = await seedPerKgProduct(pool, {
      slug: 'chicken',
      ratePerKgCents: 1200,
      minOrderG: 500,
      stepG: 500,
    });
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 2000 },
    ]);
    const slotId = await seedSlot(pool, { capacity: 10 });
    const customerId = await seedCustomer(pool);

    const result = await repo.placeOrder({
      attemptId: null,
      customerId,
      postalCode: POSTAL,
      slotId,
      businessDayId: dayId,
      payMode: 'PREPAID',
      lines: [
        { productId: chicken.id, prepOptionId: null, requestedG: 1000 as never },
        { productId: chicken.id, prepOptionId: null, requestedG: 1000 as never },
      ],
      nowMs: Date.now(),
    });

    expect(result.ok).toBe(true);
    // Two lines, one reservation of 2000g — not two of 1000g, and not one of
    // 1000g. Both wrong answers are one plausible refactor away.
    expect(await stockRow()).toEqual({ stocked_g: 2000, reserved_g: 2000 });
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM order_line`);
    expect(rows[0].n).toBe(2);
  });
});

describe('4. The SAME checkout attempt submitted twice, concurrently', () => {
  it('produces exactly one order, and the loser is told which order it was', async () => {
    await seedServedArea(pool);
    const chicken = await seedPerKgProduct(pool, {
      slug: 'chicken',
      ratePerKgCents: 1200,
      minOrderG: 1000,
      stepG: 1000,
    });
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 10_000 },
    ]);
    const slotId = await seedSlot(pool, { capacity: 10 });
    const customerId = await seedCustomer(pool);

    // 1kg at $12.00/kg = 1200 cents, zero delivery fee in this fixture zone.
    const attemptId = await seedAuthorisedAttempt(pool, {
      customerId,
      cartHash: 'cart-1',
      quotedEstCents: 1200,
    });

    const submit = () =>
      repo.placeOrder({
        attemptId,
        customerId,
        postalCode: POSTAL,
        slotId,
        businessDayId: dayId,
        payMode: 'PREPAID',
        lines: [{ productId: chicken.id, prepOptionId: null, requestedG: 1000 as never }],
        nowMs: Date.now(),
      });

    const [a, b] = await Promise.all([submit(), submit()]);

    const accepted = [a, b].filter((r) => r.ok);
    const rejected = [a, b].filter((r) => !r.ok);

    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // ⚠ THE PART MOST LIKELY TO BE GOT WRONG. The second submit is a
    // double-tap, not an error. It must carry the order the first one created,
    // so the customer sees their order rather than an alarming failure for a
    // purchase that actually succeeded.
    const loser = rejected[0];
    expect(loser?.ok).toBe(false);
    if (loser && !loser.ok) {
      expect(loser.reason).toBe('checkoutAttemptNotOpen');
      expect(loser.orderId).toBeDefined();
      if (accepted[0]?.ok) expect(loser.orderId).toBe(accepted[0].orderId);
    }

    expect(await orderCount()).toBe(1);
    // One order, ONE reservation. A second would be a second hold on the card.
    expect((await stockRow()).reserved_g).toBe(1000);
    expect((await slotRow()).booked_count).toBe(1);
  });

  it('a re-submit AFTER the first has committed is also silent, not an error', async () => {
    await seedServedArea(pool);
    const chicken = await seedPerKgProduct(pool, {
      slug: 'chicken',
      ratePerKgCents: 1200,
      minOrderG: 1000,
      stepG: 1000,
    });
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 10_000 },
    ]);
    const slotId = await seedSlot(pool, { capacity: 10 });
    const customerId = await seedCustomer(pool);
    const attemptId = await seedAuthorisedAttempt(pool, {
      customerId,
      cartHash: 'cart-1',
      quotedEstCents: 1200,
    });

    const input = {
      attemptId,
      customerId,
      postalCode: POSTAL,
      slotId,
      businessDayId: dayId,
      payMode: 'PREPAID' as const,
      lines: [{ productId: chicken.id, prepOptionId: null, requestedG: 1000 as never }],
      nowMs: Date.now(),
    };

    const first = await repo.placeOrder(input);
    const second = await repo.placeOrder(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok && first.ok) {
      expect(second.reason).toBe('checkoutAttemptNotOpen');
      expect(second.orderId).toBe(first.orderId);
    }
    expect(await orderCount()).toBe(1);
  });
});

describe('5. An admin repricing or deactivating MID-placement', () => {
  /**
   * The interleaving is produced for real, not simulated: a separate
   * connection opens a transaction and takes `FOR UPDATE` on the product,
   * which blocks the placement's `FOR SHARE`. The admin then commits its
   * change, the placement wakes up and reads the NEW row.
   *
   * This is the window P8 exists for. Without it the customer is charged the
   * new price against a hold taken for the old one.
   */
  async function withAdminHoldingProduct(
    productId: string,
    change: string,
    body: () => Promise<unknown>,
  ): Promise<unknown> {
    const admin = await pool.connect();
    try {
      await admin.query('BEGIN');
      await admin.query(`SELECT id FROM product WHERE id = $1 FOR UPDATE`, [productId]);

      // The placement now blocks on FOR SHARE behind that lock.
      const placement = body();

      await admin.query(change, [productId]);
      // Any price or active change must bump the catalog version in the SAME
      // transaction, or P8 has nothing to detect.
      await admin.query(`UPDATE catalog_version SET version = version + 1 WHERE id = 1`);
      await admin.query('COMMIT');

      return await placement;
    } finally {
      admin.release();
    }
  }

  it('deactivating mid-placement yields productUnavailable, not a silent sale', async () => {
    await seedServedArea(pool);
    const chicken = await seedPerKgProduct(pool, {
      slug: 'chicken',
      ratePerKgCents: 1200,
      minOrderG: 1000,
      stepG: 1000,
    });
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 10_000 },
    ]);
    const slotId = await seedSlot(pool, { capacity: 10 });
    const customerId = await seedCustomer(pool);
    const attemptId = await seedAuthorisedAttempt(pool, {
      customerId,
      cartHash: 'cart-1',
      quotedEstCents: 1200,
    });

    const result = (await withAdminHoldingProduct(
      chicken.id,
      `UPDATE product SET active = false WHERE id = $1`,
      () =>
        repo.placeOrder({
          attemptId,
          customerId,
          postalCode: POSTAL,
          slotId,
          businessDayId: dayId,
          payMode: 'PREPAID',
          lines: [{ productId: chicken.id, prepOptionId: null, requestedG: 1000 as never }],
          nowMs: Date.now(),
        }),
    )) as Awaited<ReturnType<typeof repo.placeOrder>>;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('productUnavailable');

    expect(await orderCount()).toBe(0);
    expect(await stockRow()).toEqual({ stocked_g: 10_000, reserved_g: 0 });
    expect((await slotRow()).booked_count).toBe(0);
  });

  it('repricing mid-placement yields priceChanged — NEVER a charge at the new price', async () => {
    await seedServedArea(pool);
    const chicken = await seedPerKgProduct(pool, {
      slug: 'chicken',
      ratePerKgCents: 1200,
      minOrderG: 1000,
      stepG: 1000,
    });
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 10_000 },
    ]);
    const slotId = await seedSlot(pool, { capacity: 10 });
    const customerId = await seedCustomer(pool);
    // Quoted and authorised against $12.00/kg.
    const attemptId = await seedAuthorisedAttempt(pool, {
      customerId,
      cartHash: 'cart-1',
      quotedEstCents: 1200,
      authorisedCeilingCents: 1320,
    });

    const result = (await withAdminHoldingProduct(
      chicken.id,
      `UPDATE product SET rate_per_kg_cents = 1500 WHERE id = $1`,
      () =>
        repo.placeOrder({
          attemptId,
          customerId,
          postalCode: POSTAL,
          slotId,
          businessDayId: dayId,
          payMode: 'PREPAID',
          lines: [{ productId: chicken.id, prepOptionId: null, requestedG: 1000 as never }],
          nowMs: Date.now(),
        }),
    )) as Awaited<ReturnType<typeof repo.placeOrder>>;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('priceChanged');
      // The frontend needs the new number for the re-confirm screen. It must
      // NEVER auto-accept it — NFR-2, and the promise made to the client.
      if ('detail' in result) expect(result.detail?.recomputedEstCents).toBe(1500);
    }

    expect(await orderCount()).toBe(0);
    expect(await stockRow()).toEqual({ stocked_g: 10_000, reserved_g: 0 });
    expect((await slotRow()).booked_count).toBe(0);
  });
});

describe('Deadlock resistance — baskets in opposite orders', () => {
  it('concurrent baskets of {A,B} and {B,A} all complete, none deadlock', async () => {
    // Without the canonical ascending sort, this deadlocks roughly half the
    // time. With it, the two baskets take the same locks in the same order and
    // simply queue.
    await seedServedArea(pool);
    const a = await seedPerKgProduct(pool, {
      slug: 'aaa',
      ratePerKgCents: 1000,
      minOrderG: 500,
      stepG: 500,
    });
    const b = await seedPerKgProduct(pool, {
      slug: 'bbb',
      ratePerKgCents: 1000,
      minOrderG: 500,
      stepG: 500,
    });
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: a.id, stockedG: 100_000 },
      { productId: b.id, stockedG: 100_000 },
    ]);
    const slotId = await seedSlot(pool, { capacity: 100 });

    const customers = await Promise.all(
      Array.from({ length: 30 }, (_, i) => seedCustomer(pool, `dl${i}@example.test`)),
    );

    const results = await Promise.all(
      customers.map((customerId, i) => {
        const order = i % 2 === 0 ? [a.id, b.id] : [b.id, a.id];
        return repo.placeOrder({
          attemptId: null,
          customerId,
          postalCode: POSTAL,
          slotId,
          businessDayId: dayId,
          payMode: 'PREPAID',
          lines: order.map((productId) => ({
            productId,
            prepOptionId: null,
            requestedG: 500 as never,
          })),
          nowMs: Date.now(),
        });
      }),
    );

    expect(tally(results)).toEqual({ accepted: 30 });
    expect((await slotRow()).booked_count).toBe(30);
  });
});
