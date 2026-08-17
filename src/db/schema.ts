import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
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

// ── category ─────────────────────────────────────────────────────────────

/**
 * The merchandising axis: how a shopper is invited to browse.
 *
 * ⭐ `category` and `handling` are orthogonal and both are needed.
 *
 * `handling` is a FOOD-SAFETY axis and it drives delivery-slot eligibility.
 * `category` is a SHOPPING axis. Collapsing them would either hand a
 * food-safety rule to whoever arranges the shelves, or force a category like
 * "Lobster" to pick a single shelf life when it legitimately spans live, raw
 * and cooked. Handling is therefore a FILTER within a category, never the
 * top-level grouping.
 *
 * Bilingual because the storefront is, and because these are words the owner
 * edits rather than strings a developer ships. See the note on `name_fr` in
 * `product`.
 */
export const category = pgTable(
  'category',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),

    nameEn: text('name_en').notNull(),
    nameFr: text('name_fr').notNull(),
    blurbEn: text('blurb_en'),
    blurbFr: text('blurb_fr'),

    /** Path under `public/`, not a URL. Resolved by `next/image` at render. */
    imagePath: text('image_path'),

    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('category_sort_idx').on(t.sortOrder)],
);

// ── product ──────────────────────────────────────────────────────────────

export const product = pgTable(
  'product',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description'),

    /**
     * French copy. Nullable, and the storefront falls back to the English
     * column when it is absent, because a product with no French name must
     * still be sellable — the alternative is that adding a product in a hurry
     * at 6am fails a NOT NULL and the fish does not go on sale.
     *
     * `name`/`description` are the English columns. They are not renamed to
     * `name_en` on purpose: every existing query, repository and test reads
     * `name`, and a rename buys nothing but a large diff and a migration that
     * can half-apply.
     */
    nameFr: text('name_fr'),
    descriptionFr: text('description_fr'),

    /** Path under `public/`, not a URL. See the note on `category`. */
    imagePath: text('image_path'),

    /**
     * `on delete restrict`: deleting a category that still has products must
     * fail loudly rather than cascade the catalog away or silently orphan it.
     * Nullable so a product can exist before it has been merchandised.
     */
    categoryId: uuid('category_id').references(() => category.id, { onDelete: 'restrict' }),

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

    /** Every category page runs this filter; it is the storefront's hot path. */
    index('product_category_idx').on(t.categoryId, t.active),
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

    /**
     * ⭐ THE ZONE AS A CIRCLE, which is what a delivery area actually is.
     *
     * All three are NULL for a zone defined the old way, by the FSA prefixes
     * pointing at it in `serviceable_fsa`. A zone may be defined either way or
     * both ways; the CHECK below only insists that a circle is whole.
     *
     * Overlapping circles are LEGAL and useful: an inner ring at a lower fee
     * inside an outer ring is the normal arrangement for a shop with one van.
     * `checkServiceabilityAt` resolves a point to the SMALLEST circle
     * containing it, so the tighter zone wins without the seed having to order
     * anything.
     *
     * `numeric`, not `real`, for the reason the money rule gives: a coordinate
     * that is compared in a test must not depend on the last bits of a double.
     */
    centreLat: numeric('centre_lat', { precision: 9, scale: 6 }),
    centreLng: numeric('centre_lng', { precision: 9, scale: 6 }),
    /** Whole metres. Integer against integer, so a boundary is decidable. */
    radiusM: integer('radius_m'),
  },
  (t) => [
    check('zone_fee_non_negative', sql`${t.feeCents} >= 0`),
    check('zone_free_above_positive', sql`${t.freeAboveCents} IS NULL OR ${t.freeAboveCents} > 0`),

    /**
     * A circle is all three columns or none of them. Half a circle silently
     * means "this zone covers nothing", which looks like a delivery outage and
     * reads like a working configuration.
     */
    check(
      'zone_circle_whole',
      sql`(${t.centreLat} IS NULL AND ${t.centreLng} IS NULL AND ${t.radiusM} IS NULL)
          OR (${t.centreLat} IS NOT NULL AND ${t.centreLng} IS NOT NULL AND ${t.radiusM} IS NOT NULL)`,
    ),

    check(
      'zone_circle_on_earth',
      sql`(${t.centreLat} IS NULL
           OR (${t.centreLat} BETWEEN -90 AND 90 AND ${t.centreLng} BETWEEN -180 AND 180))
          AND (${t.radiusM} IS NULL OR ${t.radiusM} > 0)`,
    ),
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

// ═════════════════════════════════════════════════════════════════════════
// Increment 4 — orders, checkout, payments
// ═════════════════════════════════════════════════════════════════════════

export const orderStatusEnum = pgEnum('order_status', [
  'PLACED',
  'PREPARING',
  'WEIGHED',
  'READY',
  'OUT',
  'DELIVERED',
  'CANCELLED',
]);

export const payModeEnum = pgEnum('pay_mode', ['PREPAID', 'COD']);

/**
 * Payment lifecycle — a SEPARATE state machine from `order_status`, joined by
 * an ID and never derived from it (DTM §8.3).
 *
 * They fail independently. An order can be READY while its capture is still
 * pending, and a capture can succeed against an order cancelled a second
 * earlier. Collapsing them into one column makes those states inexpressible,
 * which does not make them stop happening — it makes them unrecordable.
 */
export const paymentStatusEnum = pgEnum('payment_status', [
  'REQUIRES_PAYMENT_METHOD',
  'REQUIRES_CAPTURE',
  'CAPTURED',
  'CANCELLED',
  'FAILED',
  'DISPUTED',
]);

export const checkoutAttemptStatusEnum = pgEnum('checkout_attempt_status', [
  'OPEN',
  'AUTHORISED',
  'CONSUMED',
  'ABANDONED',
]);

// ── customer ─────────────────────────────────────────────────────────────

export const customer = pgTable(
  'customer',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * NULLABLE, and it used to be `notNull().unique()`.
     *
     * The shop is phone-first: a customer identifies themselves with a number
     * and may never give an email at all. Widening a NOT NULL is safe;
     * narrowing it back is not, because by then rows exist that violate it.
     * The uniqueness is kept but moves to a PARTIAL index for the same reason
     * as `phone` below.
     */
    email: text('email'),

    /** Normalised to E.164 before it is written. Never stored as typed. */
    phone: text('phone'),
    name: text('name'),

    /**
     * Stamped by a successful OTP check, and NULL for the whole prototype
     * because no verification happens yet.
     *
     * Its nullness is the point: it is what tells a future reader that a
     * given customer's number was never proven, rather than leaving that fact
     * recorded nowhere. This is the seam `TwilioPhoneVerifier` plugs into.
     */
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),

    /**
     * CASL (DTM §11.4). Transactional order messages need no consent; marketing
     * does, and the penalties are severe. Stored WITH its timestamp and source
     * because that record is the only defence.
     */
    marketingConsentAt: timestamp('marketing_consent_at', { withTimezone: true }),
    marketingConsentSource: text('marketing_consent_source'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * ⭐ PARTIAL unique indexes, on purpose, for both optional identifiers.
     *
     * A plain `UNIQUE` treats NULLs as distinct in Postgres, which happens to
     * be the behaviour we want — but it is not the behaviour every engine or
     * every `NULLS NOT DISTINCT` configuration gives, and relying on a default
     * that varies is how "only one customer may have no email" becomes a
     * production incident at the second anonymous checkout. Saying `where …
     * is not null` states the intent instead of inheriting it.
     */
    uniqueIndex('customer_phone_unique').on(t.phone).where(sql`${t.phone} IS NOT NULL`),
    uniqueIndex('customer_email_unique').on(t.email).where(sql`${t.email} IS NOT NULL`),
  ],
);

