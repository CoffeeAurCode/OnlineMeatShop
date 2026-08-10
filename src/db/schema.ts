import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * The database schema. This file is the only description of the tables;
 * migrations are generated from it and checked into git.
 *
 * Increment 1 covers the catalog. Availability, fulfilment, orders, payments
 * and the notification outbox arrive in increments 2–6 and are deliberately
 * absent rather than stubbed — an empty table invites code that half-uses it.
 *
 * Naming: snake_case, singular, `_cents` on every money column, `_g` on every
 * weight.
 */

// ── Enums ────────────────────────────────────────────────────────────────

/**
 * Handling class. Drives shelf life and delivery-slot eligibility.
 *
 * NOT a tax code. Canadian tax treatment does not map onto these four values:
 * the same cooked chicken is taxed differently sold hot versus chilled. Tax
 * lives in its own column and is never derived from this one.
 */
export const handlingEnum = pgEnum('handling', [
  'RAW',
  'MARINATED',
  'COOKED_CHILLED',
  'COOKED_HOT',
]);

/** Exactly one per product. Which columns must be populated depends on it. */
export const pricingModeEnum = pgEnum('pricing_mode', ['pack', 'perKg']);

// ── product ──────────────────────────────────────────────────────────────

export const product = pgTable(
  'product',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description'),

    handling: handlingEnum('handling').notNull(),

    /**
     * NOT NULL with no default, on purpose.
     *
     * Every branch in pricing and weighing turns on this column. A nullable
     * one produces `undefined` in TypeScript, which is falsy, which silently
     * routes a per-kg product down the pack path — where the estimate is
     * treated as final and the item is never weighed. A missing value must
     * fail the insert, not pick a behaviour.
     */
    pricingMode: pricingModeEnum('pricing_mode').notNull(),

    // pack: fixed price for a declared weight range.
    packPriceCents: integer('pack_price_cents'),
    wMinG: integer('w_min_g'),
    wMaxG: integer('w_max_g'),

    // perKg: cut to order, billed on actual weight.
    ratePerKgCents: integer('rate_per_kg_cents'),
    minOrderG: integer('min_order_g'),
    stepG: integer('step_g'),

    /**
     * Explicit, never derived from `handling` (see the note on the enum).
     * Values are set once the accountant has confirmed the mapping; until
     * then this column exists and is populated conservatively.
     */
    taxCode: text('tax_code').notNull(),

    active: boolean('active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * Exactly one pricing mode is populated, and the other is entirely NULL.
     *
     * Without the negative half of this constraint a product can carry both a
     * pack price and a per-kg rate, and then which one applies depends on
     * which code path reads it first. That is the kind of ambiguity that
     * shows up as two different prices on the same order.
     */
    check(
      'product_pricing_mode_xor',
      sql`(
        ${t.pricingMode} = 'pack'
        AND ${t.packPriceCents} IS NOT NULL AND ${t.wMinG} IS NOT NULL AND ${t.wMaxG} IS NOT NULL
        AND ${t.ratePerKgCents} IS NULL AND ${t.minOrderG} IS NULL AND ${t.stepG} IS NULL
      ) OR (
        ${t.pricingMode} = 'perKg'
        AND ${t.ratePerKgCents} IS NOT NULL AND ${t.minOrderG} IS NOT NULL AND ${t.stepG} IS NOT NULL
        AND ${t.packPriceCents} IS NULL AND ${t.wMinG} IS NULL AND ${t.wMaxG} IS NULL
      )`,
    ),

    /** inv-C1: 0 < wMin ≤ wMax ∧ price > 0 */
    check(
      'product_pack_range_valid',
      sql`${t.pricingMode} <> 'pack' OR (
        ${t.packPriceCents} > 0 AND ${t.wMinG} > 0 AND ${t.wMinG} <= ${t.wMaxG}
      )`,
    ),

    /** inv-C2: rate > 0 ∧ step > 0 ∧ minOrder ≥ step */
    check(
      'product_perkg_valid',
      sql`${t.pricingMode} <> 'perKg' OR (
        ${t.ratePerKgCents} > 0 AND ${t.stepG} > 0 AND ${t.minOrderG} >= ${t.stepG}
      )`,
    ),
  ],
);

// ── prep_option (FR-4) ───────────────────────────────────────────────────

/**
 * Customer-selectable preparation choices on a per-kg product — bone-in or
 * boneless, curry cut, biryani cut, mince, piece size.
 *
 * These are rows against a product, NOT separate products. That is a
 * requirement (FR-4) and it has a consequence that reaches all the way into
 * order placement: "1 kg curry cut + 1 kg biryani cut" is ONE product on TWO
 * order lines. Stock demand therefore has to be aggregated across lines, and
 * checking availability line by line oversells on an ordinary basket.
 *
 * Recorded here because this table is the reason that is the normal case
 * rather than an edge case.
 */
export const prepOption = pgTable('prep_option', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id')
    .notNull()
    .references(() => product.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  /** Display order in the storefront. Not a price modifier — prep is free. */
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

// ── catalog_version ──────────────────────────────────────────────────────

/**
 * A single-row monotonic counter, bumped on any change to a price or to a
 * product's active flag.
 *
 * This exists for precondition P8. Real checkout is not instantaneous: the
 * customer is quoted a total, Stripe authorises it, and only then does
 * placement run. If the owner repriced a product in that window, the stored
 * order would disagree with the amount actually authorised. Comparing this
 * counter inside the placement transaction detects that cheaply, without
 * re-reading and re-comparing every product the basket touched.
 *
 * The single row is enforced by a CHECK on a fixed primary key rather than by
 * convention, because "there is only ever one row" is exactly the kind of
 * assumption that quietly stops being true.
 */
export const catalogVersion = pgTable(
  'catalog_version',
  {
    id: integer('id').primaryKey().default(1),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('catalog_version_single_row', sql`${t.id} = 1`)],
);
