import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { migrateTestDatabase, testPool, truncateAll } from '../integration/helpers/db';
import {
  FSA_SERVED,
  seedAuthorisedAttempt,
  seedCustomer,
  seedPackProduct,
  seedPerKgProduct,
  seedServedArea,
  seedSlot,
} from '../integration/helpers/fixtures';
import { grams } from '@/domain/types';

import { asStaff, asStranger, signInAsStaff, startServer, stopServer } from './helpers/server';

/**
 * ⭐ A WHOLE TRADING DAY, END TO END, THROUGH THE CONSOLE.
 *
 * Open the day, sell against it, prepare the order, weigh the meat, work out
 * the exact amount. Every step goes over HTTP against a running server and a
 * real PostgreSQL, so what is under test is the routing, the guard, the Zod
 * boundary, the repositories, the domain and the SQL together.
 *
 * The one step NOT driven through the UI is placing the order: this suite
 * creates it through the placement repository with a pre-authorised attempt,
 * so it can exercise the checkout-attempt path that the storefront does not
 * use. The consequence is that the order has NO payment row, which is why
 * finalise reports `noAuthorisation` here rather than capturing.
 *
 * The full browse-to-capture-to-tracking path, with a real hold, is
 * `full-path.test.ts`.
 *
 * ⚠ Fixtures are fictional. This repository is public. See CLAUDE.md §1.
 */

let pool: Pool;

// A per-kg product: cut to order, billed on what it actually weighs.
const RATE_PER_KG = 1840; // $18.40/kg, fictional
const PACK_PRICE = 950; // $9.50, fictional
const PACK_UNIT_G = 400; // the pack's declared unit weight
const DELIVERY_FEE = 500;

beforeAll(async () => {
  await migrateTestDatabase();
  pool = testPool();
  await truncateAll(pool);
  await startServer();
  await signInAsStaff();
}, 240_000);

afterAll(async () => {
  await stopServer();
  await pool?.end();
});

