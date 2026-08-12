import Image from 'next/image';
import Link from 'next/link';

import type { CategoryView } from '@/db/repositories/catalog';
import { t, type Locale } from '@/i18n';
import type { Handling } from '@/domain/types';

/**
 * The two ways into the catalog, plus the handling filter.
 *
 * ⭐ CATEGORY IS THE GROUPING. HANDLING IS A FILTER. That inversion is most of
 * what the redesign fixed: the old storefront grouped by handling, which meant
 * a shopper looking for lobster had to already know whether they wanted it
 * raw, cooked or in a bisque. Handling is a food-safety property that governs
 * delivery windows; it is not how anyone shops.
 */

/** The horizontal counter list. Scroll-snaps on a phone, 4 up, then 8. */
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
        -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2
        [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
        sm:mx-0 sm:px-0
        lg:grid lg:grid-cols-4 lg:overflow-visible
        xl:grid-cols-8
      "
    >
      {categories.map((c) => (
        <li key={c.slug} className="w-[42vw] shrink-0 snap-start sm:w-[30vw] lg:w-auto">
          <Link
            href={`/${locale}/shop/${c.slug}`}
            className="group grid gap-2 rounded-md focus-visible:outline-none"
          >
            <div className="relative aspect-square overflow-hidden rounded-md bg-soft">
              {c.imagePath !== null && (
                <Image
                  src={c.imagePath}
                  alt=""
                  fill
                  sizes="(max-width: 639px) 42vw, (max-width: 1023px) 30vw, (max-width: 1279px) 22vw, 11vw"
                  className="object-cover transition-transform duration-500 ease-brand group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                />
              )}
            </div>
            <span className="text-meta font-semibold leading-snug group-hover:underline group-hover:underline-offset-4">
              {c.name}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The persistent tab strip on the shop pages. */
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
      className={`tap inline-flex shrink-0 snap-start items-center whitespace-nowrap rounded-full border px-4 text-meta font-semibold transition-colors duration-200 ${
        active
          ? 'border-accent bg-accent text-accent-ink'
          : 'border-line bg-raised text-ink hover:border-accent'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <nav aria-label={t(locale, 'shop.title')}>
      <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
        {tab(`/${locale}/shop`, t(locale, 'shop.allCategories'), activeSlug === null)}
        {categories.map((c) => tab(`/${locale}/shop/${c.slug}`, c.name, c.slug === activeSlug))}
      </div>
    </nav>
  );
}

const HANDLINGS: readonly Handling[] = ['RAW', 'MARINATED', 'COOKED_CHILLED', 'COOKED_HOT'];

/**
 * The handling filter.
 *
 * Plain links carrying a query parameter, not client state. The filtered view
 * is then a real, shareable, crawlable URL, and it works before hydration.
 * `scroll={false}` keeps the page from jumping to the top when the grid below
 * changes, which is the whole point of a filter.
 */
export function FilterBar({
  locale,
  basePath,
  active,
}: {
  locale: Locale;
  basePath: string;
  active: Handling | null;
}) {
  const chip = (href: string, label: string, isActive: boolean) => (
    <Link
      key={href}
      href={href}
      scroll={false}
      aria-pressed={isActive}
      className={`tap inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-meta transition-colors duration-200 ${
        isActive ? 'border-accent bg-soft font-semibold' : 'border-line hover:border-accent'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-meta font-semibold uppercase tracking-[0.12em] text-muted">
        {t(locale, 'shop.filterHeading')}
      </span>
      {chip(basePath, t(locale, 'shop.filterAll'), active === null)}
      {HANDLINGS.map((h) =>
        chip(`${basePath}?handling=${h}`, t(locale, `handling.${h}`), active === h),
      )}
    </div>
  );
}
