import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog, listCategories, prepsForProducts } from '@/db/repositories/catalog';
import type { Handling } from '@/domain/types';
import { isLocale, t, type Locale } from '@/i18n';

import { CategoryTabs, FilterBar } from '../_components/category-nav';
import { ProductGrid } from '../_components/product-grid';

/**
 * Everything on the counter, in one grid, with the counters as tabs.
 *
 * Server rendered, and every price and quantity is in the HTML. That is not a
 * performance choice: organic local search is the whole reason this app has a
 * server tier, and a catalog that assembles itself in the browser is invisible
 * to a crawler.
 */

const HANDLINGS = new Set<string>(['RAW', 'MARINATED', 'COOKED_CHILLED', 'COOKED_HOT']);

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
  searchParams: Promise<{ handling?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { handling } = await searchParams;

  // Anything unrecognised is treated as no filter rather than as an error. A
  // hand-edited query string is not worth a 404, and a filter that silently
  // shows everything is obvious to the person who mistyped it.
  const active: Handling | null =
    handling !== undefined && HANDLINGS.has(handling) ? (handling as Handling) : null;

  const day = await currentBusinessDay();
  const [categories, catalog] = await Promise.all([
    listCategories(locale),
    listCatalog(day?.id ?? null),
  ]);

  const items = active === null ? catalog : catalog.filter((i) => i.handling === active);
  const preps = await prepsForProducts(items.map((i) => i.id));

  return (
    <div className="mx-auto max-w-[76rem] px-4 py-10 sm:px-6 sm:py-14">
      {/*
        ⚠ `grid-cols-[minmax(0,1fr)]`, not a bare `grid`.
        A grid item's default `min-width: auto` means it CANNOT shrink below
        its content, so the horizontally-scrolling tab strip below expands the
        track instead of scrolling inside it, and the whole page gains a
        horizontal scrollbar at phone widths. Measured at 360 and 390: the
        document went to 1133px wide. An explicit `minmax(0, 1fr)` track is
        what lets the child be narrower than its contents.
      */}
      <header className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <h1 className="!text-display-lg">{t(locale, 'shop.title')}</h1>
        <CategoryTabs categories={categories} locale={locale} activeSlug={null} />
        <FilterBar locale={locale} basePath={`/${locale}/shop`} active={active} />
      </header>

      {day === null && (
        <p className="mt-8 rounded-md border border-line bg-soft px-4 py-3 text-body">
          <strong className="font-semibold">{t(locale, 'shop.shopClosed')}</strong>{' '}
          {t(locale, 'shop.shopClosedBody')}
        </p>
      )}

      <p className="mt-8 text-meta text-muted" aria-live="polite">
        {t(locale, items.length === 1 ? 'shop.resultCountOne' : 'shop.resultCount', {
          count: items.length,
        })}
      </p>

      <div className="mt-4">
        <ProductGrid items={items} locale={locale} prepsByProduct={preps} />
      </div>
    </div>
  );
}
