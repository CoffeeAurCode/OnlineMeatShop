import 'server-only';

import { and, asc, desc, eq, gt, gte, sql } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';
import {
  catalogVersion,
  category,
  order,
  payment,
  product,
  serviceableFsa,
  slot,
  zone,
} from '@/db/schema';

/**
 * The writes that used to require a script, a SQL client or a deploy.
 *
 * `07-PLAN` Part 6. The goal is stated there and is not a slogan: every
 * operational decision available on the phone, with nothing needing a
 * developer. Until this file existed, creating a delivery window meant running
 * `seed-fulfilment.mjs`, and adding a fish on a Tuesday meant a deploy.
 *
 * ══ THE RULE THAT GOVERNS EVERY FUNCTION HERE ═════════════════════════════
 *
 * ⚠ CANONICAL LOCK ORDER, INCLUDING FOR THE ONES THAT FEEL LIKE CONFIGURATION:
 *
 *     slot (FOR UPDATE) → product (FOR SHARE, id asc) → stock_item (FOR UPDATE)
 *
 * A slot editor that locks `slot` after `stock_item` deadlocks against
 * checkout roughly half the time, under exactly the load that makes it hard to
 * reproduce — which is to say, when the shop is busy. Every function below
 * either touches ONE of those tables or takes them in this order. None of them
 * takes a lock it does not need.
 *
 * ⭐ THE CATALOG WRITES BUMP `catalog_version`, AND THAT IS LOAD-BEARING.
 * P8 compares the version a quote was made against with the version at
 * placement, and returns `priceChanged` when they differ. Editing a price
 * without bumping it means a customer who loaded the page before the change
 * is charged the new price silently — which is the exact failure P8 exists to
 * prevent.
 */

// ── Delivery windows (07-PLAN §6.1 — the urgent one) ─────────────────────

export interface SlotRow {
  readonly id: string;
  readonly serviceDate: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly cutoffAt: Date;
  readonly capacity: number;
  readonly bookedCount: number;
  readonly hotEligible: boolean;
  readonly active: boolean;
}

/** Every window from a date onwards. The console's slot screen. */
export async function listSlots(fromDate: string, tx: Tx | typeof db = db): Promise<readonly SlotRow[]> {
  return tx
    .select({
      id: slot.id,
      serviceDate: slot.serviceDate,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      cutoffAt: slot.cutoffAt,
      capacity: slot.capacity,
      bookedCount: slot.bookedCount,
      hotEligible: slot.hotEligible,
      active: slot.active,
    })
    .from(slot)
    .where(gte(slot.serviceDate, fromDate))
    .orderBy(asc(slot.startsAt));
}

/**
 * How many calendar days of usable windows remain, INCLUDING today.
 *
 * ⭐ THE SILENT OUTAGE THIS EXISTS TO PREVENT. Nothing generates slots. When
 * the last seeded one passes its cutoff, checkout offers no window and the
 * storefront looks broken while being technically correct — and nothing
 * anywhere raises its voice. The console shows this number so the failure has
 * a countdown instead of a surprise.
 */