/**
 * ⭐ THE SIGN-IN LINK CARRIED BY THE DISPATCH SMS.
 *
 * One tap from the text into the job. No code to type — a login code cannot go
 * in a dispatch SMS at all, because a code is minted when somebody asks for one
 * and expires, so one printed into a text sent hours earlier is either already
 * dead or a standing password.
 *
 * ══ WHAT BOUNDS IT, AND WHAT DELIBERATELY DOES NOT ════════════════════════
 *
 * ⚠ **TIME IS THE ONLY BOUND. THE LINK IS NOT SINGLE USE.** An earlier draft
 * spent the token on first use so a forwarded copy would be worthless; the
 * client removed that on 2026-08-17. The reasoning is sound: a driver who
 * reopens their own text must not find themselves locked out, and that failure
 * is both likelier and more expensive than the one it was guarding against.
 *
 * ⚠ SO A FORWARDED TEXT WORKS, FOR UP TO TWELVE HOURS. Stated plainly because
 * it is a deliberate acceptance rather than an oversight. What still holds:
 *
 *   - **12 hours, enforced on every visit** (`DRIVER_LINK_TTL_MS`). Dead by the
 *     next morning whether it was used or not.
 *   - **Revocation is immediate.** `delivery_partner.active` is re-read on
 *     every driver request, so deactivating somebody kills every link they
 *     hold, expiry or not.
 *   - **Only a hash is stored**, so reading this table yields nothing usable.
 *   - **Expired rows are swept** (`sweepDriverLinksJob`), which is what stops
 *     the table growing without bound now that nothing deletes a link on use.
 */
