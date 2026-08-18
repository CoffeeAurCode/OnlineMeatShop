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

/**
 * ⭐ THE COUNTER TILES ON THE HOME FEED. Figma parity, Phase 2.
 *
 * Modelled on the reference home screen's category block (`163:838`): two wide
 * tiles carrying their label inside, then a row of small tiles carrying it
 * underneath, all on the same soft ground at the 20px feed radius.
 *
 * ⚠ THIS REPLACED A ROW OF CIRCLES, and the circles were the problem. A circle
 * crops a whole fish to its middle, gives a long counter name nowhere to sit,
 * and scroll-snapped horizontally so the counters past the third were a
 * gesture nobody makes. The reference's answer is a two-tier grid that fits
 * six counters in one viewport without scrolling, which is the density Phase 2
 * asks for.
 *
 * ⚠ THE TILES CARRY NO PROMO BADGE. The reference puts a green `Promo` pill on
 * its Grocery tile; there is no promotion domain here and inventing one to
 * fill the slot is exactly what the plan forbids.
 */
export function CategoryTiles({
  categories,
  locale,
}: {
  categories: readonly CategoryView[];
  locale: Locale;
}) {
  const wide = categories.slice(0, 2);
  /*
   * Four small slots. If there are more counters than fit, the last slot
   * becomes the way to the rest rather than silently dropping them — which is
   * what the reference's `More` tile does, and the only reason it exists.
   */
  const overflows = categories.length > 6;
  const small = categories.slice(2, overflows ? 5 : 6);

  return (
    <div className="grid gap-3">
      {wide.length > 0 && (
        <ul className="grid grid-cols-2 gap-3">
          {wide.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/${locale}/shop/${c.slug}`}
                className="group relative flex h-28 items-end overflow-hidden rounded-lg bg-soft p-3 sm:h-32"
              >
                {c.imagePath !== null && (
                  <Image
                    src={c.imagePath}
                    alt=""
                    /*
                      ⚠ SIZED AS A PERCENTAGE OF THE TILE, NOT IN PIXELS, and
                      the label is bounded by the complement. A fixed 96px
                      square against a `max-w-[60%]` label overlapped as soon
                      as a counter name wrapped to two lines — "Salmon and
                      tuna" ran underneath the photograph. 42 + 50 leaves 8%
                      of clear ground between them at every tile width.
                    */
                    width={160}
                    height={160}
                    sizes="(max-width: 639px) 42vw, 20vw"
                    className="pointer-events-none absolute right-0 top-1/2 aspect-square w-[42%] -translate-y-1/2 rounded-l-md object-cover transition-transform duration-(--duration-image) ease-brand group-hover:scale-[1.06] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                )}
                <span className="relative max-w-[50%] text-body font-semibold leading-tight">
                  {c.name}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {(small.length > 0 || overflows) && (
        <ul className="grid grid-cols-4 gap-3">
          {small.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/${locale}/shop/${c.slug}`}
                className="group grid gap-1.5 focus-visible:outline-none"
              >
                <div className="relative aspect-square overflow-hidden rounded-lg bg-soft">
                  {c.imagePath !== null && (
                    <Image
                      src={c.imagePath}
                      alt=""
                      fill
                      sizes="(max-width: 639px) 22vw, 12vw"
                      className="object-cover transition-transform duration-(--duration-image) ease-brand group-hover:scale-[1.06] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    />
                  )}
                </div>
                <span className="text-center text-meta font-semibold leading-snug group-hover:underline group-hover:underline-offset-4">
                  {c.name}
                </span>
              </Link>
            </li>
          ))}

          {overflows && (
            <li>
              <Link
                href={`/${locale}/shop`}
                className="group grid gap-1.5 focus-visible:outline-none"
              >
                <span className="grid aspect-square place-items-center rounded-lg bg-soft text-lead font-bold leading-none">
                  {/* The reference's ellipsis tile. A glyph, so it needs no icon. */}
                  <span aria-hidden>···</span>
                </span>
                {/*
                  ⚠ `shop.more`, NOT `home.viewAll`. "View everything" and
                  "Tout voir" both wrap to two lines in a quarter-width tile
                  and shove the row out of alignment with the three beside it.
                  The reference's own word here is "More".
                */}
                <span className="text-center text-meta font-semibold leading-snug group-hover:underline group-hover:underline-offset-4">
                  {t(locale, 'shop.more')}
                </span>
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
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
      className={`inline-flex h-10 shrink-0 snap-start items-center whitespace-nowrap rounded-full border px-4 text-meta font-semibold transition-colors duration-(--duration-fast) ${
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
      /*
        ⚠ A SELECTED CHIP IS FILLED, NOT TINTED. It used to be cream with an
        accent hairline, which on the cream section bands this strip sometimes
        sits above is very nearly no change at all. §4 asks for "a filled
        high-contrast treatment" for exactly that reason.

        Three things move together — fill, border and text weight — so the
        state survives greyscale, a dimmed phone and a customer who cannot
        separate the two blues. Colour alone is never the signal here.
      */
      className={`inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-meta transition-colors duration-(--duration-fast) ${
        active
          ? 'border-accent bg-accent font-semibold text-accent-ink'
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
