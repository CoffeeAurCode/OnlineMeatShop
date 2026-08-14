import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { currentBusinessDay } from '@/db/repositories/availability';
import {
  categoryBySlug,
  listCatalog,
  listCategories,
  prepsForProducts,
} from '@/db/repositories/catalog';
import type { Handling } from '@/domain/types';
import { LOCALES, isLocale, t, type Locale } from '@/i18n';

import { CategoryTabs, FilterBar } from '../../_components/category-nav';
import { ProductGrid } from '../../_components/product-grid';

/** One counter. Same grid, same filter, narrowed to a category. */

const HANDLINGS = new Set<string>(['RAW', 'MARINATED', 'COOKED_CHILLED', 'COOKED_HOT']);

/**
 * Both locales times every category, prerendered. Categories change when the
 * owner rearranges the shop, which is roughly never, so these are static and
 * revalidate on the ordinary schedule.
 */
export async function generateStaticParams() {
  const categories = await listCategories('en');
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
  searchParams: Promise<{ handling?: string }>;
}) {
  const { locale, category } = await params;
  if (!isLocale(locale)) notFound();
  const { handling } = await searchParams;

  const active: Handling | null =
    handling !== undefined && HANDLINGS.has(handling) ? (handling as Handling) : null;

  const day = await currentBusinessDay();
  const [categories, found, catalog] = await Promise.all([
    listCategories(locale),
    categoryBySlug(category, locale),
    listCatalog(day?.id ?? null),
  ]);

  if (found === null) notFound();

  const inCategory = catalog.filter((i) => i.categoryId === found.id);
  const items = active === null ? inCategory : inCategory.filter((i) => i.handling === active);
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
        <div className="grid gap-3">
          <h1 className="!text-display-lg">{found.name}</h1>
          {found.blurb !== null && (
            <p className="max-w-[56ch] text-lead text-muted">{found.blurb}</p>
          )}
        </div>
        <CategoryTabs categories={categories} locale={locale} activeSlug={found.slug} />
        <FilterBar locale={locale} basePath={`/${locale}/shop/${found.slug}`} active={active} />
      </header>

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
