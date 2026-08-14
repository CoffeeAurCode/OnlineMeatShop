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
 * ⭐⭐ THE PAYMENT GATES. `05-PLAN` §4.3.2.
 *
 * Building the authorise-then-capture lifecycle against a stub is only worth
 * doing if it is tested where it actually breaks, and these three are the
 * reason the stub-with-full-lifecycle option was chosen over plain
 * cash-on-delivery:
 *
 *   1. ONE CAPTURE, EVER. A real processor auto-releases the remainder on a
 *      partial capture, so a second capture is unrecoverable and a real-money
 *      bug. Not a retry.
 *   2. CONCURRENT DOUBLE-TAP yields exactly ONE authorisation. Two holds on a
 *      customer's card for one basket is the classic checkout defect.
 *   3. CAPTURE NEVER EXCEEDS THE CEILING. Clover enforces this server-side
 *      too, but relying on the processor to catch our arithmetic means finding
 *      out as a declined capture AFTER the fish is cut.
 *
 * ⚠ All three fail SILENTLY in production. They report success at the time and
 * surface days later as somebody else's problem, which is exactly why they are
 * tested here rather than trusted.
 */

let pool: Pool;
let adapter: import('@/adapters/payments').StubPaymentAdapter;

beforeAll(async () => {
  await migrateTestDatabase();
  pool = testPool();
  const mod = await import('@/adapters/payments');
  adapter = new mod.StubPaymentAdapter();
});

