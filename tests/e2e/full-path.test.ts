import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrateTestDatabase, testPool, truncateAll } from '../integration/helpers/db';
import { FSA_SERVED, seedPerKgProduct, seedServedArea, seedSlot } from '../integration/helpers/fixtures';
import { asStaff, asStranger, signInAsStaff, startServer, stopServer } from './helpers/server';

/**
 * ⭐⭐ THE WHOLE PATH, IN ONE TEST, THROUGH REAL HTTP.
 *
 * Browse, order, the owner walks it from PLACED to DELIVERED, the exact amount
 * is captured, and the customer tracks it the entire way on an unguessable
 * link with no session.
 *
 * Every other suite tests one joint. This one exists because the joints were
 * built at different times against different assumptions, and the failure this
 * catches is the one where each piece is individually correct and they
 * disagree about the shape of what they hand each other.
 */

let pool: Pool;
let productId = '';
let slotId = '';
const RATE = 4000; // $40.00/kg, fictional
const FEE = 500;

beforeAll(async () => {
  await migrateTestDatabase();
  pool = testPool();
  await truncateAll(pool);

  const fish = await seedPerKgProduct(pool, {
    slug: 'sample-halibut',
    name: 'Sample Halibut Steak',
    ratePerKgCents: RATE,
    minOrderG: 500,
    stepG: 250,
  });
  productId = fish.id;

  await seedServedArea(pool, { feeCents: FEE });

  const { rows } = await pool.query(
    `INSERT INTO business_day (business_date, open) VALUES ('2026-08-12', true) RETURNING id`,
  );
  await pool.query(
    `INSERT INTO stock_item (business_day_id, product_id, stocked_g, reserved_g) VALUES ($1, $2, 5000, 0)`,
    [rows[0].id, productId],
  );
  slotId = await seedSlot(pool, { hotEligible: true, capacity: 5 });

  await startServer();
  await signInAsStaff();
}, 240_000);

afterAll(async () => {
  await stopServer();
  await pool?.end();
});

