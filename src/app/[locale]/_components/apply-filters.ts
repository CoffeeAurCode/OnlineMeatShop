import type { CatalogItem } from '@/db/repositories/catalog';
import { localisedName } from '@/db/repositories/catalog';
import type { Locale } from '@/i18n';

import type { Filters } from './category-nav';

/**
 * The facets, applied to the catalog.
 *
 * ⚠ IN MEMORY, NOT IN SQL, AND THAT IS DELIBERATE. This catalog is under forty
 * products; the query that fetches it already joins today's stock, and pushing
 * four optional predicates into it would buy nothing measurable while making
 * `listCatalog` a filter engine. If the catalog ever reaches the thousands
 * this is the function to move, and it is one function.
 *
 * `saved` is absent here on purpose: favourites live in the browser and the
 * server has never heard of them. `GridList` applies that one.
 */
export function applyFilters(
  catalog: readonly CatalogItem[],
  filters: Filters,
  locale: Locale,
): readonly CatalogItem[] {
  let items = catalog;

  if (filters.handling !== null) {
    items = items.filter((i) => i.handling === filters.handling);
  }

  if (filters.inStock) {
    /*
     * ⚠ "IN STOCK" MEANS ORDERABLE, not "has a stock row". A product with less
     * left than its own minimum order is on the counter and cannot be bought,
     * and a filter that showed it would be lying by a technicality. A product
     * with NO stock row was never declared this morning, which is also not
     * orderable — a different fact, the same answer to this question.
     */
    items = items.filter((i) => i.availableG !== null && i.availableG >= minOrderOf(i));
  }

  if (filters.sort !== 'default') {
    // A copy: the catalog array is shared with the caller and `sort` mutates.
    items = [...items].sort(comparator(filters.sort, locale));
  }

  return items;
}

function comparator(
  sort: Exclude<Filters['sort'], 'default'>,
  locale: Locale,
): (a: CatalogItem, b: CatalogItem) => number {
  if (sort === 'name') {
    /*
     * `Intl.Collator`, not `<`. French sorts accented letters with their base
     * letter, so `Écrevisse` belongs between `Crabe` and `Homard` rather than
     * after `Vivaneau` where a code-point comparison puts it. On a site that
     * is half French this is the difference between an alphabetical list and
     * an apparently random one.
     */
    const collator = new Intl.Collator(locale === 'fr' ? 'fr-CA' : 'en-CA');
    return (a, b) => collator.compare(localisedName(a, locale), localisedName(b, locale));
  }

  const direction = sort === 'priceAsc' ? 1 : -1;
  return (a, b) => direction * (comparablePrice(a) - comparablePrice(b));
}

/**
 * ⚠ THE ONE GENUINELY AWKWARD THING ON THIS SCREEN: a $32/kg rate and a $14
 * pack are not the same kind of number, and sorting them into one list means
 * choosing what "cheaper" means.
 *
 * The choice here is WHAT THE CUSTOMER WILL PAY FOR ONE OF THESE: a pack's
 * price, and for a per-kg product the estimate at its own minimum order. That
 * is the number on the card, so the list ends up in the order the visible
 * prices are in, which is the only order that will not look broken.
 *
 * Comparing rate-per-kg against pack-price directly would be worse in a
 * specific way: a $90/kg tuna loin sold from 200 g would sort below a $12 pack
 * of fish cakes, and both cards would be on screen saying otherwise.
 */
function comparablePrice(item: CatalogItem): number {
  if (item.pricing.mode === 'pack') return item.pricing.price;
  return Math.ceil((item.pricing.ratePerKg * item.pricing.minOrder) / 1000);
}

function minOrderOf(item: CatalogItem): number {
  return item.pricing.mode === 'perKg' ? item.pricing.minOrder : item.pricing.wMin;
}
