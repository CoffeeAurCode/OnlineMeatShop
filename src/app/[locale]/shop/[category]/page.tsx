import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { currentBusinessDay } from '@/db/repositories/availability';
import {
  categoryBySlug,
  listCatalog,
  listCategories,
  prepsForProducts,
} from '@/db/repositories/catalog';
import { staticParamsOr } from '@/db/build-time';
import { LOCALES, isLocale, t, type Locale } from '@/i18n';

import { applyFilters } from '../../_components/apply-filters';
import { CategoryTabs, FilterBar, parseFilters } from '../../_components/category-nav';
import { DeliveryStrip } from '../../_components/delivery-strip';
import { ProductGrid } from '../../_components/product-grid';

/**
 * One counter. The same feed as `/shop`, narrowed to a category.
 *
 * The two pages share their chrome, their facets and their grid, and differ in
 * one filter and a heading. Keeping them as two files rather than one page
 * with an optional segment is what keeps the category page STATIC and
 * crawlable with its own metadata, which is the entire reason it exists.
 */

/**
 * Both locales times every category, prerendered. Categories change when the
 * owner rearranges the shop, which is roughly never, so these are static and
 * revalidate on the ordinary schedule.
 */
export async function generateStaticParams() {
  // Guarded: a build must not require a reachable, migrated database. See
  // `src/db/build-time.ts` for why an empty list is correct rather than fatal.
  const categories = await staticParamsOr('the categories', () => listCategories('en'));
  return LOCALES.flatMap((locale) => categories.map((c) => ({ locale, category: c.slug })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; category: string }>;
}): Promise<Metadata> {
  const { locale, category } = await params;
  const l: Locale = isLocale(locale) ? locale : 'fr';
  const found = await categoryBySlug(category, l);
  if (found === null) return {};
  return {
    title: found.name,
    description: found.blurb ?? undefined,
    alternates: {
      languages: {
        'en-CA': `/en/shop/${category}`,
        'fr-CA': `/fr/shop/${category}`,
      },
    },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, category } = await params;
  if (!isLocale(locale)) notFound();

  const filters = parseFilters(await searchParams);

  const day = await currentBusinessDay();
  const [categories, found, catalog] = await Promise.all([
    listCategories(locale),
    categoryBySlug(category, locale),
    listCatalog(day?.id ?? null),
  ]);

  if (found === null) notFound();

  const inCategory = catalog.filter((i) => i.categoryId === found.id);
  const items = applyFilters(inCategory, filters, locale);
  const preps = await prepsForProducts(items.map((i) => i.id));

  return (
    <div className="mx-auto max-w-[80rem] px-4 pb-14 sm:px-6">
      {/*
        ⚠ `grid-cols-[minmax(0,1fr)]`, not a bare `grid`.
        A grid item's default `min-width: auto` means it CANNOT shrink below
        its content, so the horizontally-scrolling tab strip below expands the
        track instead of scrolling inside it, and the whole page gains a
        horizontal scrollbar at phone widths. Measured at 360 and 390: the
        document went to 1133px wide. An explicit `minmax(0, 1fr)` track is
        what lets the child be narrower than its contents.
      */}
      <header className="grid grid-cols-[minmax(0,1fr)] gap-4 pt-6 sm:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="grid gap-2">
            <h1 className="!text-display-lg">{found.name}</h1>
            {found.blurb !== null && (
              <p className="max-w-[56ch] text-body text-muted">{found.blurb}</p>
            )}
          </div>
          <p className="tnum pb-1 text-meta text-muted" aria-live="polite">
            {t(locale, items.length === 1 ? 'shop.resultCountOne' : 'shop.resultCount', {
              count: items.length,
            })}
          </p>
        </div>
        <DeliveryStrip locale={locale} />
      </header>

      <div className="sticky top-[6.5rem] z-30 -mx-4 mt-4 grid grid-cols-[minmax(0,1fr)] gap-2 border-b border-line bg-raised px-4 py-3 sm:top-[4.5rem] sm:mx-0 sm:rounded-md sm:border sm:px-4">
        <CategoryTabs categories={categories} locale={locale} activeSlug={found.slug} />
        <FilterBar locale={locale} basePath={`/${locale}/shop/${found.slug}`} filters={filters} />
      </div>

      {/*
        ⚠ THE CLOSED-DAY NOTICE WAS ON `/shop` AND NOT HERE, which is the wrong
        way round: a customer arriving from search lands on a CATEGORY page far
        more often than on the whole counter, and without this they read an
        empty grid as "this shop has no lobster" rather than as "the shop has
        not opened today". §9 asks for the notice before the grid on both.
      */}
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
        />
      </div>
    </div>
  );
}
