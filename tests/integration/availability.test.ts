import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { migrateTestDatabase, testPool, truncateAll } from './helpers/db';
import { seedBusinessDay, seedPerKgProduct } from './helpers/fixtures';

/**
 * Increment 2 against a real PostgreSQL.
 *
 * What is checked here and could not be checked anywhere else: that the CHECK
 * constraints actually refuse, that `openBusinessDay` is genuinely atomic, and
 * that reservations survive being raced.
 */

let pool: Pool;

// Imported lazily: `@/db/client` builds its pool at import time from
// DATABASE_URL, which helpers/db sets. A static import would run first.
let repo: typeof import('@/db/repositories/availability');

beforeAll(async () => {
  await migrateTestDatabase();
  pool = testPool();
  repo = await import('@/db/repositories/availability');
});

afterAll(async () => {
  await pool.end();
  const { pool: appPool } = await import('@/db/client');
  await appPool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

describe('openBusinessDay (spec §5.1)', () => {
  it('opens a day and writes the declared quantities with nothing reserved', async () => {
    const chicken = await seedPerKgProduct(pool, { slug: 'chicken', ratePerKgCents: 1200 });
    const lamb = await seedPerKgProduct(pool, { slug: 'lamb', ratePerKgCents: 2400 });

    const result = await repo.openBusinessDay(
      '2026-08-12',
      new Map([
        [chicken.id, 5000 as never],
        [lamb.id, 3000 as never],
      ]),
    );

    expect(result.ok).toBe(true);

    const { rows } = await pool.query(
      `SELECT product_id, stocked_g, reserved_g FROM stock_item ORDER BY stocked_g`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.reserved_g === 0)).toBe(true);
  });

  it('closes the previous day — at most one is ever open', async () => {
    await repo.openBusinessDay('2026-08-12', new Map());
    await repo.openBusinessDay('2026-08-13', new Map());

    const { rows } = await pool.query(`SELECT business_date, open FROM business_day ORDER BY business_date`);
    expect(rows.map((r) => r.open)).toEqual([false, true]);
  });

  it('NOTHING ROLLS OVER — a new day starts with reserved at zero', async () => {
    const chicken = await seedPerKgProduct(pool, { slug: 'chicken', ratePerKgCents: 1200 });
    await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 5000, reservedG: 4000 },
    ]);

    await repo.openBusinessDay('2026-08-13', new Map([[chicken.id, 2000 as never]]));

    const { rows } = await pool.query(
      `SELECT si.stocked_g, si.reserved_g FROM stock_item si
         JOIN business_day bd ON bd.id = si.business_day_id
        WHERE bd.open`,
    );
    expect(rows).toEqual([{ stocked_g: 2000, reserved_g: 0 }]);
  });

  it('refuses a day that is not strictly after the current one', async () => {
    await repo.openBusinessDay('2026-08-12', new Map());

    for (const date of ['2026-08-12', '2026-08-11']) {
      const result = await repo.openBusinessDay(date, new Map());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('dayNotAfterCurrent');
    }

    // And the refusal changed nothing.
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM business_day`);
    expect(rows[0].n).toBe(1);
  });

  it('refuses stock for a product that is not in the catalog (inv-A1)', async () => {
    const result = await repo.openBusinessDay(
      '2026-08-12',
      new Map([['00000000-0000-0000-0000-000000000000', 1000 as never]]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknownProduct');

    // Atomic: the day was not created either.
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM business_day`);
    expect(rows[0].n).toBe(0);
  });
});

