import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog, listCategories, prepsForProducts } from '@/db/repositories/catalog';
import { isLocale, t, type Locale } from '@/i18n';

import { CategoryTabs, FilterBar, parseFilters } from '../_components/category-nav';
import { DeliveryStrip } from '../_components/delivery-strip';
import { ProductGrid } from '../_components/product-grid';
import { applyFilters } from '../_components/apply-filters';

/**
 * ⭐ THE FEED. Everything on the counter, in one grid, with the counters as
 * tabs and the facets as chips.
 *
 * Server rendered, and every price and quantity is in the HTML. That is not a
 * performance choice: organic local search is the whole reason this app has a
 * server tier, and a catalog that assembles itself in the browser is invisible
 * to a crawler.
 *
 * ⚠ THE CHROME IS STICKY AND THE HEADER IS ALSO STICKY, so the two are budgeted
 * together and the offsets have to be kept in step by hand. The header is
 * 116px — a 56px control row, a 48px search field and 12px under it — and
 * `top-[7.25rem]` below is tracking that sum. Change the header's rows and
 * this number is wrong in a way nothing catches except looking at it: the
 * strip parks itself over the bar or floats below it.
 *
 * ⭐ ONE NUMBER, NO `sm:` VARIANT, since the band rebuild (2026-08-19). The
 * header used to be 108px on a phone and 72px above `sm`, so this strip needed
 * `top-[6.75rem] sm:top-[4.5rem]` and THREE FILES had to agree about two
 * numbers. The band is the same height at every width — only its type sizes
 * and its search cap change — so there is one number to keep in step now.
 *
 * With this strip's own 52px that is 168px of a 640px viewport, which is at
 * the ceiling, and it is why the counter tabs and the filter chips each scroll
 * sideways instead of wrapping into more rows.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const l: Locale = isLocale(locale) ? locale : 'fr';
  return { title: t(l, 'shop.title') };
}

export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const filters = parseFilters(await searchParams);

  const day = await currentBusinessDay();
  const [categories, catalog] = await Promise.all([
    listCategories(locale),
    listCatalog(day?.id ?? null),
  ]);

  const items = applyFilters(catalog, filters, locale);
  const preps = await prepsForProducts(items.map((i) => i.id));

  return (
    <div className="mx-auto max-w-[80rem] px-4 pb-14 sm:px-6">
      {/*
        ⚠ `grid-cols-[minmax(0,1fr)]`, not a bare `grid`.
        A grid item's default `min-width: auto` means it CANNOT shrink below
        its content, so a horizontally-scrolling strip expands the track
        instead of scrolling inside it, and the whole page gains a horizontal
        scrollbar at phone widths. Measured at 360 and 390: the document went
        to 1133px wide. An explicit `minmax(0, 1fr)` track is what lets the
        child be narrower than its contents.
      */}
      <header className="grid grid-cols-[minmax(0,1fr)] gap-4 pt-6 sm:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h1 className="!text-display-lg">{t(locale, 'shop.title')}</h1>
          <p className="tnum pb-1 text-meta text-muted" aria-live="polite">
            {t(locale, items.length === 1 ? 'shop.resultCountOne' : 'shop.resultCount', {
              count: items.length,
            })}
          </p>
        </div>
        <DeliveryStrip locale={locale} />
      </header>

      <div className="sticky top-[7.25rem] z-30 -mx-4 mt-4 grid grid-cols-[minmax(0,1fr)] gap-2 border-b border-line bg-raised px-4 py-3 sm:mx-0 sm:rounded-md sm:border sm:px-4">
        <CategoryTabs categories={categories} locale={locale} activeSlug={null} />
        <FilterBar locale={locale} basePath={`/${locale}/shop`} filters={filters} />
      </div>

      {day === null && (
        <p className="mt-6 rounded-md border border-line bg-soft px-4 py-3 text-body">
          <strong className="font-semibold">{t(locale, 'shop.shopClosed')}</strong>{' '}
          {t(locale, 'shop.shopClosedBody')}
        </p>
      )}

      <div className="mt-6">
        <ProductGrid
          items={items}
          locale={locale}
          prepsByProduct={preps}
          savedOnly={filters.saved}
          layout="rows"
          sections={categories}
        />
      </div>
    </div>
  );
}
