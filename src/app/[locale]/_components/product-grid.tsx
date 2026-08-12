import type { CatalogItem, PrepChoice } from '@/db/repositories/catalog';
import { t, type Locale } from '@/i18n';

import { ProductCard } from './product-card';

/**
 * The grid. `05-PLAN` §5.3, exactly:
 *
 *   360-639  2 columns      1024-1279  3 columns
 *   640-1023 2 columns      1280+      4 columns
 *
 * CSS Grid, never flex percentage arithmetic. `w-[calc(50%-0.5rem)]` produces
 * a row that is one pixel too wide at some viewport nobody tested, and the
 * symptom is a horizontal scrollbar on a phone.
 *
 * Two columns at 360px gives a card around 164px. Deliberate: the card is
 * photo-led, so the photo stays legible and the text wraps under it. One
 * column would show a single fish per screen and make the catalog feel empty.
 */
export function ProductGrid({
  items,
  locale,
  prepsByProduct,
}: {
  items: readonly CatalogItem[];
  locale: Locale;
  prepsByProduct: ReadonlyMap<string, readonly PrepChoice[]>;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-line bg-raised px-6 py-16 text-center">
        <p className="text-lead font-semibold">{t(locale, 'shop.empty')}</p>
        <p className="mx-auto mt-2 max-w-[42ch] text-body text-muted">
          {t(locale, 'shop.emptyBody')}
        </p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item, i) => (
        <li key={item.id} className="relative">
          <ProductCard
            item={item}
            locale={locale}
            preps={prepsByProduct.get(item.id) ?? []}
            // The first row only. Marking everything priority is the same as
            // marking nothing: it tells the browser every image is the LCP.
            priority={i < 4}
          />
        </li>
      ))}
    </ul>
  );
}
