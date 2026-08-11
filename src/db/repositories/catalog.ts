import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';
import { catalogVersion, prepOption, product, stockItem } from '@/db/schema';
import { available } from '@/domain/availability';
import { cents, grams, type Grams, type Handling, type Pricing } from '@/domain/types';

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