export async function slotRunwayDays(
  todayIso: string,
  now: Date = new Date(),
  tx: Tx | typeof db = db,
): Promise<number> {
  const rows = await tx
    .select({ serviceDate: slot.serviceDate })
    .from(slot)
    .where(
      and(eq(slot.active, true), gte(slot.serviceDate, todayIso), gt(slot.cutoffAt, now)),
    )
    .orderBy(desc(slot.serviceDate))
    .limit(1);

  const last = rows[0]?.serviceDate;
  if (last === undefined) return 0;

  const ms = Date.parse(`${last}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export interface NewSlot {
  readonly serviceDate: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly cutoffAt: Date;
  readonly capacity: number;
  readonly hotEligible: boolean;
}

/**
 * Create windows.
 *
 * Takes an array because the owner creates a DAY of them, not one — four taps
 * to make Tuesday is four chances to typo a cutoff. One transaction so a day
 * is created whole or not at all.
 */
export async function createSlots(slots: readonly NewSlot[]): Promise<number> {
  if (slots.length === 0) return 0;

  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(slot)
      .values(
        slots.map((s) => ({
          serviceDate: s.serviceDate,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          cutoffAt: s.cutoffAt,
          capacity: s.capacity,
          hotEligible: s.hotEligible,
        })),
      )
      .returning({ id: slot.id });

    return rows.length;
  });
}

/**
 * Change a window.
 *
 * ⚠ `FOR UPDATE` ON THE SLOT ROW, FIRST AND ALONE. This is the write that
 * races checkout: placement locks the slot first and then counts a booking
 * against `capacity`. Lowering capacity without the lock can drop it below
 * `booked_count` while a placement is in flight, and the CHECK constraint
 * turns that into a failed CUSTOMER checkout rather than a failed admin edit.
 *
 * The explicit refusal below is what turns it into the second thing.
 */
export async function updateSlot(
  id: string,
  patch: {
    capacity?: number | undefined;
    hotEligible?: boolean | undefined;
    active?: boolean | undefined;
    cutoffAt?: Date | undefined;
  },
): Promise<{ ok: true } | { ok: false; reason: 'notFound' | 'belowBooked' }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ bookedCount: slot.bookedCount })
      .from(slot)
      .where(eq(slot.id, id))
      .for('update');

    const current = rows[0];
    if (current === undefined) return { ok: false as const, reason: 'notFound' as const };

    if (patch.capacity !== undefined && patch.capacity < current.bookedCount) {
      return { ok: false as const, reason: 'belowBooked' as const };
    }

    await tx.update(slot).set(patch).where(eq(slot.id, id));
    return { ok: true as const };
  });
}

// ── The delivery area (07-PLAN §6.1) ─────────────────────────────────────

export interface ZoneRow {
  readonly id: string;
  readonly name: string;
  readonly feeCents: number;
  readonly freeAboveCents: number | null;
  readonly centreLat: number | null;
  readonly centreLng: number | null;
  readonly radiusM: number | null;
  readonly fsaCount: number;
}

export async function listZones(tx: Tx | typeof db = db): Promise<readonly ZoneRow[]> {
  const rows = await tx
    .select({
      id: zone.id,
      name: zone.name,
      feeCents: zone.feeCents,
      freeAboveCents: zone.freeAboveCents,
      centreLat: zone.centreLat,
      centreLng: zone.centreLng,
      radiusM: zone.radiusM,
      fsaCount: sql<number>`(select count(*)::int from serviceable_fsa f where f.zone_id = ${zone.id})`,
    })
    .from(zone)
    .orderBy(asc(zone.name));

  return rows.map((r) => ({
    ...r,
    centreLat: r.centreLat === null ? null : Number(r.centreLat),
    centreLng: r.centreLng === null ? null : Number(r.centreLng),
  }));
}

/**
 * Set the fee, the free-delivery threshold and the circle.
 *
 * ⚠ THE CIRCLE IS ALL THREE COLUMNS OR NONE — `zone_circle_whole` is a CHECK
 * and refuses a half-written one. So the caller passes a circle or a null, and
 * this never writes a lone latitude.
 *
 * ⚠ NARROWING THE CIRCLE DOES NOT NARROW THE POSTAL PATH. `serviceable_fsa`
 * currently holds every FSA Canada Post issues, all pointing here, so a
 * customer who declines the location permission is still served in Vancouver
 * however small this radius is. `clearServiceableFsas` is the other half and
 * the two must be done in the same sitting (`CODEBASE-CONTEXT.md` §1.5).
 */
export async function updateZone(
  id: string,
  patch: {
    feeCents?: number | undefined;
    freeAboveCents?: number | null | undefined;
    circle?: { lat: number; lng: number; radiusM: number } | null | undefined;
  },
): Promise<boolean> {
  const set: Record<string, unknown> = {};
  if (patch.feeCents !== undefined) set.feeCents = patch.feeCents;
  if (patch.freeAboveCents !== undefined) set.freeAboveCents = patch.freeAboveCents;
  if (patch.circle !== undefined) {
    if (patch.circle === null) {
      set.centreLat = null;
      set.centreLng = null;
      set.radiusM = null;
    } else {
      set.centreLat = String(patch.circle.lat);
      set.centreLng = String(patch.circle.lng);
      set.radiusM = patch.circle.radiusM;
    }
  }
  if (Object.keys(set).length === 0) return true;

  const rows = await db.update(zone).set(set).where(eq(zone.id, id)).returning({ id: zone.id });
  return rows[0] !== undefined;
}

/**
 * Delete the FSA scaffolding for a zone.
 *
 * The 4680 rows are testing data (`CODEBASE-CONTEXT.md` §1.5) and the plan for
 * them was always a `DELETE`, not curation. Exposed in the console because
 * otherwise narrowing the delivery area needs a SQL client — and half a
 * narrowing is worse than none.
 */
export async function clearServiceableFsas(zoneId: string): Promise<number> {
  const rows = await db
    .delete(serviceableFsa)
    .where(eq(serviceableFsa.zoneId, zoneId))
    .returning({ fsa: serviceableFsa.fsa });
  return rows.length;
}

// ── Catalog (07-PLAN §6.1) ───────────────────────────────────────────────

/**
 * Bump the catalog version. Called by every catalog write, in its transaction.
 *
 * ⭐ SEE THE FILE HEADER. Not bumping is not a missing nicety — it is a
 * customer being charged a price they never saw, silently, because P8 had
 * nothing to compare.
 */
async function bumpCatalogVersion(tx: Tx): Promise<void> {
  await tx
    .update(catalogVersion)
    .set({ version: sql`${catalogVersion.version} + 1`, updatedAt: new Date() })
    .where(eq(catalogVersion.id, 1));
}

/**
 * ⚠ EVERY FIELD IS `| undefined` EXPLICITLY, because `tsconfig` sets
 * `exactOptionalPropertyTypes`. Under that flag `name?: string` means "absent,
 * or a string" and REFUSES an explicit `undefined` — which is exactly what a
 * spread of an optional Zod field produces. Omitting it here turns every one
 * of these routes into a type error at the call site, and the error text
 * blames the caller rather than this declaration.
 */
export interface ProductPatch {
  readonly name?: string | undefined;
  readonly nameFr?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly descriptionFr?: string | null | undefined;
  readonly categoryId?: string | null | undefined;
  readonly active?: boolean | undefined;
  readonly packPriceCents?: number | null | undefined;
  readonly wMinG?: number | null | undefined;
  readonly wMaxG?: number | null | undefined;
  readonly ratePerKgCents?: number | null | undefined;
  readonly minOrderG?: number | null | undefined;
  readonly stepG?: number | null | undefined;
}

/**
 * Edit a product.
 *
 * ⚠ `pricing_mode` AND `handling` ARE NOT EDITABLE HERE, ON PURPOSE.
 *
 * Changing a pack into a per-kg item changes which of six columns must be NULL
 * (inv-C1/C2 are CHECK constraints) and changes what every existing order line
 * referencing it means. Changing `handling` can turn a product hot, which
 * silently changes which delivery slots the WHOLE order may use — a
 * food-safety rule, retroactively, on orders already placed.
 *
 * Both are "deactivate this and create a new one" operations. A console that
 * offers them as a dropdown makes a five-second tap out of a decision that
 * deserves thought.
 */
export async function updateProduct(id: string, patch: ProductPatch): Promise<boolean> {
  return db.transaction(async (tx) => {
    /*
     * ⚠ `FOR UPDATE` on `product`, and NOTHING ELSE IN THIS TRANSACTION.
     * Placement takes `product` FOR SHARE after the slot; a lone FOR UPDATE
     * here can block a placement briefly but cannot deadlock it, because this
     * transaction never goes on to want a slot or a stock row.
     */
    const rows = await tx
      .select({ id: product.id })
      .from(product)
      .where(eq(product.id, id))
      .for('update');

    if (rows[0] === undefined) return false;

    await tx
      .update(product)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(product.id, id));

    await bumpCatalogVersion(tx);
    return true;
  });
}

// ── Today's takings (07-PLAN §6.1) ───────────────────────────────────────

export interface Takings {
  /** Orders for which money actually moved: captured card or reported cash. */
  readonly orders: number;
  readonly totalCents: number;
  /** Orders excluded because they were paid through the stub adapter. */
  readonly excludedTestOrders: number;
  /** Live orders for which no capture or cash collection has been recorded. */
  readonly unsettledOrders: number;
}

/**
 * What the shop actually took, from processor captures and reported cash.
 *
 * ⚠ FILTERS ON `payment.provider <> 'stub'`, AND THIS IS THE WHOLE POINT.
 *
 * Prototype orders are `pay_mode = PREPAID` deliberately — `COD` would skip
 * authorisation and settlement entirely, so the lifecycle worth testing would
 * never run. The consequence is that NOTHING IN THE ORDER DISTINGUISHES A TEST
 * ORDER FROM A REAL ONE except which adapter took the money.
 *
 * This is the first thing in the codebase to read takings, so it is the first
 * thing to inherit that obligation (`CLAUDE.md` §7). The excluded count is
 * returned rather than hidden, so a screen reading $0 on a day with six test
 * orders says why.
 */
export async function takingsForDay(businessDayId: string): Promise<Takings> {
  const rows = await db
    .select({
      provider: payment.provider,
      capturedCents: payment.capturedCents,
      payMode: order.payMode,
      cashCollectedCents: order.cashCollectedCents,
      status: order.status,
    })
    .from(order)
    .leftJoin(payment, eq(payment.orderId, order.id))
    .where(eq(order.businessDayId, businessDayId));

  let orders = 0;
  let total = 0;
  let excluded = 0;
  let unsettled = 0;

  for (const r of rows) {
    if (r.payMode === 'COD') {
      if (r.cashCollectedCents !== null) {
        orders += 1;
        total += r.cashCollectedCents;
      } else if (r.status !== 'CANCELLED') {
        unsettled += 1;
      }
      continue;
    }

    if (r.provider === 'stub') {
      excluded += 1;
      continue;
    }

    if (r.capturedCents !== null) {
      orders += 1;
      total += r.capturedCents;
    } else if (r.status !== 'CANCELLED') {
      unsettled += 1;
    }
  }

  return {
    orders,
    totalCents: total,
    excludedTestOrders: excluded,
    unsettledOrders: unsettled,
  };
}

// ── The catalog, as the owner sees it ────────────────────────────────────

export interface AdminProduct {
  readonly id: string;
  readonly name: string;
  readonly nameFr: string | null;
  readonly slug: string;
  readonly active: boolean;
  readonly handling: 'RAW' | 'MARINATED' | 'COOKED_CHILLED' | 'COOKED_HOT';
  readonly pricingMode: 'pack' | 'perKg';
  readonly packPriceCents: number | null;
  readonly ratePerKgCents: number | null;
  readonly minOrderG: number | null;
  readonly stepG: number | null;
  readonly wMinG: number | null;
  readonly wMaxG: number | null;
  readonly categoryName: string | null;
}

/**
 * Every product, active or not, for the console's catalog screen.
 *
 * ⚠ SEPARATE FROM `listCatalog`, WHICH IS THE STOREFRONT'S. That one takes a
 * business day and joins today's stock, because a shopper is asking "can I buy
 * this now". This one asks "what does the shop sell", which is a different
 * question with a different answer on a day that is not open — and joining
 * stock here would make an inactive product on a closed day indistinguishable
 * from one that sold out.
 */
export async function listProductsForAdmin(
  tx: Tx | typeof db = db,
): Promise<readonly AdminProduct[]> {
  const rows = await tx
    .select({
      id: product.id,
      name: product.name,
      nameFr: product.nameFr,
      slug: product.slug,
      active: product.active,
      handling: product.handling,
      pricingMode: product.pricingMode,
      packPriceCents: product.packPriceCents,
      ratePerKgCents: product.ratePerKgCents,
      minOrderG: product.minOrderG,
      stepG: product.stepG,
      wMinG: product.wMinG,
      wMaxG: product.wMaxG,
      categoryName: category.nameEn,
    })
    .from(product)
    .leftJoin(category, eq(category.id, product.categoryId))
    .orderBy(asc(category.nameEn), asc(product.name));

  return rows;
}