describe('the console runs a trading day', () => {
  it('is talking to the throwaway database, not to Supabase', async () => {
    // This is the guard described in helpers/server.ts. It runs first, before
    // anything writes, because the cost of being wrong is writing to the live
    // shop. A product that exists only in the test database has to be visible
    // through the server, or the server is not looking at the test database.
    const canary = await seedPerKgProduct(pool, {
      slug: 'e2e-canary',
      name: 'Sample Canary Cut',
      ratePerKgCents: 100,
    });
    expect(canary.id).toBeTruthy();

    const res = await asStaff('/admin/open');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Sample Canary Cut');
  });

  it('refuses the console and every admin write to a caller with no session', async () => {
    const page = await asStranger('/admin');
    expect(page.status).toBe(200);

    // A stranger gets the SIGN-IN FORM, not the console and not an error page.
    // Checked by looking for the form rather than for prose, so rewording the
    // page does not silently turn this assertion into a tautology.
    const html = await page.text();
    expect(html).toContain('name="password"');
    expect(html).toContain('Sign in');
    // And none of the console's actual content leaked into the refused page.
    expect(html).not.toContain('Sample Canary Cut');

    // 404 rather than 403: answering "forbidden" confirms the route exists.
    const write = await asStranger('/api/admin/day', {
      json: { businessDate: '2026-08-12', declared: {} },
    });
    expect(write.status).toBe(404);
    expect(await write.json()).toEqual({ reason: 'notFound' });

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM business_day');
    expect(rows[0].n).toBe(0);
  });

  it('refuses a malformed body before it reaches the database', async () => {
    const res = await asStaff('/api/admin/day', {
      json: { businessDate: 'not-a-date', declared: { 'not-a-uuid': 1000 } },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ reason: 'invalidBody' });
  });

  it('opens the day, sells against it, weighs it and works out the exact total', async () => {
    await truncateAll(pool);

    const lamb = await seedPerKgProduct(pool, {
      slug: 'sample-lamb-shoulder',
      name: 'Sample Lamb Shoulder, Boneless',
      ratePerKgCents: RATE_PER_KG,
      minOrderG: 500,
      stepG: 250,
    });
    const rub = await seedPackProduct(pool, {
      slug: 'sample-spice-pack',
      name: 'Sample Spice Rub Pack',
      packPriceCents: PACK_PRICE,
    });

    // ── 1. The owner opens the day from the console ──────────────────────
    const opened = await asStaff('/api/admin/day', {
      json: {
        businessDate: '2026-08-12',
        declared: { [lamb.id]: 8000, [rub.id]: 4000 },
      },
    });
    expect(opened.status).toBe(200);
    const { businessDayId } = (await opened.json()) as { businessDayId: string };
    expect(businessDayId).toBeTruthy();

    // Nothing rolls over: reservations start at zero.
    const stock = await pool.query(
      'SELECT stocked_g, reserved_g FROM stock_item WHERE business_day_id = $1 ORDER BY stocked_g',
      [businessDayId],
    );
    expect(stock.rows).toEqual([
      { stocked_g: 4000, reserved_g: 0 },
      { stocked_g: 8000, reserved_g: 0 },
    ]);

    // ── 2. A customer places an order (not through the UI — see the note) ─
    await seedServedArea(pool, { feeCents: DELIVERY_FEE });
    const slotId = await seedSlot(pool, { hotEligible: false });
    const customerId = await seedCustomer(pool);

    const { placeOrder } = await import('@/db/repositories/placement');
    const requestedG = 1000;
    const estLine = Math.ceil((RATE_PER_KG * requestedG) / 1000);
    const estTotal = estLine + PACK_PRICE + DELIVERY_FEE;

    const attemptId = await seedAuthorisedAttempt(pool, {
      customerId,
      cartHash: 'e2e-cart',
      quotedEstCents: estTotal,
    });

    const placed = await placeOrder({
      attemptId,
      customerId,
      postalCode: `${FSA_SERVED} 1A1`,
      point: null,
      address: { line1: '1 Test Street', city: 'Testville', province: 'QC' },
      slotId,
      businessDayId,
      payMode: 'PREPAID',
      lines: [
        { productId: lamb.id, requestedG: grams(requestedG), prepOptionId: null },
        // A pack sells by unit, so its weight is not validated. It still
        // consumes stock, because the shop declares grams of it like anything
        // else, so the declared unit weight is what goes on the line.
        { productId: rub.id, requestedG: grams(PACK_UNIT_G), prepOptionId: null },
      ],
      nowMs: Date.now(),
    });

    expect(placed.ok).toBe(true);
    if (!placed.ok) throw new Error(`placement failed: ${placed.reason}`);
    const orderId = placed.orderId;
    expect(placed.estTotalCents).toBe(estTotal);

    // ── 3. The order shows up on the queue screen ────────────────────────
    const queue = await asStaff('/admin/orders');
    expect(queue.status).toBe(200);
    const queueHtml = await queue.text();
    expect(queueHtml).toContain('Sample Lamb Shoulder');
    // 18.40 lamb + 9.50 pack + 5.00 delivery
    expect(queueHtml).toContain('$32.90 est.');

    // ── 4. Start preparing ───────────────────────────────────────────────
    const preparing = await asStaff('/api/admin/status', {
      json: { orderId, from: 'PLACED', to: 'PREPARING' },
    });
    expect(preparing.status).toBe(200);

    // A second tap on a screen that has not refreshed is a no-op, not a
    // backwards step.
    const doubleTap = await asStaff('/api/admin/status', {
      json: { orderId, from: 'PLACED', to: 'PREPARING' },
    });
    expect(doubleTap.status).toBe(409);
    expect(await doubleTap.json()).toEqual({ reason: 'staleStatus' });

    // ── 5. Weighing ──────────────────────────────────────────────────────
    const lineRows = await pool.query(
      "SELECT id FROM order_line WHERE order_id = $1 AND pricing_mode = 'perKg'",
      [orderId],
    );
    const lineId = lineRows.rows[0].id as string;

    // The pack line cannot be weighed at all: its estimate IS its actual.
    const packLine = await pool.query(
      "SELECT id FROM order_line WHERE order_id = $1 AND pricing_mode = 'pack'",
      [orderId],
    );
    const packRefused = await asStaff('/api/admin/weigh', {
      json: { orderId, lineId: packLine.rows[0].id, weighedG: 400, approveVariance: false },
    });
    expect(packRefused.status).toBe(409);
    expect((await packRefused.json()).reason).toBe('packLineNotWeighable');

    // ⭐ An out-of-band weight is REFUSED, not clamped and not charged.
    // 1300 g against 1000 g ordered is +30%, well outside ±10%.
    const outOfBand = await asStaff('/api/admin/weigh', {
      json: { orderId, lineId, weighedG: 1300, approveVariance: false },
    });
    expect(outOfBand.status).toBe(409);
    const refusal = (await outOfBand.json()) as { reason: string; detail?: { lowerG: number; upperG: number } };
    expect(refusal.reason).toBe('varianceApprovalRequired');
    expect(refusal.detail).toMatchObject({ lowerG: 900, upperG: 1100 });

    // Nothing was written by the refusal.
    const untouched = await pool.query('SELECT act_weight_g FROM order_line WHERE id = $1', [lineId]);
    expect(untouched.rows[0].act_weight_g).toBeNull();

    // An in-band weight goes through, priced by the same rounding rule as the
    // estimate: ⌈1840 × 1080 / 1000⌉ = 1988.
    const weighed = await asStaff('/api/admin/weigh', {
      json: { orderId, lineId, weighedG: 1080, approveVariance: false },
    });
    expect(weighed.status).toBe(200);
    expect(await weighed.json()).toMatchObject({ actWeightG: 1080, actAmountCents: 1988 });

    // ── 6. The exact total ───────────────────────────────────────────────
    const finalised = await asStaff('/api/admin/finalise', { json: { orderId } });
    expect(finalised.status).toBe(200);
    const settled = (await finalised.json()) as {
      finalTotalCents: number;
      captured: boolean;
      reason: string | null;
    };

    // 1988 (weighed lamb) + 950 (pack, never re-priced) + 500 (delivery).
    expect(settled.finalTotalCents).toBe(1988 + PACK_PRICE + DELIVERY_FEE);
    /*
     * ⚠ NO HOLD EXISTS ON THIS ORDER, because it was placed directly through
     * the repository rather than through `/api/checkout`, which is what
     * authorises. Finalise therefore reports `noAuthorisation` rather than
     * crashing or silently claiming to have taken money.
     *
     * That is a real state somebody has to look at, not a transient failure,
     * and the order itself is priced correctly either way. The happy path with
     * a real hold is covered end to end in `full-path.test.ts`.
     */
    expect(settled.captured).toBe(false);
    expect(settled.reason).toBe('noAuthorisation');

    // ── 7. The order screen shows the final amount, not the estimate ─────
    const detail = await asStaff(`/admin/orders/${orderId}`);
    const detailHtml = await detail.text();
    expect(detailHtml).toContain('Final total');
    expect(detailHtml).toContain('$34.38');
  });

  it('will not let the owner declare less stock than customers have already bought', async () => {
    // Targeted at the per-kg product by slug rather than "any row with a
    // reservation": two products carry one here, and LIMIT 1 without an
    // ORDER BY would pick either.
    const rows = await pool.query(
      `SELECT si.product_id, si.reserved_g
         FROM stock_item si
         JOIN business_day bd ON bd.id = si.business_day_id
         JOIN product p ON p.id = si.product_id
        WHERE bd.open AND si.reserved_g > 0 AND p.slug = 'sample-lamb-shoulder'`,
    );
    expect(rows.rows.length).toBe(1);
    const { product_id: productId, reserved_g: reservedG } = rows.rows[0];

    const res = await asStaff('/api/admin/stock', {
      json: { declared: { [productId]: Math.max(0, reservedG - 1) } },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('belowReserved');

    // The refusal left the number alone.
    const after = await pool.query('SELECT stocked_g FROM stock_item WHERE product_id = $1', [
      productId,
    ]);
    expect(after.rows[0].stocked_g).toBe(8000);
  });
});