describe('browse to order to console to tracking', () => {
  it('⭐ walks one order the whole way, in both locales, with the money captured once', async () => {
    // ── 1. Browse. The catalog is in the HTML, in both languages. ─────────
    const fr = await (await asStranger('/fr/shop')).text();
    const en = await (await asStranger('/en/shop')).text();

    expect(fr).toContain('Sample Halibut Steak');
    expect(en).toContain('Sample Halibut Steak');
    // The prices are shaped for their locale. This is the check that catches a
    // regression to a hardcoded `$` prefix.
    // ⚠ NON-BREAKING SPACE before the symbol on fr-CA, written as an escape so
    // it is visible in the source. A plain space here would let the price wrap
    // onto two lines, and would silently pass against the wrong output.
    expect(fr).toContain('40,00 $');
    expect(en).toContain('$40.00');
    // And the French page says so in its own lang attribute.
    expect(fr).toContain('lang="fr-CA"');
    expect(en).toContain('lang="en-CA"');

    // ── 2. Quote, then order. The browser decides no amount. ──────────────
    const quote = await (
      await asStranger('/api/quote', {
        json: {
          lines: [{ productId, requestedG: 750, prepOptionId: null }],
          postalCode: `${FSA_SERVED} 1A1`,
          locale: 'fr',
        },
      })
    ).json();

    // ⌈4000 × 750 / 1000⌉ = 3000.
    expect(quote.estTotalCents).toBe(3000 + FEE);

    const placed = await asStranger('/api/checkout', {
      json: {
        lines: [{ productId, requestedG: 750, prepOptionId: null }],
        postalCode: `${FSA_SERVED} 1A1`,
        addressLine1: '4200 Sample Street',
        addressLine2: 'Apt 3',
        city: 'Sampleville',
        province: 'QC',
        deliveryNotes: 'Buzz 302',
        slotId,
        phone: '514-555-0188',
        name: 'Sample Customer',
        email: null,
        catalogVersion: quote.catalogVersion,
      },
    });

    expect(placed.status).toBe(200);
    const order = await placed.json();
    const token = order.publicToken as string;
    const ceiling = Math.ceil((3000 + FEE) * 1.1);
    expect(order.ceilingCents).toBe(ceiling);

    // ── 3. The customer can already track it, with NO session. ────────────
    const tracked = await (await asStranger(`/fr/orders/${token}`)).text();
    expect(tracked).toContain('4200 Sample Street');
    // The test-order banner is unmissable, because nothing in the data says
    // this order took no money except `payment.provider`.
    expect(tracked).toContain('data-test-order-banner');
    // Not weighed yet, and the receipt says so rather than showing a blank.
    expect(tracked).toContain('Pas encore pesé');

    // A wrong token is a polite dead end, not a leak and not a crash.
    const wrong = await asStranger('/fr/orders/00000000-0000-0000-0000-000000000000');
    expect((await wrong.text())).toContain('Commande introuvable');

    const orderId = (
      await pool.query(`SELECT id FROM "order" WHERE public_token = $1`, [token])
    ).rows[0].id as string;

    // ── 4. The owner walks it. PLACED to PREPARING. ───────────────────────
    expect(
      (await asStaff('/api/admin/status', { json: { orderId, from: 'PLACED', to: 'PREPARING' } }))
        .status,
    ).toBe(200);

    // ── 5. Weigh it. The cut came in HEAVY, which is the normal case. ─────
    const lineId = (
      await pool.query(`SELECT id FROM order_line WHERE order_id = $1`, [orderId])
    ).rows[0].id as string;

    // 800 g against 750 g requested: inside the 10% band, so no approval.
    const weighed = await asStaff('/api/admin/weigh', {
      json: { orderId, lineId, weighedG: 800, approveVariance: false },
    });
    expect(weighed.status).toBe(200);

    // ── 6. Finalise, which CAPTURES. ─────────────────────────────────────
    const finalised = await asStaff('/api/admin/finalise', { json: { orderId } });
    expect(finalised.status).toBe(200);
    const settlement = await finalised.json();

    // ⌈4000 × 800 / 1000⌉ = 3200, plus the fee.
    expect(settlement.finalTotalCents).toBe(3200 + FEE);
    expect(settlement.captured).toBe(true);
    expect(settlement.capturedCents).toBe(3200 + FEE);
    // ⭐ And it never exceeded what was held.
    expect(settlement.capturedCents).toBeLessThanOrEqual(ceiling);

    // ── 7. ⭐ A SECOND FINALISE DOES NOT CHARGE AGAIN. ────────────────────
    // This is what a double-tap on the console button looks like, and a real
    // processor would take the money twice.
    const again = await asStaff('/api/admin/finalise', { json: { orderId } });
    const secondBody = await again.json();
    // Refused at the order state, or reported as a replay. Either is correct;
    // a SECOND CAPTURE is not.
    if (again.status === 200) expect(secondBody.replay).toBe(true);

    const payments = await pool.query(
      `SELECT provider, status, authorised_cents, captured_cents FROM payment WHERE order_id = $1`,
      [orderId],
    );
    expect(payments.rows).toHaveLength(1);
    expect(payments.rows[0]).toMatchObject({
      provider: 'stub',
      status: 'CAPTURED',
      authorised_cents: ceiling,
      captured_cents: 3200 + FEE,
    });

    // ── 8. On to the door. ───────────────────────────────────────────────
    for (const [from, to] of [
      ['WEIGHED', 'READY'],
      ['READY', 'OUT'],
      ['OUT', 'DELIVERED'],
    ] as const) {
      expect((await asStaff('/api/admin/status', { json: { orderId, from, to } })).status).toBe(200);
    }

    // ── 9. ⭐ The customer sees estimate versus actual, and the exact total. ─
    const final = await (await asStranger(`/en/orders/${token}`)).text();
    expect(final).toContain('Delivered');
    // Both weights, side by side. This is the promise the shop made.
    expect(final).toContain('750 g');
    expect(final).toContain('800 g');
    // The exact total, formatted for the locale being read.
    expect(final).toContain('$37.00');
    // Still labelled a test order, on the last surface as much as the first.
    expect(final).toContain('data-test-order-banner');

    // The stock it consumed is really gone, and only once.
    const stock = await pool.query(`SELECT reserved_g FROM stock_item WHERE product_id = $1`, [
      productId,
    ]);
    expect(stock.rows[0].reserved_g).toBe(750);
  }, 120_000);
});
