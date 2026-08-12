import Image from 'next/image';
import Link from 'next/link';
import { FlameIcon } from '@phosphor-icons/react/dist/ssr';

import type { CatalogItem } from '@/db/repositories/catalog';
import { localisedName } from '@/db/repositories/catalog';
import type { Locale } from '@/i18n';
import { t } from '@/i18n';
import { money, ratePerKg, weight } from '@/ui/format';

import { AddToBasket } from './add-to-basket';

/**
 * ⭐ THE UNIT THE GRID IS MADE OF, and the surface where the dials drop.
 *
 * The marketing pages run at VARIANCE 7. A grid of fish runs at 4, and the
 * reason is worth stating rather than quietly diverging: a product grid's
 * entire job is COMPARABILITY. Asymmetric cards, varied aspect ratios and
 * staggered baselines are what make a landing page feel designed, and they are
 * exactly what stops a customer comparing two prices at a glance. Every card
 * here is the same shape and every price sits on the same baseline.
 *
 * Photo-led, because that is what a fishmonger sells on. At 360px the grid is
 * two columns, giving a card around 164px wide: the photo stays legible and
 * the text wraps under it. One column at 360 would show a single fish per
 * screen and make a 37-item catalog feel empty.
 */

export function HotPill({ locale }: { locale: Locale }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-hot px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-hot-ink"
      // The glyph is decoration; the words carry the meaning.
      title={t(locale, 'handling.hotExplainer')}
    >
      <FlameIcon size={12} weight="fill" aria-hidden />
      {t(locale, 'handling.hotPillLabel')}
    </span>
  );
}

export function ProductCard({
  item,
  locale,
  preps,
  priority = false,
}: {
  item: CatalogItem;
  locale: Locale;
  preps: readonly { id: string; label: string }[];
  /** True for the first row only. Sets `next/image` priority for LCP. */
  priority?: boolean;
}) {
  const name = localisedName(item, locale);
  const perKg = item.pricing.mode === 'perKg';

  const soldOut = item.availableG !== null && item.availableG < minOrderOf(item);
  const notDeclared = item.availableG === null;

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-md border border-line bg-raised">
      <Link
        href={`/${locale}/p/${item.slug}`}
        className="relative block aspect-4/3 overflow-hidden bg-soft"
        tabIndex={-1}
        aria-hidden="true"
      >
        {item.imagePath !== null && (
          <Image
            src={item.imagePath}
            alt=""
            fill
            // Matches the grid in §5.3: 2 columns to 640, 2 to 1024, 3 to
            // 1280, 4 above. Getting this wrong is how a 360px phone downloads
            // a 1280px photo.
            sizes="(max-width: 639px) 50vw, (max-width: 1023px) 50vw, (max-width: 1279px) 33vw, 25vw"
            priority={priority}
            className="object-cover transition-transform duration-500 ease-brand group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        )}
        {item.handling === 'COOKED_HOT' && (
          <span className="absolute left-2 top-2">
            <HotPill locale={locale} />
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
        <h3 className="!font-sans !text-body !leading-snug !tracking-normal !pb-0 font-semibold">
          {/*
            ⚠ Manrope, not Bodoni, and the overrides say so loudly.
            `h3` carries the display face and a 28px floor from the base layer,
            which is right for a section heading and wrong for a card title in
            a 164px column. A didone at 16px has no hairlines left.
          */}
          <Link
            href={`/${locale}/p/${item.slug}`}
            className="after:absolute after:inset-0 hover:underline hover:underline-offset-4"
          >
            {name}
          </Link>
        </h3>

        <div className="mt-auto grid gap-1">
          <p className="tnum text-lead font-semibold">
            {perKg && item.pricing.mode === 'perKg'
              ? ratePerKg(item.pricing.ratePerKg, locale)
              : item.pricing.mode === 'pack'
                ? money(item.pricing.price, locale)
                : null}
          </p>
          <p className="text-meta text-muted">
            {perKg
              ? t(locale, 'product.estimated')
              : item.pricing.mode === 'pack'
                ? weight(item.pricing.wMin, locale)
                : null}
          </p>
          <p className="text-meta text-muted" aria-live="polite">
            {soldOut
              ? t(locale, 'shop.soldOut')
              : notDeclared
                ? null
                : t(locale, 'shop.leftToday', { amount: weight(item.availableG ?? 0, locale) })}
          </p>
        </div>

        {/*
          `relative` and `z-10` lift the button out from under the title's
          stretched `::after` link overlay, which would otherwise swallow the
          tap and navigate instead of adding.
        */}
        <div className="relative z-10 pt-1">
          <AddToBasket
            variant="card"
            locale={locale}
            product={{
              productId: item.id,
              slug: item.slug,
              name,
              pricingMode: item.pricing.mode,
              minOrderG: minOrderOf(item),
              stepG: item.pricing.mode === 'perKg' ? item.pricing.step : minOrderOf(item),
              availableG: item.availableG,
              preps,
            }}
          />
        </div>
      </div>
    </article>
  );
}

/** perKg products have a declared minimum; a pack's "minimum" is one pack. */
function minOrderOf(item: CatalogItem): number {
  return item.pricing.mode === 'perKg' ? item.pricing.minOrder : item.pricing.wMin;
}

/** Shaped like the real card, never a spinner. Used by `loading.tsx`. */
export function ProductCardSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-line bg-raised">
      <div className="aspect-4/3 animate-pulse bg-soft motion-reduce:animate-none" />
      <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
        <div className="h-4 w-4/5 animate-pulse rounded-sm bg-soft motion-reduce:animate-none" />
        <div className="h-5 w-1/2 animate-pulse rounded-sm bg-soft motion-reduce:animate-none" />
        <div className="mt-auto h-11 animate-pulse rounded-sm bg-soft motion-reduce:animate-none" />
      </div>
    </div>
  );
}
