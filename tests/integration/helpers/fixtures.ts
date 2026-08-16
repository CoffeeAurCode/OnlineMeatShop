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

/**
 * A served COORDINATE, for the path a phone actually takes. Not an address:
 * a point in the river, with a radius around it, so it locates nobody.
 */
export const POINT_SERVED = { lat: 45.5, lng: -73.6 } as const;
export const RADIUS_SERVED_M = 20_000;

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

/**
 * A delivery zone. Fee values are fictional.
 *
 * A circle is optional, and all three of its columns move together or the row
 * is refused — `zone_circle_whole` says so in the schema, so passing one is
 * passing all of them.
 */
export async function seedZone(
  pool: Pool,
  opts: {
    name: string;
    feeCents: number;
    freeAboveCents?: number | null;
    /** `| undefined` because `exactOptionalPropertyTypes` is on: a caller that
     *  forwards its own optional circle is passing the property, not omitting it. */
    circle?: { lat: number; lng: number; radiusM: number } | undefined;
  },
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO zone (name, fee_cents, free_above_cents, centre_lat, centre_lng, radius_m)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      opts.name,
      opts.feeCents,
      opts.freeAboveCents ?? null,
      opts.circle?.lat ?? null,
      opts.circle?.lng ?? null,
      opts.circle?.radiusM ?? null,
    ],
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

/** A customer. Fictional details only — this repository is public. */
export async function seedCustomer(pool: Pool, email = 'sample@example.test'): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO customer (email, name) VALUES ($1, $2) RETURNING id`,
    [email, 'Sample Customer'],
  );
  return rows[0].id as string;
}

/** A zone covering FSA A1A, plus the serviceable_fsa row. */
export async function seedServedArea(
  pool: Pool,
  opts: {
    feeCents?: number;
    freeAboveCents?: number | null;
    /** Give the zone a circle too, so the COORDINATE path resolves as well. */
    circle?: { lat: number; lng: number; radiusM: number };
  } = {},
): Promise<string> {
  const zoneId = await seedZone(pool, {
    name: `zone-${Math.random().toString(36).slice(2, 8)}`,
    feeCents: opts.feeCents ?? 0,
    freeAboveCents: opts.freeAboveCents ?? null,
    circle: opts.circle,
  });
  await pool.query(`INSERT INTO serviceable_fsa (fsa, zone_id) VALUES ($1, $2)`, [
    FSA_SERVED,
    zoneId,
  ]);
  return zoneId;
}

/**
 * An AUTHORISED checkout attempt — the state placement expects to claim.
 *
 * `quotedEstCents` must equal what the placement recomputes or P8 fires, which
 * is the point of the test that deliberately mismatches it.
 */
export async function seedAuthorisedAttempt(
  pool: Pool,
  opts: {
    customerId: string;
    cartHash: string;
    quotedEstCents: number;
    quoteVersion?: number;
    authorisedCeilingCents?: number;
  },
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO checkout_attempt
       (customer_id, cart_hash, quote_version, quoted_est_cents,
        authorised_ceiling_cents, payment_intent_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'AUTHORISED')
     RETURNING id`,
    [
      opts.customerId,
      opts.cartHash,
      opts.quoteVersion ?? 1,
      opts.quotedEstCents,
      opts.authorisedCeilingCents ?? Math.ceil(opts.quotedEstCents * 1.1),
      `pi_test_${Math.random().toString(36).slice(2, 12)}`,
    ],
  );
  return rows[0].id as string;
}
