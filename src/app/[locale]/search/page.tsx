import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { currentBusinessDay } from '@/db/repositories/availability';
import {
  listCatalog,
  localisedDescription,
  localisedName,
  prepsForProducts,
} from '@/db/repositories/catalog';
import { isLocale, t } from '@/i18n';

import { ProductGrid } from '../_components/product-grid';
import { SearchField } from '../_components/search-field';

/**
 * Search.
 *
 * ⭐ IN MEMORY, OVER 37 PRODUCTS, ON PURPOSE. `02-DTM` Appendix A rules out a
 * search engine, and this is why that is not a compromise: the entire catalog
 * is already loaded to render the grid, it is a few dozen rows, and the shop
 * will never have thousands. Adding Postgres full-text search, let alone a
 * search service, would be more configuration than the feature is.
 *
 * Accent-insensitive in both directions, which matters more than it sounds:
 * a French customer types `huitres` without the circumflex and must still find
 * `Huîtres`, and an English customer typing `pate` must find `Paté`. `NFD`
 * decomposition plus stripping combining marks handles both with no table.
 */

export const metadata: Metadata = {
  // Not indexable: a search results page is per-visitor and has nothing a
  // crawler should hold on to.
  robots: { index: false, follow: true },
};

/** `Huîtres` and `huitres` compare equal. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { q = '' } = await searchParams;

  const query = fold(q);
  const day = await currentBusinessDay();
  const catalog = await listCatalog(day?.id ?? null);

  // Searched across BOTH languages regardless of the current locale. Someone
  // browsing in French may well know the fish by its English name, and there
  // is no cost to matching it.
  const items =
    query === ''
      ? []
      : catalog.filter((item) => {
          const haystack = fold(
            [
              item.name,
              item.nameFr ?? '',
              localisedName(item, locale),
              localisedDescription(item, locale) ?? '',
            ].join(' '),
          );
          return query.split(/\s+/).every((term) => haystack.includes(term));
        });

  const preps = await prepsForProducts(items.map((i) => i.id));

  return (
    <div className="mx-auto max-w-[76rem] px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="!text-display-lg">{t(locale, 'nav.search')}</h1>

      <div className="mt-6 max-w-[32rem]">
        <SearchField locale={locale} initial={q} />
      </div>

      {query !== '' && (
        <>
          <p className="mt-8 text-meta text-muted" aria-live="polite">
            {t(locale, items.length === 1 ? 'shop.resultCountOne' : 'shop.resultCount', {
              count: items.length,
            })}
          </p>
          <div className="mt-4">
            <ProductGrid items={items} locale={locale} prepsByProduct={preps} />
          </div>
        </>
      )}
    </div>
  );
}