export const driverLink = pgTable(
  'driver_link',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * ⚠ SHA-256 HEX OF THE TOKEN. THE TOKEN ITSELF IS NEVER STORED.
     *
     * Same reason a password is hashed: a backup, a support query or a leaked
     * dump would otherwise hand out working sign-in links for every driver for
     * the next twelve hours.
     */
    tokenHash: text('token_hash').notNull(),

    partnerId: uuid('partner_id')
      .notNull()
      .references(() => deliveryPartner.id, { onDelete: 'cascade' }),

    /**
     * Where the link lands. Nullable, and `set null` rather than `cascade`,
     * because ⭐ THE LINK IS A SIGN-IN, NOT PERMISSION TO SEE ONE ORDER. If the
     * order goes, the link still legitimately signs the driver in; it just
     * lands on their job list instead.
     */
    orderId: uuid('order_id').references(() => order.id, { onDelete: 'set null' }),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('driver_link_token_hash').on(t.tokenHash),
    index('driver_link_partner_expiry').on(t.partnerId, t.expiresAt),
  ],
);

// ── delivery_partner ───────────────────────────────────────────────────

/**
 * The people who carry the boxes.
 *
 * ⭐ A PARTNER IS A ROW, NOT A USER. `07-PLAN` §1.5 and §2.1.
 *
 * They do not sign in. No account, no password, no session, no console. The
 * instinct is to give them a login and the instinct is wrong at this size:
 *
 *   - The shop does 2-6 orders a day with one van. There is no dispatch
 *     problem to solve, only a communication one.
 *   - An account is a credential, a reset flow, a lockout policy and a support
 *     burden, for a person who needs to know one address at a time.
 *   - Every authenticated surface is new attack surface on a public repo's
 *     deployment, and this one would hold customer home addresses.
 *
 * What they get instead is a text message (`src/domain/dispatch.ts`).
 */
export const deliveryPartner = pgTable(
  'delivery_partner',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),

    /**
     * ⚠ E.164, WITH A CHECK, NOT FREE TEXT.
     *
     * Every mechanism downstream — Twilio's API, an `sms:` link, `wa.me` --
     * needs the international form. A number stored as `514-555-0142` fails at
     * the LAST step, at the moment the order is going out of the door and the
     * owner has no time to debug it. Normalise at the boundary
     * (`src/domain/phone.ts`) and let the database refuse anything else.
     */
    phone: text('phone').notNull(),

    active: boolean('active').notNull().default(true),

    /** Free text the owner reads: "van", "bike, no highway", "weekends only". */
    notes: text('notes'),

    /** The order they appear in the picker. Lowest first. */
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /*
     * ⚠ `[+]`, NOT `\+`. The backslash does not survive.
     *
     * `sql` is a TAGGED TEMPLATE LITERAL, so TypeScript resolves the escape
     * before Drizzle ever sees the string: `\+` in this file becomes a bare
     * `+` in the emitted SQL, and `^+` is an invalid POSIX quantifier that
     * Postgres refuses outright. Writing `\+` works but is one careless
     * reformat away from breaking again, and it breaks at MIGRATION time on
     * the live database rather than here.
     *
     * A bracket expression means the same thing and has no escape to lose.
     */
    check('partner_phone_e164', sql`${t.phone} ~ '^[+][1-9][0-9]{6,14}$'`),

    /**
     * ⭐ UNIQUE ON `(phone) WHERE active`, NOT ON `phone`.
     *
     * Two live rows with the same number means one dispatch sent twice, which
     * is how two drivers turn up at one door. But a partner who leaves and
     * comes back must be re-addable, and the deactivated row has to STAY for
     * the orders that reference it — so the uniqueness has to be scoped to
     * the live ones.
     */
    uniqueIndex('partner_phone_active').on(t.phone).where(sql`${t.active}`),
  ],
);

// ── shop_setting ───────────────────────────────────────────────────────

/**
 * Operational settings the OWNER changes, as key/value rows.
 *
 * ══ WHY A KEY/VALUE TABLE AND NOT COLUMNS ════════════════════════
 *
 * Normally this shape is a mistake — it defeats types, constraints and every
 * query planner. It is right here for one narrow reason: these are settings
 * with NO relational meaning and no invariant that spans them. Nothing joins
 * to "the new-order chime volume". A migration per preference would be a
 * migration per preference.
 *
 * ⚠ THE LINE THIS MUST NOT CROSS: anything a CHECK constraint should
 * enforce, or anything another table references, gets a real column. The
 * delivery zone's fee and radius are NOT in here for exactly that reason --
 * they live on `zone`, where `zone_circle_whole` can refuse a half-written
 * circle. If you find yourself wanting to validate a value in here against
 * another one in here, you have found the boundary and the answer is a column.
 *
 * `value` is jsonb so a setting can be a boolean, a number or a string without
 * a parse step at every read.
 */
export const shopSetting = pgTable('shop_setting', {
  /** Dotted, namespaced: `console.newOrderSound`, `console.newOrderMessage`. */
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /** Which staff row last wrote it. Nullable: a seed script has no staff id. */
  updatedBy: uuid('updated_by').references(() => staff.id, { onDelete: 'set null' }),
});

