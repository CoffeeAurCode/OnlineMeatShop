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

let pool: Pool;
let catalogRepo: typeof import('@/db/repositories/admin');
let partnerRepo: typeof import('@/db/repositories/partners');

beforeAll(async () => {
  await migrateTestDatabase();
  pool = testPool();
  [catalogRepo, partnerRepo] = await Promise.all([
    import('@/db/repositories/admin'),
    import('@/db/repositories/partners'),
  ]);
});

afterAll(async () => {
  await pool.end();
  const { pool: appPool } = await import('@/db/client');
  await appPool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

describe('admin catalog maintenance', () => {
  it('creates a valid item, bumps the quote version, and refuses unsafe deletion', async () => {
    const category = await pool.query<{ id: string }>(
      `INSERT INTO category (slug, name_en, name_fr) VALUES ('sample-fish', 'Sample Fish', 'Poisson exemple') RETURNING id`,
    );
    const categoryId = category.rows[0]?.id;
    expect(categoryId).toBeTypeOf('string');

    const created = await catalogRepo.createProduct({
      name: 'Sample Haddock',
      nameFr: 'Aiglefin exemple',
      description: null,
      descriptionFr: null,
      slug: 'sample-haddock',
      categoryId: categoryId!,
      handling: 'RAW',
      taxCode: 'ZERO_RATED_BASIC_GROCERY',
      pricingMode: 'perKg',
      ratePerKgCents: 2_400,
      minOrderG: 500,
      stepG: 250,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const version = await pool.query<{ version: number }>(`SELECT version FROM catalog_version WHERE id = 1`);
    expect(version.rows[0]?.version).toBe(2);
    expect(await catalogRepo.deleteProduct(created.id)).toEqual({
      ok: false,
      reason: 'mustDeactivate',
    });

    await catalogRepo.updateProduct(created.id, { active: false });
    const dayId = await seedBusinessDay(pool, '2026-08-20');
    await pool.query(
      `INSERT INTO stock_item (business_day_id, product_id, stocked_g, reserved_g) VALUES ($1, $2, 1000, 250)`,
      [dayId, created.id],
    );
    expect(await catalogRepo.deleteProduct(created.id)).toEqual({
      ok: false,
      reason: 'reservedStock',
    });

    await pool.query(`UPDATE stock_item SET reserved_g = 0 WHERE product_id = $1`, [created.id]);
    expect(await catalogRepo.deleteProduct(created.id)).toEqual({ ok: true });
    const remaining = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM product WHERE id = $1`, [
      created.id,
    ]);
    expect(remaining.rows[0]?.count).toBe(0);
  });

  it('refuses duplicate slugs without partially changing the catalog version', async () => {
    const category = await pool.query<{ id: string }>(
      `INSERT INTO category (slug, name_en, name_fr) VALUES ('sample-poultry', 'Sample Poultry', 'Volaille exemple') RETURNING id`,
    );
    const categoryId = category.rows[0]!.id;
    const input = {
      name: 'Sample Pack',
      nameFr: 'Paquet exemple',
      description: null,
      descriptionFr: null,
      slug: 'sample-pack',
      categoryId,
      handling: 'COOKED_CHILLED' as const,
      taxCode: 'STANDARD' as const,
      pricingMode: 'pack' as const,
      packPriceCents: 1_200,
      wMinG: 400,
      wMaxG: 500,
    };
    expect((await catalogRepo.createProduct(input)).ok).toBe(true);
    expect(await catalogRepo.createProduct(input)).toEqual({
      ok: false,
      reason: 'duplicateSlug',
    });
    const version = await pool.query<{ version: number }>(`SELECT version FROM catalog_version WHERE id = 1`);
    expect(version.rows[0]?.version).toBe(2);
  });

  it('keeps a retired product when an order line references its history', async () => {
    await seedServedArea(pool);
    const item = await seedPerKgProduct(pool, {
      slug: 'sample-historical-item',
      ratePerKgCents: 2_000,
      active: false,
    });
    const dayId = await seedBusinessDay(pool, '2026-08-20');
    const slotId = await seedSlot(pool);
    const customerId = await seedCustomer(pool, 'sample-history@example.test');
    const placed = await pool.query<{ id: string }>(
      `INSERT INTO "order"
         (customer_id, postal_code, fsa, address_line1, city, province,
          slot_id, business_day_id, pay_mode, status,
          est_line_total_cents, delivery_fee_cents, est_total_cents,
          catalog_version, slot_hot_eligible, has_hot_line)
       VALUES ($1, $2, $3, '1 Test Street', 'Testville', 'QC', $4, $5,
               'PREPAID', 'PLACED', 1000, 0, 1000, 1, false, false)
       RETURNING id`,
      [customerId, `${FSA_SERVED} 1A1`, FSA_SERVED, slotId, dayId],
    );
    await pool.query(
      `INSERT INTO order_line
         (order_id, product_id, product_name, pricing_mode, handling,
          rate_per_kg_cents, requested_g, est_amount_cents, tax_code)
       VALUES ($1, $2, 'Sample historical item', 'perKg', 'RAW', 2000, 500, 1000,
               'ZERO_RATED_BASIC_GROCERY')`,
      [placed.rows[0]!.id, item.id],
    );

    expect(await catalogRepo.deleteProduct(item.id)).toEqual({ ok: false, reason: 'hasOrderHistory' });
    const remaining = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM product WHERE id = $1`,
      [item.id],
    );
    expect(remaining.rows[0]?.count).toBe(1);
  });
});

describe('admin driver maintenance', () => {
  async function orderAssignedTo(partnerId: string, status: 'READY' | 'DELIVERED') {
    await seedServedArea(pool);
    const item = await seedPerKgProduct(pool, {
      slug: `sample-driver-${status.toLowerCase()}`,
      ratePerKgCents: 2_000,
    });
    const dayId = await seedBusinessDay(pool, '2026-08-20', [{ productId: item.id, stockedG: 5_000 }]);
    const slotId = await seedSlot(pool);
    const customerId = await seedCustomer(pool, `sample-${status.toLowerCase()}@example.test`);
    const result = await pool.query<{ id: string }>(
      `INSERT INTO "order"
         (customer_id, postal_code, fsa, address_line1, city, province,
          slot_id, business_day_id, pay_mode, status,
          est_line_total_cents, delivery_fee_cents, est_total_cents, final_total_cents,
          catalog_version, slot_hot_eligible, has_hot_line,
          delivery_partner_id, partner_name, partner_phone, assigned_at, delivered_at)
       VALUES ($1, $2, $3, '1 Test Street', 'Testville', 'QC', $4, $5,
               'PREPAID', $6::order_status, 1000, 0, 1000, 1000, 1, false, false,
               $7, 'Sample Driver', '+15145550142', now(),
               CASE WHEN $6::text = 'DELIVERED' THEN now() ELSE NULL END)
       RETURNING id`,
      [customerId, `${FSA_SERVED} 1A1`, FSA_SERVED, slotId, dayId, status, partnerId],
    );
    return result.rows[0]!.id;
  }

  it('requires deactivation and refuses deletion while a live job is assigned', async () => {
    const added = await partnerRepo.addPartner({
      name: 'Sample Driver',
      phone: '+15145550142',
      notes: null,
      sortOrder: 0,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(await partnerRepo.deletePartner(added.id)).toEqual({
      ok: false,
      reason: 'mustDeactivate',
    });
    await partnerRepo.updatePartner(added.id, { active: false });
    await orderAssignedTo(added.id, 'READY');
    expect(await partnerRepo.deletePartner(added.id)).toEqual({
      ok: false,
      reason: 'hasLiveJobs',
    });
  });

  it('deletes an inactive driver after delivery while preserving the order snapshot', async () => {
    const added = await partnerRepo.addPartner({
      name: 'Sample Driver',
      phone: '+15145550142',
      notes: null,
      sortOrder: 0,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const orderId = await orderAssignedTo(added.id, 'DELIVERED');
    await partnerRepo.updatePartner(added.id, { active: false });
    expect(await partnerRepo.deletePartner(added.id)).toEqual({ ok: true });

    const snapshot = await pool.query<{
      delivery_partner_id: string | null;
      partner_name: string;
      partner_phone: string;
    }>(`SELECT delivery_partner_id, partner_name, partner_phone FROM "order" WHERE id = $1`, [orderId]);
    expect(snapshot.rows[0]).toEqual({
      delivery_partner_id: null,
      partner_name: 'Sample Driver',
      partner_phone: '+15145550142',
    });
  });
});
