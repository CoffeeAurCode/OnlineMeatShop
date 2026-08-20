import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { migrateTestDatabase, testPool, truncateAll } from './helpers/db';
import {
  FSA_SERVED,
  seedBusinessDay,
  seedCustomer,
  seedPerKgProduct,
  seedServedArea,
  seedSlot,
} from './helpers/fixtures';

/**
 * The dashboard is an operational summary, so a plausible number is not good
 * enough: every figure must describe money or availability that actually
 * exists in Postgres. These regressions cover the two summaries introduced by
 * the console-dashboard merge that can otherwise be wrong while every route
 * and component still renders successfully.
 *
 * Fixtures are fictional. This repository is public.
 */

let pool: Pool;
let repo: typeof import('@/db/repositories/admin');

beforeAll(async () => {
  await migrateTestDatabase();
  pool = testPool();
  repo = await import('@/db/repositories/admin');
});

afterAll(async () => {
  await pool.end();
  const { pool: appPool } = await import('@/db/client');
  await appPool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

async function seedWorld() {
  await seedServedArea(pool);
  const fish = await seedPerKgProduct(pool, {
    slug: 'sample-dashboard-cod',
    ratePerKgCents: 2_400,
  });
  const dayId = await seedBusinessDay(pool, '2026-08-20', [
    { productId: fish.id, stockedG: 20_000 },
  ]);
  const slotId = await seedSlot(pool, { capacity: 20 });
  const customerId = await seedCustomer(pool);
  return { dayId, slotId, customerId };
}

async function seedOrder(
  world: Awaited<ReturnType<typeof seedWorld>>,
  input: {
    payMode: 'PREPAID' | 'COD';
    status: 'PLACED' | 'READY' | 'OUT';
    estTotalCents: number;
    finalTotalCents: number | null;
    cashCollectedCents?: number | null;
  },
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO "order"
       (customer_id, postal_code, fsa, address_line1, city, province,
        slot_id, business_day_id, pay_mode, status,
        est_line_total_cents, delivery_fee_cents, est_total_cents, final_total_cents,
        catalog_version, slot_hot_eligible, has_hot_line,
        cash_collected_cents, cash_reported_at)
     VALUES ($1, $2, $3, '1 Test Street', 'Testville', 'QC',
             $4, $5, $6, $7, $8, 0, $8, $9, 1, false, false, $10,
             CASE WHEN $10::integer IS NULL THEN NULL ELSE now() END)
     RETURNING id`,
    [
      world.customerId,
      `${FSA_SERVED} 1A1`,
      FSA_SERVED,
      world.slotId,
      world.dayId,
      input.payMode,
      input.status,
      input.estTotalCents,
      input.finalTotalCents,
      input.cashCollectedCents ?? null,
    ],
  );
  return rows[0].id as string;
}

async function seedPayment(
  orderId: string,
  provider: 'moneris' | 'stub',
  capturedCents: number | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO payment
       (order_id, provider, payment_intent_id, status, authorised_cents,
        captured_cents, authorised_at, captured_at)
     VALUES ($1, $2, $3, $4, 10000, $5, now(),
             CASE WHEN $5::integer IS NULL THEN NULL ELSE now() END)`,
    [
      orderId,
      provider,
      `sample-${orderId}`,
      capturedCents === null ? 'REQUIRES_CAPTURE' : 'CAPTURED',
      capturedCents,
    ],
  );
}

describe('admin dashboard summaries', () => {
  it('reports only money that actually moved, including COD and excluding only stub payments', async () => {
    const world = await seedWorld();

    const captured = await seedOrder(world, {
      payMode: 'PREPAID',
      status: 'READY',
      estTotalCents: 3_300,
      finalTotalCents: 3_438,
    });
    await seedPayment(captured, 'moneris', 3_438);

    const authorisedOnly = await seedOrder(world, {
      payMode: 'PREPAID',
      status: 'PLACED',
      estTotalCents: 2_000,
      finalTotalCents: null,
    });
    await seedPayment(authorisedOnly, 'moneris', null);

    const stub = await seedOrder(world, {
      payMode: 'PREPAID',
      status: 'READY',
      estTotalCents: 1_200,
      finalTotalCents: 1_200,
    });
    await seedPayment(stub, 'stub', 1_200);

    await seedOrder(world, {
      payMode: 'COD',
      status: 'OUT',
      estTotalCents: 1_500,
      finalTotalCents: 1_500,
      cashCollectedCents: 1_400,
    });
    await seedOrder(world, {
      payMode: 'COD',
      status: 'READY',
      estTotalCents: 1_700,
      finalTotalCents: 1_700,
    });

    expect(await repo.takingsForDay(world.dayId)).toEqual({
      orders: 2,
      totalCents: 4_838,
      excludedTestOrders: 1,
      unsettledOrders: 2,
    });
  });

  it('counts today as runway only while an active window remains before cutoff', async () => {
    const now = new Date('2026-08-20T12:00:00.000Z');

    await pool.query(
      `INSERT INTO slot
         (service_date, starts_at, ends_at, cutoff_at, capacity, active)
       VALUES
         ('2026-08-20', '2026-08-20T16:00:00Z', '2026-08-20T18:00:00Z',
          '2026-08-20T11:00:00Z', 5, true)`,
    );
    expect(await repo.slotRunwayDays('2026-08-20', now)).toBe(0);

    await pool.query(`UPDATE slot SET cutoff_at = '2026-08-20T13:00:00Z'`);
    expect(await repo.slotRunwayDays('2026-08-20', now)).toBe(1);

    await pool.query(
      `INSERT INTO slot
         (service_date, starts_at, ends_at, cutoff_at, capacity, active)
       VALUES
         ('2026-08-23', '2026-08-23T16:00:00Z', '2026-08-23T18:00:00Z',
          '2026-08-23T12:00:00Z', 5, true),
         ('2026-08-25', '2026-08-25T16:00:00Z', '2026-08-25T18:00:00Z',
          '2026-08-25T12:00:00Z', 5, false)`,
    );
    expect(await repo.slotRunwayDays('2026-08-20', now)).toBe(4);
  });
});