// ── order ────────────────────────────────────────────────────────────────

export const order = pgTable(
  'order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'restrict' }),

    /**
     * Normalised: uppercase, no space. `fsa` is denormalised for reporting.
     *
     * ⚠ BOTH ARE NULLABLE SINCE THE ADDRESS BECAME A COORDINATE. An order
     * placed from a phone that shared its location has no postal code, and it
     * has a better answer than one. Writing a made-up code to keep the column
     * NOT NULL would put fiction on a real order and quietly corrupt every
     * report that groups by FSA.
     *
     * `order_is_locatable` below is what replaces the NOT NULL: an order still
     * cannot exist without SOME way of finding the door.
     */
    postalCode: text('postal_code'),
    fsa: text('fsa'),

    /**
     * ⭐ THE STREET ADDRESS. Until migration 0006 this table stored a postal
     * code and an FSA and nothing else, and you cannot deliver to a forward
     * sortation area.
     *
     * Snapshotted onto the order rather than read from the customer, for the
     * same reason the line prices are snapshotted: the customer will move, and
     * an order delivered last month must still say where it went.
     */
    addressLine1: text('address_line1').notNull(),
    addressLine2: text('address_line2'),
    city: text('city').notNull(),
    province: text('province').notNull(),
    /** "Buzz 302, side door." Free text, shown to whoever carries the box. */
    deliveryNotes: text('delivery_notes'),

    /**
     * ⭐ WHERE THE DOOR IS. Populated whenever the customer's device shared a
     * location, which is the primary address mechanism now rather than the
     * eventual one: serviceability resolves a coordinate against a zone
     * CIRCLE, and the delivery partner's route link is built from this pair.
     *
     * Still NULL for an order placed by someone who declined the permission
     * and typed a postal code instead. Both paths are supported.
     *
     * `numeric`, not `real`: these are coordinates, and the float that is fine
     * for a map pin is not fine for a value that gets compared for equality
     * in a test. The money rule generalises.
     */
    lat: numeric('lat', { precision: 9, scale: 6 }),
    lng: numeric('lng', { precision: 9, scale: 6 }),

    /**
     * ⭐ The credential for `/orders/[token]`.
     *
     * Tracking has no login: the unguessable link IS the authorisation. That
     * is not a prototype shortcut, it is the right long-term shape — it works
     * for a customer with no account, on a borrowed phone, from a link in an
     * email, and it is what every delivery company does.
     *
     * A v4 UUID is 122 bits of randomness, which is not guessable. It is
     * generated by the DEFAULT so that no code path can create an order
     * without one.
     */
    publicToken: text('public_token')
      .notNull()
      .unique()
      .default(sql`gen_random_uuid()::text`),

    slotId: uuid('slot_id')
      .notNull()
      .references(() => slot.id, { onDelete: 'restrict' }),

    /** Which trading day's stock this order consumed. */
    businessDayId: uuid('business_day_id')
      .notNull()
      .references(() => businessDay.id, { onDelete: 'restrict' }),

    payMode: payModeEnum('pay_mode').notNull(),
    status: orderStatusEnum('status').notNull().default('PLACED'),

    /** Line estimates only — the fee is its own column, never folded in. */
    estLineTotalCents: integer('est_line_total_cents').notNull(),
    deliveryFeeCents: integer('delivery_fee_cents').notNull(),
    estTotalCents: integer('est_total_cents').notNull(),

    /** inv-O5 — present exactly when weighing is done. */
    finalTotalCents: integer('final_total_cents'),

    /**
     * The catalog version this order's prices came from, so a dispute about
     * what was charged can be answered from the order alone.
     */
    catalogVersion: integer('catalog_version').notNull(),

    /**
     * Denormalised copies of the hot-food facts at placement time.
     *
     * inv-O3 spans order_line → product → slot and cannot be a CHECK in that
     * form. Recording both sides on the order lets the CHECK below express it
     * anyway, and lets the nightly consistency query (DTM §15.3) find a
     * violation without joining three tables per order.
     */
    slotHotEligible: boolean('slot_hot_eligible').notNull(),
    hasHotLine: boolean('has_hot_line').notNull(),

    /**
     * ⭐ WHO IS CARRYING IT — a live reference AND a snapshot, both.
     *
     * `on delete set null` plus the snapshot, never `restrict`. The FK is for
     * joining today's roster; the two `partner_*` columns are the historical
     * record. With `restrict` the owner could never remove somebody who did
     * one delivery in March, and they will ask why. With only the FK, removing
     * them erases who delivered it.
     *
     * Same reasoning as `order_line.product_name`: the roster will change and
     * a delivered order must still say who took it.
     */
    deliveryPartnerId: uuid('delivery_partner_id').references(() => deliveryPartner.id, {
      onDelete: 'set null',
    }),
    partnerName: text('partner_name'),
    partnerPhone: text('partner_phone'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),

    /**
     * When the dispatch message was actually sent.
     *
     * ⚠ CLEARED BY A REASSIGNMENT. The new partner has not been told, and
     * an order that still looks dispatched is one nobody sends a second
     * message about.
     */
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),

    /**
     * ⭐ WHAT THE DRIVER SAYS THEY TOOK AT THE DOOR. Cash orders only.
     *
     * Spec §5.8 — an order closes when it is prepaid, or the rider collected
     * EXACTLY the final amount. `canDeliver` has taken this argument since it
     * was written; nothing passed it anything until COD became real, because
     * every order was PREPAID.
     *
     * ⚠ IT IS A REPORT, NOT A RECEIPT. It records what the person carrying the
     * box said, which is the only figure anybody has. A mismatch against
     * `final_total_cents` is therefore a fact to surface to the shop, not a
     * contradiction to resolve in code.
     */
    cashCollectedCents: integer('cash_collected_cents'),
    cashReportedAt: timestamp('cash_reported_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [
    /** Money is a non-negative integer of cents. Never a float, nowhere. */
    check('order_cash_nonneg', sql`${t.cashCollectedCents} IS NULL OR ${t.cashCollectedCents} >= 0`),

    /**
     * Cash is only ever reported against a cash order. A prepaid order
     * carrying a collected amount means two rails took money for one basket.
     */
    check('order_cash_only_on_cod', sql`${t.cashCollectedCents} IS NULL OR ${t.payMode} = 'COD'`),

    /** The two cash columns move together — "how much" always has a "when". */
    check(
      'order_cash_coherent',
      sql`(${t.cashCollectedCents} IS NULL) = (${t.cashReportedAt} IS NULL)`,
    ),

    /**
     * ⭐ A CASH ORDER CANNOT REACH DELIVERED WITHOUT THE EXACT MONEY AGAINST
     * IT. Spec §5.8, expressed where a future route handler cannot forget it.
     *
     * The same reasoning as `reserved_g <= stocked_g`: if the application has
     * a bug the right outcome is a failed transaction, not a cash order
     * silently closed with nothing recorded. Unlike overselling, this loss is
     * not recoverable by cutting another piece of fish.
     */
    check(
      'order_cod_settled_on_delivery',
      sql`${t.status} <> 'DELIVERED' OR ${t.payMode} <> 'COD'
          OR (${t.cashCollectedCents} IS NOT NULL
              AND ${t.cashCollectedCents} = ${t.finalTotalCents})`,
    ),

    /**
     * ⭐ inv-O5 — a final total exists exactly when weighing is done, and not
     * before. Written as an equality between two booleans so it cannot be
     * satisfied by accident in either direction.
     */
    check(
      'order_final_total_iff_weighed',
      sql`(${t.finalTotalCents} IS NULL)
          = (${t.status} IN ('PLACED', 'PREPARING', 'CANCELLED'))`,
    ),

    /**
     * ⭐ AN ORDER MUST BE LOCATABLE. This is what took over from
     * `postal_code NOT NULL`, and it is the stronger statement: the old
     * constraint was satisfied by any six characters, this one insists on
     * either a real coordinate pair or a postal code.
     *
     * The coordinate half also refuses a lone latitude, which is the shape a
     * half-finished write produces.
     */
    check(
      'order_is_locatable',
      sql`(${t.lat} IS NOT NULL AND ${t.lng} IS NOT NULL) OR ${t.postalCode} IS NOT NULL`,
    ),

    /** inv-O3, in the one form a CHECK can express it. */
    check('order_hot_line_needs_hot_slot', sql`NOT ${t.hasHotLine} OR ${t.slotHotEligible}`),

    check(
      'order_money_non_negative',
      sql`${t.estLineTotalCents} >= 0 AND ${t.deliveryFeeCents} >= 0
          AND ${t.estTotalCents} >= 0
          AND (${t.finalTotalCents} IS NULL OR ${t.finalTotalCents} >= 0)`,
    ),

    /** The estimate is its parts. A total that is not its own sum is a bug. */
    check(
      'order_est_total_is_sum',
      sql`${t.estTotalCents} = ${t.estLineTotalCents} + ${t.deliveryFeeCents}`,
    ),

    /**
     * An assignment is its SNAPSHOT: a time, a name and a number, all three or
     * none of them.
     *
     * ⚠ `delivery_partner_id` IS DELIBERATELY NOT IN THIS CHECK, AND IT WAS,
     * AND THAT WAS A DEFECT. Measured against the live database on
     * 2026-08-16, not reasoned about:
     *
     *     delete from delivery_partner where id = '…';
     *     ERROR 23514: new row for relation "order" violates check
     *                  constraint "order_assignment_coherent"
     *
     * The FK is `on delete set null`. When a partner is deleted, Postgres
     * performs that UPDATE — and the referential action is itself subject to
     * CHECK constraints. So nulling the FK while the snapshot remained broke a
     * check that required them to move together, and the delete failed.
     *
     * ⭐ THE EFFECT WAS THAT `on delete set null` BEHAVED EXACTLY LIKE
     * `on delete restrict` — the one outcome `07-PLAN` §3.1 explicitly set out
     * to avoid, in its own words: "the owner cannot ever remove a partner who
     * did one delivery in March, and they will ask why". The plan asked for
     * both and the two cannot both be true. The plan is the bug (`CLAUDE.md`
     * §5).
     *
     * What is actually worth enforcing is the SNAPSHOT's coherence, because
     * the snapshot is the historical record — a delivered order must still say
     * who took it. The FK is a convenience join onto a roster that will change,
     * and a null there means only "that person is no longer on the roster".
     */
    check(
      'order_assignment_coherent',
      sql`(${t.assignedAt} IS NULL AND ${t.partnerName} IS NULL AND ${t.partnerPhone} IS NULL)
          OR (${t.assignedAt} IS NOT NULL AND ${t.partnerName} IS NOT NULL
              AND ${t.partnerPhone} IS NOT NULL)`,
    ),

    /** You cannot tell somebody about a job before you have given it to them. */
    check(
      'order_dispatch_after_assign',
      sql`${t.dispatchedAt} IS NULL OR ${t.assignedAt} IS NOT NULL`,
    ),
  ],
);