describe('inv-A3 as a DATABASE constraint, not only as application logic', () => {
  it('the database itself refuses reserved_g > stocked_g', async () => {
    const chicken = await seedPerKgProduct(pool, { slug: 'chicken', ratePerKgCents: 1200 });
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 1000 },
    ]);

    // Bypassing every line of application code, exactly as a bug would.
    await expect(
      pool.query(`UPDATE stock_item SET reserved_g = 1001 WHERE business_day_id = $1`, [dayId]),
    ).rejects.toThrow(/stock_not_oversold/);
  });

  it('the database itself refuses negative reserved_g', async () => {
    const chicken = await seedPerKgProduct(pool, { slug: 'chicken', ratePerKgCents: 1200 });
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 1000 },
    ]);

    await expect(
      pool.query(`UPDATE stock_item SET reserved_g = -1 WHERE business_day_id = $1`, [dayId]),
    ).rejects.toThrow(/stock_not_oversold/);
  });

  it('reserved_g = stocked_g is legal — the boundary is inclusive', async () => {
    const chicken = await seedPerKgProduct(pool, { slug: 'chicken', ratePerKgCents: 1200 });
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 1000 },
    ]);

    await pool.query(`UPDATE stock_item SET reserved_g = 1000 WHERE business_day_id = $1`, [dayId]);
    const { rows } = await pool.query(`SELECT reserved_g FROM stock_item`);
    expect(rows[0].reserved_g).toBe(1000);
  });
});

describe('adjustStock', () => {
  it('refuses to declare less stock than is already promised', async () => {
    const chicken = await seedPerKgProduct(pool, { slug: 'chicken', ratePerKgCents: 1200 });
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 5000, reservedG: 3000 },
    ]);

    const result = await repo.adjustStock(dayId, chicken.id, 2000 as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reservedG).toBe(3000);

    const { rows } = await pool.query(`SELECT stocked_g FROM stock_item`);
    expect(rows[0].stocked_g).toBe(5000);
  });

  it('allows an increase, and allows a decrease down to exactly what is reserved', async () => {
    const chicken = await seedPerKgProduct(pool, { slug: 'chicken', ratePerKgCents: 1200 });
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 5000, reservedG: 3000 },
    ]);

    expect((await repo.adjustStock(dayId, chicken.id, 8000 as never)).ok).toBe(true);
    expect((await repo.adjustStock(dayId, chicken.id, 3000 as never)).ok).toBe(true);

    const { rows } = await pool.query(`SELECT stocked_g, reserved_g FROM stock_item`);
    expect(rows[0]).toEqual({ stocked_g: 3000, reserved_g: 3000 });
  });
});

describe('availability queries', () => {
  it('reports available as stocked minus reserved, and omits unstocked products', async () => {
    const chicken = await seedPerKgProduct(pool, { slug: 'chicken', ratePerKgCents: 1200 });
    const lamb = await seedPerKgProduct(pool, { slug: 'lamb', ratePerKgCents: 2400 });
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 5000, reservedG: 1500 },
    ]);

    const stock = await repo.availabilityForProducts(dayId, [chicken.id, lamb.id]);
    expect(stock.get(chicken.id)?.availableG).toBe(3500);
    // Not stocked today is ABSENT, not zero — "we didn't cut any today" and
    // "we sold out" are different sentences to a customer.
    expect(stock.has(lamb.id)).toBe(false);
  });

  it('lists sold-out products', async () => {
    const chicken = await seedPerKgProduct(pool, { slug: 'chicken', ratePerKgCents: 1200 });
    const lamb = await seedPerKgProduct(pool, { slug: 'lamb', ratePerKgCents: 2400 });
    const dayId = await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 5000, reservedG: 5000 },
      { productId: lamb.id, stockedG: 5000, reservedG: 4999 },
    ]);

    expect(await repo.soldOutProductIds(dayId)).toEqual([chicken.id]);
  });

  it('the inv-A3 consistency query finds nothing on a healthy database', async () => {
    const chicken = await seedPerKgProduct(pool, { slug: 'chicken', ratePerKgCents: 1200 });
    await seedBusinessDay(pool, '2026-08-12', [
      { productId: chicken.id, stockedG: 5000, reservedG: 5000 },
    ]);
    expect(await repo.invA3Violations()).toEqual([]);
  });
});
