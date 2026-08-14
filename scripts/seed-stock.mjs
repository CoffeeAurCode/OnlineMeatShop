#!/usr/bin/env node
/**
 * Put a placeholder quantity of every active product on today's open trading
 * day, so the customer flow can actually be walked end to end.
 *
 * ⚠ THIS IS A TESTING TOOL, NOT AN OWNER TOOL. Declaring the morning's
 * quantities is the owner's job and it has a screen — `/admin/stock`, which
 * goes through `adjustStock` and reports which product a refusal is about. Use
 * that for anything real. This exists because a prototype where 36 of 38
 * products are out of stock cannot demonstrate the two things that make this
 * shop unusual: a per-kg line billed on actual weight, and the hot-food slot
 * rule. Both need something in stock to be reachable at all.
 *
 * ⭐ WHY IT IS SAFE TO WRITE `stock_item` FROM OUTSIDE `adjustStock`: the one
 * thing that operation protects is inv-A3, `reserved_g <= stocked_g`, and this
 * script can never lower a number (`GREATEST`), so it cannot newly violate it.
 * The database enforces inv-A3 as a CHECK regardless — that is the point of
 * having it there and not only in application code — so the worst case is a
 * failed transaction rather than stock that does not exist.
 *
 * It does NOT open a business day. Opening one is `openBusinessDay`, a domain
 * operation with its own preconditions and lock order; going around it with raw
 * SQL is how the two diverge. Open the day in `/admin/open` first.
 *
 * Usage:
 *   DIRECT_DATABASE_URL=postgres://... node scripts/seed-stock.mjs
 *
 * Optional:
 *   SEED_STOCK_KG=10        kilograms to put against each product
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';

try {
  process.loadEnvFile('.env.local');
} catch {
  /* no .env.local, which is expected in CI */
}

const url = process.env.SEED_DATABASE_URL ?? process.env.DIRECT_DATABASE_URL;
if (!url) {
  console.error('Set SEED_DATABASE_URL or DIRECT_DATABASE_URL.');
  process.exit(1);
}

const kg = Number(process.env.SEED_STOCK_KG ?? 10);
if (!Number.isFinite(kg) || kg <= 0 || kg > 1000) {
  console.error('SEED_STOCK_KG must be a positive number of kilograms, at most 1000.');
  process.exit(1);
}
const grams = Math.round(kg * 1000);

/** The same TLS decision the application makes — see `seed-catalog.mjs`. */
function tls(connectionString) {
  const host = new URL(connectionString).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
  return { ca: readFileSync('certs/supabase-prod-ca-2021.crt', 'utf8'), rejectUnauthorized: true };
}

const client = new pg.Client({ connectionString: url, ssl: tls(url) });
await client.connect();

try {
  await client.query('BEGIN');

  const { rows: days } = await client.query(
    `SELECT id, business_date::text AS d FROM business_day WHERE open`,
  );
  const day = days[0];
  if (!day) {
    console.error('No trading day is open. Open one in /admin/open first — this script will not.');
    process.exit(1);
  }

  const { rows } = await client.query(
    `INSERT INTO stock_item (business_day_id, product_id, stocked_g, reserved_g)
          SELECT $1, p.id, $2, 0 FROM product p WHERE p.active
     ON CONFLICT (business_day_id, product_id) DO UPDATE
            -- NEVER LOWERS. A smaller number here could sit below a
            -- reserved_g that customers are already holding, which is the one
            -- thing inv-A3 exists to refuse.
            SET stocked_g = GREATEST(stock_item.stocked_g, excluded.stocked_g)
       RETURNING product_id`,
    [day.id, grams],
  );

  await client.query('COMMIT');
  console.log(`Stocked ${rows.length} active products at ${kg} kg each on ${day.d}.`);
  console.log('⚠ Placeholder quantities for testing. The owner declares the real ones in /admin/stock.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