// ── order_line ───────────────────────────────────────────────────────────

/**
 * One line of an order, with the price SNAPSHOT it was placed at.
 *
 * The snapshot columns are not denormalisation for speed. The product's price
 * will change; the order's must not. Reading the rate back off `product` at
 * settlement would re-price a two-day-old order at today's rate, and charge
 * the customer something they never agreed to.
 */
export const orderLine = pgTable(
  'order_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => order.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),

    /**
     * FR-4 — the cut preference. Deliberately NOT a separate product, which is
     * exactly why one product legitimately appears on several lines of one
     * order, and why stock demand must be aggregated across them.
     */
    prepOptionId: uuid('prep_option_id').references(() => prepOption.id, {
      onDelete: 'set null',
    }),

    /** Name at time of order — receipts must not change when the catalog does. */
    productName: text('product_name').notNull(),
    pricingMode: pricingModeEnum('pricing_mode').notNull(),
    handling: handlingEnum('handling').notNull(),

    /** The snapshot. Exactly one of these is populated, per pricing mode. */
    ratePerKgCents: integer('rate_per_kg_cents'),
    packPriceCents: integer('pack_price_cents'),

    requestedG: integer('requested_g').notNull(),
    estAmountCents: integer('est_amount_cents').notNull(),

    /** Null until weighed. Pack lines are never weighed at all (inv-O6). */
    actWeightG: integer('act_weight_g'),
    actAmountCents: integer('act_amount_cents'),

    /**
     * Tax breakdown per line, not per order (DTM §10). One basket legitimately
     * mixes zero-rated raw meat and taxable hot food, so an order-level rate
     * cannot represent it. Stored as the breakdown rather than only the total,
     * because reconstructing it later from rates that have since changed is
     * miserable.
     */
    taxCode: text('tax_code').notNull(),
    taxRateBasisPoints: integer('tax_rate_basis_points'),
    taxCents: integer('tax_cents'),

    /** Set when a weight landed outside the tolerance band and was approved. */
    varianceApprovedAt: timestamp('variance_approved_at', { withTimezone: true }),
  },
  (t) => [
    /**
     * inv-O6 — a pack line's estimate IS its actual, and it is never
     * re-priced. Enforced rather than trusted, because the whole "two pricing
     * modes in one cart" design rests on it.
     */
    check(
      'order_line_pack_never_repriced',
      sql`${t.pricingMode} <> 'pack'
          OR (${t.actWeightG} IS NULL
              AND (${t.actAmountCents} IS NULL OR ${t.actAmountCents} = ${t.estAmountCents}))`,
    ),

    /** The snapshot matches the mode. */
    check(
      'order_line_snapshot_matches_mode',
      sql`(${t.pricingMode} = 'pack' AND ${t.packPriceCents} IS NOT NULL AND ${t.ratePerKgCents} IS NULL)
          OR (${t.pricingMode} = 'perKg' AND ${t.ratePerKgCents} IS NOT NULL AND ${t.packPriceCents} IS NULL)`,
    ),

    check(
      'order_line_money_non_negative',
      sql`${t.requestedG} >= 0 AND ${t.estAmountCents} >= 0
          AND (${t.actWeightG} IS NULL OR ${t.actWeightG} >= 0)
          AND (${t.actAmountCents} IS NULL OR ${t.actAmountCents} >= 0)`,
    ),
  ],
);

