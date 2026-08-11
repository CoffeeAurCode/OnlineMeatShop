import {
  boolean,
  check,
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
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

// ── business_day (spec §4 Availability) ──────────────────────────────────

/**
 * One trading day. The owner opens it each morning by declaring what is
 * actually in the shop.
 *
 * The spec models availability as a single `businessDate` with a single `open`
 * flag. That is mapped here as one row per date with at most one of them open
 * — enforced by a partial unique index, not by convention. "There is only one
 * current day" is precisely the assumption that stops being true the first
 * time two admin taps race, and the consequence is stock counted against the
 * wrong day.
 *
 * NOTHING ROLLS OVER. Opening a day creates fresh `stock_item` rows with
 * `reserved_g = 0`. Yesterday's unsold quantity is not today's stock, because
 * yesterday's unsold quantity is a physical question the owner answers by
 * looking at the counter, not one the database can infer.
 */
export const businessDay = pgTable(
  'business_day',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * A `date`, not a `timestamptz`. A trading day is a wall-clock concept in
     * the shop's own timezone — "Tuesday" — and storing an instant would make
     * it shift by an hour twice a year and land on the wrong side of midnight
     * for exactly the early-morning window when the owner uses this.
     */
    businessDate: date('business_date').notNull().unique(),

    open: boolean('open').notNull().default(true),

    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    /**
     * At most one open day, ever. A partial unique index over a constant is
     * the standard way to say "at most one row satisfying this predicate".
     */
    uniqueIndex('business_day_one_open')
      .on(sql`(true)`)
      .where(sql`${t.open}`),

    /** A closed day has a closing time; an open one does not. */
    check('business_day_closed_at_iff_closed', sql`${t.open} = (${t.closedAt} IS NULL)`),
  ],
);

// ── stock_item (spec §4 Availability) ────────────────────────────────────

/**
 * Today's sellable quantity of one product, and how much of it is already
 * committed to accepted orders.
 *
 * `available(p) ≜ stocked(p) − reserved(p)`. That subtraction is not stored:
 * a derived column would be a third number that can disagree with the two it
 * is derived from.
 */
export const stockItem = pgTable(
  'stock_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    businessDayId: uuid('business_day_id')
      .notNull()
      .references(() => businessDay.id, { onDelete: 'cascade' }),

    /** inv-A1: `dom stocked ⊆ dom products` — you cannot stock a non-product. */
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),

    stockedG: integer('stocked_g').notNull(),
    reservedG: integer('reserved_g').notNull().default(0),
  },
  (t) => [
    uniqueIndex('stock_item_day_product').on(t.businessDayId, t.productId),

    /**
     * ⭐ inv-A3 — THE ANTI-OVERSELLING RULE, as a database constraint.
     *
     * The application checks this too, inside the placement transaction, and
     * that check is the one that produces a useful error message. This one
     * exists for the case where the application check has a bug.
     *
     * The difference in outcome is the whole point. With the constraint, a
     * concurrency defect produces a failed transaction and an error page:
     * recoverable, visible, no money moved. Without it, the same defect
     * silently sells meat that does not exist, and it is discovered at 4pm by
     * a customer who does not get their order.
     *
     * DTM §6.2 calls this the highest-value paragraph in that document. It is
     * cheap enough that there is no argument against it.
     */
    check(
      'stock_not_oversold',
      sql`${t.reservedG} >= 0 AND ${t.reservedG} <= ${t.stockedG}`,
    ),

    check('stock_stocked_non_negative', sql`${t.stockedG} >= 0`),
  ],
);

// ── zone / serviceable_fsa (spec §4 Fulfilment) ──────────────────────────

/**
 * A delivery zone and its fee rule.
 *
 * ⚠ The real zones, fees and thresholds are BLOCKED on the client (DQ-3).
 * Nothing in this repository may contain them anyway — it is public. Real
 * values arrive at runtime through the seed that lives in the private parent
 * repository.
 */
