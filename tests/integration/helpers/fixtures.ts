import type { Pool } from 'pg';

/**
 * Fixtures for the integration and concurrency suites.
 *
 * ⚠ EVERY VALUE HERE IS FICTIONAL, AND THAT IS A HARD RULE, NOT TIDINESS.
 * This repository is public. Real product names, real prices, real postal
 * codes or real slot times would be client data published permanently in git
 * history. See CLAUDE.md §1. `Sample …`, `Test …`, FSA `A1A`.
 */

export const FSA_SERVED = 'A1A';
export const FSA_UNSERVED = 'Z9Z';

export interface SeededProduct {
  id: string;
  slug: string;
}

/** A per-kg product: cut to order, billed on actual weight. */
export async function seedPerKgProduct(
  pool: Pool,
  opts: {
    slug: string;
    name?: string;
    ratePerKgCents: number;
    minOrderG?: number;
    stepG?: number;
    handling?: 'RAW' | 'MARINATED' | 'COOKED_CHILLED' | 'COOKED_HOT';
    taxCode?: string;
    active?: boolean;
  },
): Promise<SeededProduct> {
  const { rows } = await pool.query(
    `INSERT INTO product
       (name, slug, handling, pricing_mode, rate_per_kg_cents, min_order_g, step_g, tax_code, active)
     VALUES ($1, $2, $3, 'perKg', $4, $5, $6, $7, $8)
     RETURNING id, slug`,
    [
      opts.name ?? `Sample ${opts.slug}`,
      opts.slug,
      opts.handling ?? 'RAW',
      opts.ratePerKgCents,
      opts.minOrderG ?? 500,
      opts.stepG ?? 250,
      opts.taxCode ?? 'ZERO_RATED_BASIC_GROCERY',
      opts.active ?? true,
    ],
  );
  return rows[0] as SeededProduct;
}

/** A pack product: fixed price, declared weight range, never re-priced. */
export async function seedPackProduct(
  pool: Pool,
  opts: {
    slug: string;
    name?: string;
    packPriceCents: number;
    wMinG?: number;
    wMaxG?: number;
    handling?: 'RAW' | 'MARINATED' | 'COOKED_CHILLED' | 'COOKED_HOT';
    taxCode?: string;
    active?: boolean;
  },
): Promise<SeededProduct> {
  const { rows } = await pool.query(
    `INSERT INTO product
       (name, slug, handling, pricing_mode, pack_price_cents, w_min_g, w_max_g, tax_code, active)
     VALUES ($1, $2, $3, 'pack', $4, $5, $6, $7, $8)
     RETURNING id, slug`,
    [
      opts.name ?? `Sample ${opts.slug}`,
      opts.slug,
      opts.handling ?? 'COOKED_CHILLED',
      opts.packPriceCents,
      opts.wMinG ?? 400,
      opts.wMaxG ?? 500,
      opts.taxCode ?? 'STANDARD',
      opts.active ?? true,
    ],
  );
  return rows[0] as SeededProduct;
}

/** An open trading day with declared quantities. */
export async function seedBusinessDay(
  pool: Pool,
  businessDate: string,
  stock: ReadonlyArray<{ productId: string; stockedG: number; reservedG?: number }> = [],
): Promise<string> {
  await pool.query(`UPDATE business_day SET open = false, closed_at = now() WHERE open`);
  const { rows } = await pool.query(
    `INSERT INTO business_day (business_date, open) VALUES ($1, true) RETURNING id`,
    [businessDate],
  );
  const id = rows[0].id as string;
  for (const s of stock) {
    await pool.query(
      `INSERT INTO stock_item (business_day_id, product_id, stocked_g, reserved_g)
       VALUES ($1, $2, $3, $4)`,
      [id, s.productId, s.stockedG, s.reservedG ?? 0],
    );
  }
  return id;
}

/** A delivery zone. Fee values are fictional. */
export async function seedZone(
  pool: Pool,
  opts: { name: string; feeCents: number; freeAboveCents?: number | null },
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO zone (name, fee_cents, free_above_cents) VALUES ($1, $2, $3) RETURNING id`,
    [opts.name, opts.feeCents, opts.freeAboveCents ?? null],
  );
  return rows[0].id as string;
}

/**
 * A delivery slot on a fixed fictional date.
 *
 * Offsets are relative to the slot start so a test can express "the cutoff has
 * already passed" without arithmetic at the call site. A POSITIVE
 * `cutoffOffsetHours` puts the cutoff AFTER the start, which inv-F5 refuses —
 * that is how the constraint test asks for an illegal row.
 */
export async function seedSlot(
  pool: Pool,
  opts: {
    capacity?: number;
    bookedCount?: number;
    hotEligible?: boolean;
    active?: boolean;
    serviceDate?: string;
    /** Slot start, as an offset in hours from now. */
    startOffsetHours?: number;
    /** Cutoff, as an offset in hours from the START. Negative = before it. */
    cutoffOffsetHours?: number;
  } = {},
): Promise<string> {
  const startOffset = opts.startOffsetHours ?? 6;
  const cutoffOffset = opts.cutoffOffsetHours ?? -4;
  const { rows } = await pool.query(
    `INSERT INTO slot
       (service_date, starts_at, ends_at, cutoff_at, capacity, booked_count, hot_eligible, active)
     VALUES ($1,
             now() + ($2 || ' hours')::interval,
             now() + ($3 || ' hours')::interval,
             now() + ($4 || ' hours')::interval,
             $5, $6, $7, $8)
     RETURNING id`,
    [
      opts.serviceDate ?? '2026-08-12',
      String(startOffset),
      String(startOffset + 2),
      String(startOffset + cutoffOffset),
      opts.capacity ?? 10,
      opts.bookedCount ?? 0,
      opts.hotEligible ?? false,
      opts.active ?? true,
    ],
  );
  return rows[0].id as string;
}