// ── checkout_attempt (DTM §8.2) ──────────────────────────────────────────

/**
 * ⭐ The idempotency boundary. It exists BEFORE any money is touched.
 *
 * Without it, a browser retry, a timeout or an impatient double-tap creates
 * two PaymentIntents and two holds on the customer's card for one purchase.
 * The sweeper would clear the extra within fifteen minutes, but the customer
 * sees two pending charges on their banking app meanwhile — for a shop whose
 * entire pitch is "we only ever charge you the exact amount", that is the
 * worst available way to be wrong.
 */
export const checkoutAttempt = pgTable(
  'checkout_attempt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),

    /**
     * `hash(lines, slot, postal)`. A CHANGED CART IS A NEW ATTEMPT — that is
     * what stops a stale hold being reused for a different basket.
     */
    cartHash: text('cart_hash').notNull(),

    /** The catalog version the quote was computed against. P8 compares this. */
    quoteVersion: integer('quote_version').notNull(),
    quotedEstCents: integer('quoted_est_cents').notNull(),
    authorisedCeilingCents: integer('authorised_ceiling_cents').notNull(),

    paymentIntentId: text('payment_intent_id').unique(),

    /**
     * Written BEFORE the Stripe call, not after.
     *
     * The hard crash case is between "PaymentIntent created" and "its ID
     * stored": the retry has no ID to reuse and would create a second hold.
     * Storing the derived idempotency key first means the retry re-derives it
     * and Stripe returns the ORIGINAL intent instead of making a new one.
     */
    stripeIdempotencyKey: text('stripe_idempotency_key'),

    orderId: uuid('order_id').unique(),

    status: checkoutAttemptStatusEnum('status').notNull().default('OPEN'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * ⭐ ONE LIVE ATTEMPT PER CUSTOMER PER IDENTICAL CART.
     *
     * This partial unique index IS the anti-double-hold rule, and it is what
     * makes "create or reuse" atomic: a concurrent second submit loses the
     * insert and reads the existing row, rather than both submits deciding
     * they are the first.
     */
    uniqueIndex('checkout_attempt_one_live')
      .on(t.customerId, t.cartHash)
      .where(sql`${t.status} IN ('OPEN', 'AUTHORISED')`),

    /** A consumed attempt produced exactly one order. */
    check(
      'checkout_attempt_consumed_has_order',
      sql`${t.status} <> 'CONSUMED' OR ${t.orderId} IS NOT NULL`,
    ),
  ],
);