export const zone = pgTable(
  'zone',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),

    /** Flat delivery fee for this zone, in cents. */
    feeCents: integer('fee_cents').notNull(),

    /**
     * Order subtotal at or above which delivery is free. `null` means never
     * free — distinct from `0`, which would make every order free delivery.
     * Those two are one typo apart and the difference is the whole margin.
     */
    freeAboveCents: integer('free_above_cents'),
  },
  (t) => [
    check('zone_fee_non_negative', sql`${t.feeCents} >= 0`),
    check('zone_free_above_positive', sql`${t.freeAboveCents} IS NULL OR ${t.freeAboveCents} > 0`),
  ],
);

/**
 * The set of postal areas served, and which zone each belongs to.
 *
 * This one table is both `serviceable` and `zoneOf` from the spec, which makes
 * **inv-F1 (`dom zoneOf = serviceable`) structurally true** rather than
 * something to check: an FSA cannot be serviceable without a zone, because
 * being in this table is what serviceable means. inv-F2 (`ran zoneOf ⊆ dom
 * zoneFee`) is the foreign key.
 *
 * Canada uses **FSAs** — the first three characters of a postal code, `A1A` —
 * not pincodes. Stored uppercase with no space; DTM §6.4.
 */
export const serviceableFsa = pgTable(
  'serviceable_fsa',
  {
    fsa: text('fsa').primaryKey(),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => zone.id, { onDelete: 'restrict' }),
  },
  (t) => [
    /** Normalised on the way in, and refused if it is not. */
    check('fsa_format', sql`${t.fsa} ~ '^[A-Z][0-9][A-Z]$'`),
  ],
);

// ── slot (spec §4 Fulfilment) ────────────────────────────────────────────

/**
 * A delivery window on a given day.
 *
 * ⚠ Real windows, cutoffs and which of them carry hot food are BLOCKED on the
 * client (DQ-4). The shape is here; the values are not, and must not be.
 *
 * TIMES ARE `timestamptz`, NOT wall-clock strings. The owner thinks in wall
 * clock — "order by 2pm" — but two wall-clock times a year are ambiguous or
 * nonexistent in a DST-observing zone, and a cutoff that silently moves by an
 * hour twice a year is a real, dated bug. The conversion from the owner's wall
 * clock to an instant happens once, at the point the slot is created, against
 * the shop's IANA timezone. See `src/domain/slots.ts`.
 */
export const slot = pgTable(
  'slot',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** The trading date this slot belongs to, in the shop's local calendar. */
    serviceDate: date('service_date').notNull(),

    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),

    /** After this instant the slot can no longer be chosen. Precondition P2. */
    cutoffAt: timestamp('cutoff_at', { withTimezone: true }).notNull(),

    capacity: integer('capacity').notNull(),

    /**
     * Denormalised counter rather than `count(*)` over orders.
     *
     * A counter can be locked and incremented inside the placement
     * transaction, which is what makes inv-F4 enforceable as a CHECK. A
     * `count(*)` cannot be constrained, and would have to be recomputed under
     * a lock anyway.
     */
    bookedCount: integer('booked_count').notNull().default(0),

    /**
     * inv-O3 — whether hot cooked-to-order food may be delivered in this slot.
     * A food-safety rule, not a preference.
     */
    hotEligible: boolean('hot_eligible').notNull().default(false),

    active: boolean('active').notNull().default(true),
  },
  (t) => [
    /** ⭐ inv-F4 — no overbooked slots, enforced by the database. */
    check(
      'slot_not_overbooked',
      sql`${t.bookedCount} >= 0 AND ${t.bookedCount} <= ${t.capacity}`,
    ),

    /** inv-F5 — `cutoff ≤ start < end`. */
    check(
      'slot_times_ordered',
      sql`${t.cutoffAt} <= ${t.startsAt} AND ${t.startsAt} < ${t.endsAt}`,
    ),

    check('slot_capacity_positive', sql`${t.capacity} > 0`),
  ],
);
