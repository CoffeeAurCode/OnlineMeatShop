import 'server-only';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';
import { catalogVersion, category, prepOption, product, stockItem } from '@/db/schema';
import { available } from '@/domain/availability';
import { cents, grams, type Grams, type Handling, type Pricing } from '@/domain/types';
import type { Locale } from '@/ui/format';

/**
 * Catalog reads. Server Components call these directly — `04-PLAN` §0 forbids
 * fetching catalog or availability data from the client, because a storefront
 * that assembles itself in the browser is invisible to a crawler, and organic
 * local search is the entire reason this app is server-rendered.
 *
 * Availability is part of the same read rather than a second round trip: the
 * price and today's quantity have to land in the same HTML, or the page
 * renders a product as buyable that sold out an hour ago.
 */

export interface CatalogItem {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  /**
   * French copy, nullable. `localisedName` below falls back to the English
   * column rather than rendering a blank, because a product with no French
   * name must still be sellable: the alternative is that adding a fish in a
   * hurry at 6am takes it off sale in half the shop's market.
   */
  readonly nameFr: string | null;
  readonly descriptionFr: string | null;
  readonly imagePath: string | null;
  readonly categoryId: string | null;
  readonly handling: Handling;
  readonly pricing: Pricing;
  readonly taxCode: string;
  readonly active: boolean;
  /**
   * `null` means "not declared today", which is NOT the same as sold out.
   *
   * A product with no `stock_item` row was never put on the counter this
   * morning; a product with `stocked_g` fully reserved was and has gone. The
   * storefront words those differently and the owner needs to tell them apart,
   * so the distinction survives all the way out of the query.
   */
  readonly availableG: Grams | null;
  readonly stockedG: Grams | null;
}

export interface PrepChoice {
  readonly id: string;
  readonly label: string;
}

export interface CategoryView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly blurb: string | null;
  readonly imagePath: string | null;
}

/**
 * Pick the copy for a locale, falling back to English.
 *
 * The fallback direction is deliberate and it is not symmetric: English is the
 * column that is `NOT NULL`, so it is the one that can always answer. A French
 * page showing an English fish name is a small blemish; a French page showing
 * a blank where a fish name should be is a broken page.
 */
function pick(locale: Locale, en: string, fr: string | null): string {
  return locale === 'fr' && fr !== null && fr !== '' ? fr : en;
}

export function localisedName(item: CatalogItem, locale: Locale): string {
  return pick(locale, item.name, item.nameFr);
}

export function localisedDescription(item: CatalogItem, locale: Locale): string | null {
  if (locale === 'fr' && item.descriptionFr !== null && item.descriptionFr !== '') {
    return item.descriptionFr;
  }
  return item.description;
}

type PricingColumns = {
  pricingMode: 'pack' | 'perKg';
  packPriceCents: number | null;
  wMinG: number | null;
  wMaxG: number | null;
  ratePerKgCents: number | null;
  minOrderG: number | null;
  stepG: number | null;
};

function toPricing(r: PricingColumns): Pricing {
  return r.pricingMode === 'pack'
    ? {
        mode: 'pack',
        price: cents(r.packPriceCents ?? 0),
        wMin: grams(r.wMinG ?? 0),
        wMax: grams(r.wMaxG ?? 0),
      }
    : {
        mode: 'perKg',
        ratePerKg: cents(r.ratePerKgCents ?? 0),
        minOrder: grams(r.minOrderG ?? 0),
        step: grams(r.stepG ?? 0),
      };
}

const PRODUCT_COLUMNS = {
  id: product.id,
  slug: product.slug,
  name: product.name,
  description: product.description,
  nameFr: product.nameFr,
  descriptionFr: product.descriptionFr,
  imagePath: product.imagePath,
  categoryId: product.categoryId,
  handling: product.handling,
  pricingMode: product.pricingMode,
  packPriceCents: product.packPriceCents,
  wMinG: product.wMinG,
  wMaxG: product.wMaxG,
  ratePerKgCents: product.ratePerKgCents,
  minOrderG: product.minOrderG,
  stepG: product.stepG,
  taxCode: product.taxCode,
  active: product.active,
} as const;

function toItem(
  r: PricingColumns & {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    nameFr: string | null;
    descriptionFr: string | null;
    imagePath: string | null;
    categoryId: string | null;
    handling: Handling;
    taxCode: string;
    active: boolean;
  },
  stock: { stockedG: number; reservedG: number } | null,
): CatalogItem {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    nameFr: r.nameFr,
    descriptionFr: r.descriptionFr,
    imagePath: r.imagePath,
    categoryId: r.categoryId,
    handling: r.handling,
    pricing: toPricing(r),
    taxCode: r.taxCode,
    active: r.active,
    stockedG: stock === null ? null : grams(stock.stockedG),
    availableG: stock === null ? null : available(grams(stock.stockedG), grams(stock.reservedG)),
  };
}

/**
 * The whole catalog, with today's availability when a day is open.
 *
 * `includeInactive` exists for the console's stock screen: the owner has to be
 * able to see a product they deactivated, or it vanishes from the one screen
 * where they could put it back.
 */
