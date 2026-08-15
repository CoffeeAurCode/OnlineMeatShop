'use client';

import { t, type Locale } from '@/i18n';
import { useFavourites } from '@/ui/favourites';

import { ProductCard, type CardItem } from './product-card';

/**
 * The grid's list, and the one filter the server cannot apply.
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
 * Note that the cards were already Client Components, so making their `ul`
 * one costs nothing extra. This still server-renders: it is a Client
 * Component, not a client-only one.
 */
export function GridList({
  items,
  locale,
  savedOnly,
}: {
  items: readonly CardItem[];
  locale: Locale;
  savedOnly: boolean;
}) {
  const favourites = useFavourites();
  const shown = savedOnly ? items.filter((i) => favourites.has(i.id)) : items;

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
