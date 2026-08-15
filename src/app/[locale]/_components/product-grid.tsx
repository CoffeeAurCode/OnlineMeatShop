import type { CatalogItem, PrepChoice } from '@/db/repositories/catalog';
import { localisedName } from '@/db/repositories/catalog';
import type { Locale } from '@/i18n';

import { GridList } from './grid-list';
import type { CardItem } from './product-card';

/**
 * The grid.
 *
 *   360-1023  2 columns      1024-1279  3 columns      1280+  4 columns
 *
 * CSS Grid, never flex percentage arithmetic. `w-[calc(50%-0.5rem)]` produces
 * a row that is one pixel too wide at some viewport nobody tested, and the
 * symptom is a horizontal scrollbar on a phone. The columns live in
 * `GridList`; this component is the server-side half.
 *
 * ⚠ THE MAPPING FROM `CatalogItem` HAPPENS HERE, on the server, and not in the
 * card. `Pricing` is a discriminated union and the cards are Client
 * Components; narrowing the union at the boundary means the props crossing
 * into the bundle are flat primitives, and no client code has to re-derive
 * which of `packPrice` and `ratePerKg` applies. It also localises each name
 * once rather than shipping both languages of the catalog to the browser.
 */
export function ProductGrid({
  items,
  locale,
  prepsByProduct,
  savedOnly = false,
}: {
  items: readonly CatalogItem[];
  locale: Locale;
  prepsByProduct: ReadonlyMap<string, readonly PrepChoice[]>;
  savedOnly?: boolean;
}) {
  const cards = items.map((item) =>
    toCardItem(item, locale, prepsByProduct.get(item.id) ?? []),
  );
  return <GridList items={cards} locale={locale} savedOnly={savedOnly} />;
}

export function toCardItem(
  item: CatalogItem,
  locale: Locale,
  preps: readonly PrepChoice[],
): CardItem {
  return {
    id: item.id,
    slug: item.slug,
    name: localisedName(item, locale),
    description: locale === 'fr' ? (item.descriptionFr ?? item.description) : item.description,
    imagePath: item.imagePath,
    handling: item.handling,
    pricingMode: item.pricing.mode,
    unitPriceCents: item.pricing.mode === 'perKg' ? item.pricing.ratePerKg : item.pricing.price,
    // A per-kg product has a declared minimum and step. A pack's "minimum" is
    // one pack, and its "step" is also one pack.
    minOrderG: item.pricing.mode === 'perKg' ? item.pricing.minOrder : item.pricing.wMin,
    stepG: item.pricing.mode === 'perKg' ? item.pricing.step : item.pricing.wMin,
    packMaxG: item.pricing.mode === 'pack' ? item.pricing.wMax : null,
    availableG: item.availableG,
    preps: preps.map((p) => ({ id: p.id, label: p.label })),
  };
}
