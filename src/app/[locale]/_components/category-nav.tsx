import Image from 'next/image';
import Link from 'next/link';
import { ArrowsDownUpIcon, FlameIcon, HeartIcon, PackageIcon } from '@phosphor-icons/react/dist/ssr';

import type { CategoryView } from '@/db/repositories/catalog';
import { t, type Locale } from '@/i18n';
import type { Handling } from '@/domain/types';

/**
 * The ways into the catalog: counters, and the filter row under them.
 *
 * ⭐ CATEGORY IS THE GROUPING. HANDLING IS A FILTER. That inversion is the
 * thing to preserve: the original storefront grouped by handling, so a shopper
 * looking for lobster had to already know whether they wanted it raw, cooked,
 * or in a bisque. Handling is a food-safety property that governs delivery
 * windows; it is not how anyone shops.
 *
 * ⚠ EVERY CONTROL HERE IS A LINK CARRYING A QUERY PARAMETER, not client state.
 * The filtered view is then a real, shareable, crawlable URL that works before
 * hydration and survives a back button. `scroll={false}` keeps the page from
 * jumping to the top when the grid below changes, which is the entire point of
 * a filter.
 */

/** The counter rail on the landing page. Scroll-snaps on a phone. */
export function CategoryRail({
  categories,
  locale,
}: {
  categories: readonly CategoryView[];
  locale: Locale;
}) {
  return (
    <ul
      className="
        -mx-4 flex min-w-0 snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2
        [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
        sm:mx-0 sm:px-0
        lg:grid lg:grid-cols-4 lg:overflow-visible
        xl:grid-cols-8
      "
    >
      {categories.map((c) => (
        <li key={c.slug} className="w-[38vw] shrink-0 snap-start sm:w-[26vw] lg:w-auto">
          <Link
            href={`/${locale}/shop/${c.slug}`}
            className="group grid gap-2 rounded-md focus-visible:outline-none"
          >
            <div className="relative aspect-square overflow-hidden rounded-full bg-soft">
              {c.imagePath !== null && (
                <Image
                  src={c.imagePath}
                  alt=""
                  fill
                  sizes="(max-width: 639px) 38vw, (max-width: 1023px) 26vw, (max-width: 1279px) 22vw, 11vw"
                  className="object-cover transition-transform duration-500 ease-brand group-hover:scale-[1.06] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                />
              )}
            </div>
            <span className="text-center text-meta font-semibold leading-snug group-hover:underline group-hover:underline-offset-4">
              {c.name}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The persistent counter strip on the shop pages. */
export function CategoryTabs({
  categories,
  locale,
  activeSlug,
}: {
  categories: readonly CategoryView[];
  locale: Locale;
  activeSlug: string | null;
}) {
  const tab = (href: string, label: string, active: boolean) => (
    <Link
      key={href}
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex h-10 shrink-0 snap-start items-center whitespace-nowrap rounded-full border px-4 text-meta font-semibold transition-colors duration-200 ${
        active
          ? 'border-accent bg-accent text-accent-ink'
          : 'border-line bg-raised text-ink hover:border-accent'
      }`}
    >
      {label}
    </Link>
  );

  return (
    // `min-w-0` on both: a scroll container has to be allowed to be narrower
    // than what it scrolls, or it is not a scroll container.
    <nav aria-label={t(locale, 'shop.title')} className="min-w-0">
      <div className="-mx-4 flex min-w-0 snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
        {tab(`/${locale}/shop`, t(locale, 'shop.allCategories'), activeSlug === null)}
        {categories.map((c) => tab(`/${locale}/shop/${c.slug}`, c.name, c.slug === activeSlug))}
      </div>
    </nav>
  );
}

/** The state the filter row encodes. Parsed from the query string by the page. */
export interface Filters {
  readonly handling: Handling | null;
  readonly inStock: boolean;
  readonly saved: boolean;
  readonly sort: SortKey;
}

export type SortKey = 'default' | 'priceAsc' | 'priceDesc' | 'name';

const SORTS: readonly SortKey[] = ['default', 'priceAsc', 'priceDesc', 'name'];
const HANDLINGS: readonly Handling[] = ['RAW', 'MARINATED', 'COOKED_CHILLED', 'COOKED_HOT'];

export const EMPTY_FILTERS: Filters = {
  handling: null,
  inStock: false,
  saved: false,
  sort: 'default',
};

/** Parse the query string. Anything unrecognised is no filter, never a 404. */
export function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const one = (v: string | string[] | undefined): string | null =>
    typeof v === 'string' ? v : null;

  const handling = one(params.handling);
  const sort = one(params.sort);

  return {
    handling: handling !== null && HANDLINGS.includes(handling as Handling)
      ? (handling as Handling)
      : null,
    inStock: one(params.inStock) === '1',
    saved: one(params.saved) === '1',
    sort: sort !== null && SORTS.includes(sort as SortKey) ? (sort as SortKey) : 'default',
  };
}

/** Rebuild the URL with one facet changed. Empty facets are dropped, so the
 *  unfiltered view is a clean `/shop` rather than `/shop?handling=&sort=`. */
function hrefWith(basePath: string, filters: Filters, change: Partial<Filters>): string {
  const next = { ...filters, ...change };
  const q = new URLSearchParams();
  if (next.handling !== null) q.set('handling', next.handling);
  if (next.inStock) q.set('inStock', '1');
  if (next.saved) q.set('saved', '1');
  if (next.sort !== 'default') q.set('sort', next.sort);
  const s = q.toString();
  return s === '' ? basePath : `${basePath}?${s}`;
}

/**
 * ⭐ THE FILTER ROW. Uber's chip bar, with this shop's real axes rather than
 * the generic ones.
 *
 * ⚠ NO RATINGS, NO DELIVERY-TIME FILTER, NO "OFFERS" CHIP. Those are the chips
 * that make a marketplace legible when it holds four hundred restaurants; here
 * there is ONE shop, its delivery windows are the same for every product, and
 * a rating filter over its own catalog would be the shop rating itself. Copying
 * them across would be cargo cult. What survives the translation is the SHAPE:
 * one scrollable row of toggles, each a real URL, sitting directly above the
 * grid it governs.
 *
 * The four that do earn their place map onto real decisions a customer makes
 * here: what kind of preparation, whether to hide what has sold out, whether
 * to see only what they have saved, and price order.
 */
export function FilterBar({
  locale,
  basePath,
  filters,
}: {
  locale: Locale;
  basePath: string;
  filters: Filters;
}) {
  const chip = (
    href: string,
    label: string,
    active: boolean,
    icon?: React.ReactNode,
    key?: string,
  ) => (
    <Link
      key={key ?? href}
      href={href}
      scroll={false}
      aria-pressed={active}
      className={`inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-meta transition-colors duration-200 ${
        active
          ? 'border-accent bg-soft font-semibold text-ink'
          : 'border-line bg-raised text-ink hover:border-accent'
      }`}
    >
      {icon}
      {label}
    </Link>
  );

  const dirty =
    filters.handling !== null || filters.inStock || filters.saved || filters.sort !== 'default';

  return (
    <div className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
      {chip(
        hrefWith(basePath, filters, { inStock: !filters.inStock }),
        t(locale, 'shop.inStockOnly'),
        filters.inStock,
        <PackageIcon size={14} weight={filters.inStock ? 'fill' : 'regular'} aria-hidden />,
      )}
      {chip(
        hrefWith(basePath, filters, { saved: !filters.saved }),
        t(locale, 'shop.savedOnly'),
        filters.saved,
        <HeartIcon size={14} weight={filters.saved ? 'fill' : 'regular'} aria-hidden />,
      )}
      {chip(
        hrefWith(basePath, filters, {
          handling: filters.handling === 'COOKED_HOT' ? null : 'COOKED_HOT',
        }),
        t(locale, 'handling.COOKED_HOT'),
        filters.handling === 'COOKED_HOT',
        <FlameIcon
          size={14}
          weight={filters.handling === 'COOKED_HOT' ? 'fill' : 'regular'}
          aria-hidden
        />,
      )}

      <span aria-hidden className="my-1 w-px shrink-0 bg-line" />

      {HANDLINGS.filter((h) => h !== 'COOKED_HOT').map((h) =>
        chip(
          hrefWith(basePath, filters, { handling: filters.handling === h ? null : h }),
          t(locale, `handling.${h}`),
          filters.handling === h,
          undefined,
          h,
        ),
      )}

      <span aria-hidden className="my-1 w-px shrink-0 bg-line" />

      {/*
        Sort is a chip that cycles rather than a `<select>`. Three states, and
        a native select on a phone opens a full-screen wheel for three options,
        which is more ceremony than the choice deserves. It still renders its
        current state as text, so it never becomes a mystery button.
      */}
      {chip(
        hrefWith(basePath, filters, { sort: nextSort(filters.sort) }),
        t(locale, `shop.sort.${filters.sort}`),
        filters.sort !== 'default',
        <ArrowsDownUpIcon size={14} aria-hidden />,
      )}

      {dirty && (
        <Link
          href={basePath}
          scroll={false}
          className="inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-meta font-semibold text-muted underline underline-offset-4 hover:text-ink"
        >
          {t(locale, 'shop.clearFilters')}
        </Link>
      )}
    </div>
  );
}

function nextSort(current: SortKey): SortKey {
  const i = SORTS.indexOf(current);
  return SORTS[(i + 1) % SORTS.length] ?? 'default';
}