afterAll(async () => {
  await pool.end();
  const { pool: appPool } = await import('@/db/client');
  await appPool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

/** A placed order to hang a payment off. The lines do not matter here. */
async function seedOrder(estTotalCents = 10_000): Promise<string> {
  await seedServedArea(pool);
  const fish = await seedPerKgProduct(pool, { slug: 'cod', ratePerKgCents: 3299 });
  const dayId = await seedBusinessDay(pool, '2026-08-12', [
    { productId: fish.id, stockedG: 10_000 },
  ]);
  const slotId = await seedSlot(pool, { capacity: 10 });
  const customerId = await seedCustomer(pool);

  const { rows } = await pool.query(
    `INSERT INTO "order"
       (customer_id, postal_code, fsa, address_line1, city, province,
        slot_id, business_day_id, pay_mode, status,
        est_line_total_cents, delivery_fee_cents, est_total_cents, catalog_version,
        slot_hot_eligible, has_hot_line)
     VALUES ($1, $2, $3, '1 Test Street', 'Testville', 'QC',
             $4, $5, 'PREPAID', 'PLACED', $6, 0, $6, 1, false, false)
     RETURNING id`,
    [customerId, `${FSA_SERVED} 1A1`, FSA_SERVED, slotId, dayId, estTotalCents],
  );
  return rows[0].id as string;
}

async function paymentRow(orderId: string) {
  const { rows } = await pool.query(
    `SELECT provider, status, authorised_cents, captured_cents FROM payment WHERE order_id = $1`,
    [orderId],
  );
  return rows[0];
}

describe('1. ⭐ ONE CAPTURE, EVER', () => {
  it('refuses a second captureExact for the same authorisation', async () => {
    const orderId = await seedOrder(10_000);
    const { authId } = await adapter.authoriseCeiling({
      orderId,
      ceilingCents: 11_000,
      idempotencyKey: 'k1',
    });

    const first = await adapter.captureExact({ authId, amountCents: 9_800, idempotencyKey: 'c1' });
    expect(first).toEqual({ ok: true, capturedCents: 9_800 });

    // ⚠ NOT A RETRY. A real processor released the remaining 1,200 the moment
    // the first capture settled; there is nothing left to take.
    const second = await adapter.captureExact({ authId, amountCents: 500, idempotencyKey: 'c2' });
    expect(second).toEqual({ ok: false, reason: 'alreadyCaptured', capturedCents: 9_800 });

    // And the stored amount is still the FIRST one, not overwritten.
    expect(await paymentRow(orderId)).toMatchObject({
      status: 'CAPTURED',
      captured_cents: 9_800,
    });
  });

  it('refuses a second capture even when it is byte-identical to the first', async () => {
    // The tempting special case: "the same amount twice is harmless, let it
    // through". It is not. A processor charges twice.
    const orderId = await seedOrder();
    const { authId } = await adapter.authoriseCeiling({
      orderId,
      ceilingCents: 11_000,
      idempotencyKey: 'k1',
    });

    await adapter.captureExact({ authId, amountCents: 9_800, idempotencyKey: 'c1' });
    const again = await adapter.captureExact({ authId, amountCents: 9_800, idempotencyKey: 'c1' });
    expect(again.ok).toBe(false);
  });

  it('⭐ survives TWO SIMULTANEOUS captures, taking exactly one', async () => {
    // The conditional UPDATE is what makes this work. A read-then-write would
    // let both through, and this is the shape that fires under load.
    const orderId = await seedOrder();
    const { authId } = await adapter.authoriseCeiling({
      orderId,
      ceilingCents: 11_000,
      idempotencyKey: 'k1',
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        adapter.captureExact({ authId, amountCents: 9_000 + i, idempotencyKey: `c${i}` }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(7);
  });
});

describe('2. ⭐ CONCURRENT DOUBLE-TAP yields exactly one authorisation', () => {
  it('two simultaneous checkouts for one order produce ONE hold', async () => {
    const orderId = await seedOrder();

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        adapter.authoriseCeiling({ orderId, ceilingCents: 11_000, idempotencyKey: `k${i}` }),
      ),
    );

    // Every caller gets the SAME authorisation back, not their own.
    expect(new Set(results.map((r) => r.authId)).size).toBe(1);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM payment WHERE order_id = $1`,
      [orderId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('records the stub provider, which is the ONLY test-order discriminator', async () => {
    // These orders are deliberately `pay_mode = PREPAID`, so nothing else in
    // the data distinguishes them from a real prepaid order.
    const orderId = await seedOrder();
    await adapter.authoriseCeiling({ orderId, ceilingCents: 11_000, idempotencyKey: 'k' });

    expect(await paymentRow(orderId)).toMatchObject({
      provider: 'stub',
      status: 'REQUIRES_CAPTURE',
      captured_cents: null,
    });

    const { rows } = await pool.query(
      `SELECT pay_mode FROM "order" WHERE id = $1`,
      [orderId],
    );
    expect(rows[0].pay_mode).toBe('PREPAID');
  });
});

describe('3. ⭐ CAPTURE NEVER EXCEEDS THE CEILING', () => {
  it('refuses one cent over the authorisation', async () => {
    const orderId = await seedOrder();
    const { authId } = await adapter.authoriseCeiling({
      orderId,
      ceilingCents: 11_000,
      idempotencyKey: 'k',
    });

    const over = await adapter.captureExact({
      authId,
      amountCents: 11_001,
      idempotencyKey: 'c',
    });
    expect(over).toEqual({ ok: false, reason: 'exceedsAuthorisation', authorisedCents: 11_000 });

    // Refused, and it left NOTHING behind. A partial write here would be a
    // payment row claiming a capture that never happened.
    expect(await paymentRow(orderId)).toMatchObject({
      status: 'REQUIRES_CAPTURE',
      captured_cents: null,
    });
  });

  it('allows exactly the ceiling', async () => {
    const orderId = await seedOrder();
    const { authId } = await adapter.authoriseCeiling({
      orderId,
      ceilingCents: 11_000,
      idempotencyKey: 'k',
    });
    const exact = await adapter.captureExact({
      authId,
      amountCents: 11_000,
      idempotencyKey: 'c',
    });
    expect(exact).toEqual({ ok: true, capturedCents: 11_000 });
  });

  it('⭐ PROPERTY: cappedTotal never exceeds the authorised ceiling, for ANY actual weight', async () => {
    // The arithmetic gate, checked against the domain rather than the adapter.
    //
    //   cappedTotal = min(actualLineTotal, ceil(estLineTotal x (1 + tol))) + fee
    //   ceiling     = ceil((estLineTotal + fee) x (1 + tol))     <- what the
    //                                                               checkout
    //                                                               route holds
    //
    // The cap is what makes the single-capture limitation safe: however heavy
    // the cut came in, the captured amount cannot exceed the hold, so the one
    // capture we get can never be declined for being over.
    const { cappedTotal } = await import('@/domain/pricing');
    const { cents } = await import('@/domain/types');

    const TOL = 0.1;
    for (let i = 0; i < 5000; i += 1) {
      const estLine = 1 + Math.floor(Math.random() * 500_00);
      const fee = Math.floor(Math.random() * 20_00);
      // Deliberately unbounded above: the point is that the cap holds WITHOUT
      // assuming the weighing stayed inside the tolerance band. A 3x overweight
      // cut is not realistic, and it is exactly the case that must not charge.
      const actLine = Math.floor(Math.random() * estLine * 3);

      const ceiling = Math.ceil((estLine + fee) * (1 + TOL));
      const capped = cappedTotal(cents(actLine), cents(estLine), cents(fee), TOL);

      expect(capped, `est=${estLine} act=${actLine} fee=${fee}`).toBeLessThanOrEqual(ceiling);
    }
  });

  it('caps at the tolerance ceiling once the actual passes it', async () => {
    const { cappedTotal } = await import('@/domain/pricing');
    const { cents } = await import('@/domain/types');

    // 10,000 estimated, 10% tolerance, so the line cap is 11,000 whatever the
    // scale said. 500 fee rides on top and is never itself capped.
    expect(cappedTotal(cents(50_000), cents(10_000), cents(500), 0.1)).toBe(11_500);
    // Under the cap, the customer pays what was actually cut.
    expect(cappedTotal(cents(9_400), cents(10_000), cents(500), 0.1)).toBe(9_900);
  });
});

describe('the adapter refuses nonsense rather than storing it', () => {
  it('rejects a zero or negative ceiling', async () => {
    const orderId = await seedOrder();
    await expect(
      adapter.authoriseCeiling({ orderId, ceilingCents: 0, idempotencyKey: 'k' }),
    ).rejects.toThrow(/positive integer ceiling/);
  });

  it('reports a capture against an unknown authorisation as notFound', async () => {
    const result = await adapter.captureExact({
      authId: 'stub_auth_nope',
      amountCents: 100,
      idempotencyKey: 'c',
    });
    expect(result).toEqual({ ok: false, reason: 'notFound' });
  });

  it('refuses to capture a voided authorisation', async () => {
    const orderId = await seedOrder();
    const { authId } = await adapter.authoriseCeiling({
      orderId,
      ceilingCents: 11_000,
      idempotencyKey: 'k',
    });
    await adapter.voidAuthorisation(authId);

    expect(await adapter.captureExact({ authId, amountCents: 100, idempotencyKey: 'c' })).toEqual({
      ok: false,
      reason: 'voided',
    });
  });

  it('is idempotent about voiding', async () => {
    const orderId = await seedOrder();
    const { authId } = await adapter.authoriseCeiling({
      orderId,
      ceilingCents: 11_000,
      idempotencyKey: 'k',
    });
    await adapter.voidAuthorisation(authId);
    await adapter.voidAuthorisation(authId);
    expect(await paymentRow(orderId)).toMatchObject({ status: 'CANCELLED' });
  });
});