export async function listCatalog(
  businessDayId: string | null,
  opts: { readonly includeInactive?: boolean } = {},
  tx: Tx | typeof db = db,
): Promise<readonly CatalogItem[]> {
  // Two shapes rather than one clever query. Joining against a nullable day id
  // needs a predicate that is false for every row, and every way of spelling
  // that reads like a mistake to whoever meets it next.
  if (businessDayId === null) {
    const rows = await tx.select(PRODUCT_COLUMNS).from(product).orderBy(asc(product.name));
    return rows.filter((r) => opts.includeInactive === true || r.active).map((r) => toItem(r, null));
  }

  const rows = await tx
    .select({
      ...PRODUCT_COLUMNS,
      stockedG: stockItem.stockedG,
      reservedG: stockItem.reservedG,
    })
    .from(product)
    .leftJoin(
      stockItem,
      and(eq(stockItem.productId, product.id), eq(stockItem.businessDayId, businessDayId)),
    )
    .orderBy(asc(product.name));

  return rows
    .filter((r) => opts.includeInactive === true || r.active)
    .map(({ stockedG, reservedG, ...r }) =>
      toItem(r, stockedG === null || reservedG === null ? null : { stockedG, reservedG }),
    );
}

/** One product page. `null` when the slug does not exist or is deactivated. */
export async function productBySlug(
  slug: string,
  businessDayId: string | null,
  tx: Tx | typeof db = db,
): Promise<{ readonly item: CatalogItem; readonly preps: readonly PrepChoice[] } | null> {
  const rows = await tx
    .select({
      ...PRODUCT_COLUMNS,
      stockedG: stockItem.stockedG,
      reservedG: stockItem.reservedG,
    })
    .from(product)
    .leftJoin(
      stockItem,
      // No open day means no stock row can match. Spelled as a literal false
      // rather than as a comparison that happens never to hold, so nobody has
      // to work out whether it is deliberate.
      businessDayId === null
        ? sql`false`
        : and(eq(stockItem.productId, product.id), eq(stockItem.businessDayId, businessDayId)),
    )
    .where(eq(product.slug, slug))
    .limit(1);

  const r = rows[0];
  if (!r || !r.active) return null;

  const preps = await tx
    .select({ id: prepOption.id, label: prepOption.label })
    .from(prepOption)
    .where(and(eq(prepOption.productId, r.id), eq(prepOption.active, true)))
    .orderBy(asc(prepOption.sortOrder), asc(prepOption.label));

  const { stockedG, reservedG, ...rest } = r;
  return {
    item: toItem(rest, stockedG === null || reservedG === null ? null : { stockedG, reservedG }),
    preps,
  };
}

/** The version a quote is pinned to. Echoed back at checkout so P8 can fire. */
export async function currentCatalogVersion(tx: Tx | typeof db = db): Promise<number> {
  const rows = await tx.select({ version: catalogVersion.version }).from(catalogVersion).limit(1);
  return rows[0]?.version ?? 1;
}

/**
 * The merchandising axis, ordered as the owner arranged it.
 *
 * ⚠ Categories are NOT handling classes. `handling` is a food-safety property
 * that decides which delivery windows an order may use; this is how a shopper
 * is invited to browse. A category spans several handling classes on purpose,
 * which is why Lobster can hold a live one, a cooked one and a bisque.
 */
export async function listCategories(
  locale: Locale,
  tx: Tx | typeof db = db,
): Promise<readonly CategoryView[]> {
  const rows = await tx
    .select({
      id: category.id,
      slug: category.slug,
      nameEn: category.nameEn,
      nameFr: category.nameFr,
      blurbEn: category.blurbEn,
      blurbFr: category.blurbFr,
      imagePath: category.imagePath,
    })
    .from(category)
    .where(eq(category.active, true))
    .orderBy(asc(category.sortOrder), asc(category.nameEn));

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: pick(locale, r.nameEn, r.nameFr),
    blurb: r.blurbEn === null ? null : pick(locale, r.blurbEn, r.blurbFr),
    imagePath: r.imagePath,
  }));
}

/** One category by slug, or `null`. Used to title and describe its page. */
export async function categoryBySlug(
  slug: string,
  locale: Locale,
  tx: Tx | typeof db = db,
): Promise<CategoryView | null> {
  const all = await listCategories(locale, tx);
  return all.find((c) => c.slug === slug) ?? null;
}

/**
 * Prep options for many products in ONE query.
 *
 * The grid needs these because quick-add on a card has to attach the DEFAULT
 * prep rather than a null one: FR-4 keys a basket line on product AND prep, so
 * a card that added `null` would create a line that never merges with the one
 * the product page creates. Loading them per card would be 37 queries to
 * render one page.
 */
export async function prepsForProducts(
  productIds: readonly string[],
  tx: Tx | typeof db = db,
): Promise<ReadonlyMap<string, readonly PrepChoice[]>> {
  const out = new Map<string, PrepChoice[]>();
  if (productIds.length === 0) return out;

  const rows = await tx
    .select({ productId: prepOption.productId, id: prepOption.id, label: prepOption.label })
    .from(prepOption)
    .where(and(inArray(prepOption.productId, [...productIds]), eq(prepOption.active, true)))
    .orderBy(asc(prepOption.sortOrder), asc(prepOption.label));

  for (const r of rows) {
    const list = out.get(r.productId) ?? [];
    list.push({ id: r.id, label: r.label });
    out.set(r.productId, list);
  }
  return out;
}
