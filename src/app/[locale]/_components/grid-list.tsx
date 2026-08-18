'use client';

import { t, type Locale } from '@/i18n';
import { useFavourites } from '@/ui/favourites';

import { ProductCard, ProductRow, type CardItem } from './product-card';

/**
 * The catalog's list, and the one filter the server cannot apply.
 *
 * ⚠ "SAVED" IS THE ODD ONE OUT among the filters, and this component exists
 * because of it. Handling, stock and sort are all facts about the catalog, so
 * the server resolves them and the filtered page is real HTML a crawler can
 * read. Favourites live in `localStorage` and the server has never heard of
 * them, so that one filter has to run after hydration.
 *
 * The consequence is deliberate and worth stating: with `?saved=1` the server
 * still renders EVERY card and the browser hides the ones that are not
 * favourites. That is a little wasteful and it is the correct trade. The
 * alternative is a customer account to hold a heart icon, and the failure mode
 * of this version is a brief flash of the full grid on a slow phone, which is
 * survivable in a way that a login wall is not.
 *
 * ⭐ TWO LAYOUTS, ONE LIST. Figma parity, Phase 4: the catalog pages render
 * the reference's MENU ROWS, banded by counter; the home feed and the related
 * strips keep the card grid. Both read the same `CardItem`, so nothing about
 * the data or the filtering changes with the layout — see `ProductRow` for why
 * the catalog is a list at all.
 *
 * Note that the cards were already Client Components, so making their `ul`
 * one costs nothing extra. This still server-renders: it is a Client
 * Component, not a client-only one.
 */
export function GridList({
  items,
  locale,
  savedOnly,
  layout = 'grid',
  sections,
}: {
  items: readonly CardItem[];
  locale: Locale;
  savedOnly: boolean;
  layout?: 'grid' | 'rows';
  /**
   * The counters, in the order the shop arranges them. Given only by the
   * whole-catalog page: a single-counter page has one section and a heading
   * repeating its own `h1`.
   */
  sections?: readonly { id: string; name: string }[] | undefined;
}) {
  const favourites = useFavourites();
  const shown = savedOnly ? items.filter((i) => favourites.has(i.id)) : items;

  /*
   * ⚠ EMPTINESS IS DECIDED ONCE, ACROSS THE WHOLE LIST, and that is why the
   * sections are grouped in here rather than by the page rendering one list
   * per counter. Six lists each deciding for themselves would put six "nothing
   * saved yet" panels on a filtered page.
   */
  if (shown.length === 0) {
    return (
      <div className="rounded-md border border-line bg-raised px-6 py-16 text-center">
        <p className="text-lead font-semibold">
          {t(locale, savedOnly ? 'shop.noSaved' : 'shop.empty')}
        </p>
        <p className="mx-auto mt-2 max-w-[42ch] text-body text-muted">
          {t(locale, savedOnly ? 'shop.noSavedBody' : 'shop.emptyBody')}
        </p>
      </div>
    );
  }

  if (layout === 'grid') {
    return (
      <ul className="grid grid-cols-2 gap-x-3 gap-y-7 sm:gap-x-4 sm:gap-y-8 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((item, i) => (
          <li key={item.id} className="relative">
            <ProductCard
              item={item}
              locale={locale}
              // The first row only. Marking everything priority is the same as
              // marking nothing: it tells the browser every image is the LCP.
              priority={i < 4}
            />
          </li>
        ))}
      </ul>
    );
  }

  // One unnamed section when the caller gave no counters: the category page,
  // where the heading is the page's own `h1`.
  const groups =
    sections === undefined
      ? [{ id: '', name: null as string | null, items: shown }]
      : sections
          .map((s) => ({
            id: s.id,
            name: s.name as string | null,
            items: shown.filter((i) => i.categoryId === s.id),
          }))
          .filter((g) => g.items.length > 0);

  /*
   * Anything whose counter is not in the list still has to appear. A product
   * can only get here with a category the page did not list if the two reads
   * disagreed, which is a race rather than an impossibility — and dropping the
   * row silently is the version nobody notices.
   */
  const placed = new Set(groups.flatMap((g) => g.items.map((i) => i.id)));
  const orphans = shown.filter((i) => !placed.has(i.id));
  if (orphans.length > 0) groups.push({ id: 'other', name: null, items: orphans });

  return (
    <div className="grid gap-8">
      {groups.map((group, gi) => (
        <section key={group.id}>
          {group.name !== null && <h2 className="!text-display pb-3">{group.name}</h2>}
          <ul className="grid border-t border-line md:grid-cols-2 md:gap-x-8 xl:grid-cols-3">
            {group.items.map((item, i) => (
              <li key={item.id} className="relative border-b border-line">
                {/* The first three rows of the first counter are the LCP candidates. */}
                <ProductRow item={item} locale={locale} priority={gi === 0 && i < 3} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