// ── payment ──────────────────────────────────────────────────────────────

export const payment = pgTable(
  'payment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => order.id, { onDelete: 'restrict' })
      .unique(),

    /**
     * ⭐ WHICH ADAPTER MADE THIS ROW. `stub` | `clover` | …
     *
     * The default used to be `'stripe'`, which is now wrong twice over: the
     * processor changed, and prototype orders are placed by a stub adapter
     * that moves no money. Those orders are deliberately `pay_mode = PREPAID`
     * — that is what routes them down the authorise-then-capture path this
     * prototype exists to exercise — so the pay mode CANNOT distinguish a test
     * order from a real one, by design.
     *
     * ⚠ THIS COLUMN IS THEREFORE THE ONLY DISCRIMINATOR. Anything that ever
     * reads takings, reconciles against the processor, or reports revenue must
     * filter on `provider <> 'stub'`. Nothing reads those yet; the first thing
     * that does inherits this obligation.
     *
     * No default: the caller states which processor it is. A defaulted value
     * here is a row that lies about its own origin.
     */
    provider: text('provider').notNull(),
    paymentIntentId: text('payment_intent_id').unique(),

    status: paymentStatusEnum('status').notNull(),

    /** The ceiling held on the card: `estTotal × (1 + tolerance)`. */
    authorisedCents: integer('authorised_cents').notNull(),
    /** The exact amount actually taken. Null until the single capture fires. */
    capturedCents: integer('captured_cents'),

    /**
     * The capture idempotency key, which MUST change when the amount changes.
     * Stripe replays the original response for a reused key, so a key that
     * ignored the amount would quietly capture the old number.
     */
    captureIdempotencyKey: text('capture_idempotency_key'),

    authorisedAt: timestamp('authorised_at', { withTimezone: true }),
    capturedAt: timestamp('captured_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * You get exactly ONE capture per authorisation, and it can never exceed
     * the hold. `cappedTotal` is what guarantees that upstream; this refuses
     * to record it if the guarantee ever fails.
     */
    check(
      'payment_capture_within_authorisation',
      sql`${t.capturedCents} IS NULL
          OR (${t.capturedCents} >= 0 AND ${t.capturedCents} <= ${t.authorisedCents})`,
    ),
    check('payment_authorised_positive', sql`${t.authorisedCents} > 0`),
  ],
);

// ── stripe_event (DTM §8.4) ──────────────────────────────────────────────

/**
 * Webhook deduplication. Stripe retries, and a duplicate capture is a
 * real-money bug — but a DROPPED event is one too.
 *
 * The rule that makes both safe: the insert, every local effect, every
 * enqueued follow-up and the `processed_at` stamp happen in ONE transaction.
 * The naive version — insert the ID, return 200 if it conflicts — loses
 * events: if the insert commits and the process dies before the state change,
 * Stripe's retry finds the ID present and discards it, permanently and
 * silently.
 */
export const stripeEvent = pgTable('stripe_event', {
  /** Stripe's own event id, `evt_…`. */
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  /** NULL ⇒ not yet done ⇒ retryable. This nullability is the whole design. */
  processedAt: timestamp('processed_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
});

// ── staff (DTM §9 / D5) ──────────────────────────────────────────────────

export const staffRoleEnum = pgEnum('staff_role', ['OWNER', 'STAFF']);

/**
 * Who may operate the console. Small, deliberately: one shop, one or two
 * people, and every extra field here is another thing to keep correct.
 *
 * ⚠ `active` is re-read from THIS TABLE on every admin mutation, never taken
 * from the session cookie. A cookie says what was true when it was signed;
 * revoking access has to take effect now, not in twelve hours.
 */
export const staff = pgTable(
  'staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Lowercased before storage, so `Owner` and `owner` cannot be two people. */
    username: text('username').notNull().unique(),

    /**
     * `scrypt`, as `N$r$p$salt$hash` — see `src/auth/password.ts`.
     *
     * The parameters live INSIDE the string rather than in a constant, so a
     * future increase in cost does not invalidate every existing hash: an old
     * hash still carries the parameters it was made with and still verifies.
     */
    passwordHash: text('password_hash').notNull(),

    role: staffRoleEnum('role').notNull().default('STAFF'),
    active: boolean('active').notNull().default(true),

    /**
     * Lockout without Redis. `failed_attempts` counts consecutive failures and
     * resets to zero on success; `locked_until` is set once it crosses the
     * threshold.
     *
     * Both are on the row rather than in memory because the process restarts
     * on every deploy, and a lockout that a redeploy clears is not a lockout.
     */
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),

    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('staff_failed_attempts_non_negative', sql`${t.failedAttempts} >= 0`)],
);

// ── audit_log (NFR-9) ────────────────────────────────────────────────────

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
});

// ── notification_outbox (DTM §11.2) ──────────────────────────────────────

/**
 * The outbox. A row is written in the SAME transaction as the state change
 * that justifies it; a scheduled job drains it.
 *
 * Why not just send the email inline: an email send inside a database
 * transaction couples the transaction's duration to a third party's
 * availability, and a send that succeeds followed by a rollback tells the
 * customer about an order that does not exist. The outbox gives retries, an
 * audit of what was actually sent, and no half-committed states when the
 * provider has a bad afternoon.
 *
 * ⚠ CHANNEL-AGNOSTIC ON PURPOSE. SMS is cut at launch (D18) — Canadian A2P
 * registration is weeks of carrier paperwork and was the likeliest cause of a
 * launch delay. Email covers every notification in FR-24. Keeping `channel` as
 * a column rather than assuming email means adding SMS later is a new adapter,
 * not a redesign. That is the one piece of forward-compatibility worth paying
 * for here, and it is nearly free.
 */
export const notificationChannelEnum = pgEnum('notification_channel', ['EMAIL', 'SMS']);

export const notificationStatusEnum = pgEnum('notification_status', [
  'PENDING',
  'SENT',
  'FAILED',
  'ABANDONED',
]);

export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    channel: notificationChannelEnum('channel').notNull(),
    /** `order.accepted`, `order.weighed`, … — the template to render. */
    kind: text('kind').notNull(),

    /** Who it goes to, resolved at enqueue time. */
    recipient: text('recipient').notNull(),

    /** Everything the template needs, so draining never re-reads the order. */
    payload: jsonb('payload').notNull(),

    orderId: uuid('order_id').references(() => order.id, { onDelete: 'cascade' }),

    status: notificationStatusEnum('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),

    /**
     * Exponential backoff lives here rather than in the scheduler, so a job
     * that crashes does not lose the schedule with it.
     */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),

    /**
     * De-duplication key. A webhook that is delivered twice must not send the
     * customer two emails, and the webhook handler is idempotent only if what
     * it enqueues is too.
     */
    dedupeKey: text('dedupe_key').unique(),
  },
  (t) => [
    check('outbox_sent_at_iff_sent', sql`(${t.status} = 'SENT') = (${t.sentAt} IS NOT NULL)`),
  ],
);
