'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { FlameIcon, HeartIcon, PlusIcon } from '@phosphor-icons/react/dist/ssr';

import type { Locale } from '@/i18n';
import { t } from '@/i18n';
import { isFavourite, toggleFavourite, useFavourites } from '@/ui/favourites';
import { money, ratePerKg, weight } from '@/ui/format';

import { ItemSheet, type SheetProduct } from './item-sheet';

/**
 * ⭐ THE UNIT THE GRID IS MADE OF.
 *
 * ── WHAT CHANGED, AND WHY ─────────────────────────────────────────────────
 *
 * The card is now media-led with its controls ON the image, which is the
 * delivery-app pattern: a floating quick-add in the bottom-right corner, a
 * favourite in the top-right, status badges in the top-left. That buys back
 * roughly 48px of vertical space per card, which at two columns on a 360px
 * phone is the difference between seeing three rows and seeing two.
 *
 * The quick-add no longer adds. It OPENS THE SHEET, and that is the important
 * change rather than a cosmetic one: the old button silently chose the default
 * cut and the minimum weight, which for a shop whose whole proposition is
 * "cut to order, billed on actual weight" is the two decisions that matter
 * being made for the customer. One tap still, but it now asks.
 *
 * ── WHAT DELIBERATELY DID NOT CHANGE ──────────────────────────────────────
 *
 * Every card is the same shape and every price sits on the same baseline. A
 * product grid's entire job is COMPARABILITY; asymmetric cards and staggered
 * aspect ratios are what make a landing page feel designed and exactly what
 * stops a customer comparing two prices at a glance. VARIANCE stays at 4 here
 * even though the marketing surfaces run at 7.
 */

export function HotPill({ locale, compact = false }: { locale: Locale; compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-hot font-semibold uppercase tracking-[0.06em] text-hot-ink ${
        compact ? 'px-2 py-0.5 text-[0.625rem]' : 'px-2.5 py-1 text-[0.6875rem]'
      }`}
      // The glyph is decoration; the words carry the meaning. Colour alone was
      // never an accessible way to express a food-safety constraint.
      title={t(locale, 'handling.hotExplainer')}
    >
      <FlameIcon size={compact ? 11 : 12} weight="fill" aria-hidden />
      {t(locale, 'handling.hotPillLabel')}
    </span>
  );
}

export interface CardItem {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly imagePath: string | null;
  readonly handling: string;
  readonly pricingMode: 'pack' | 'perKg';
  readonly unitPriceCents: number;
  readonly minOrderG: number;
  readonly stepG: number;
  readonly packMaxG: number | null;
  readonly availableG: number | null;
  readonly preps: readonly { id: string; label: string }[];
}

export function ProductCard({
  item,
  locale,
  priority = false,
}: {
  item: CardItem;
  locale: Locale;
  /** True for the first row only. Sets `next/image` priority for LCP. */
  priority?: boolean;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const favourites = useFavourites();

  const perKg = item.pricingMode === 'perKg';
  const soldOut = item.availableG !== null && item.availableG < item.minOrderG;
  const notDeclared = item.availableG === null;
  /*
   * "Nearly gone" is three units or three minimum-orders left. Deliberately
   * relative to the product rather than an absolute weight: three lobsters and
   * three kilos of cod are both "almost out", and 500 g means opposite things
   * for a $9 fillet and a $90 tuna loin.
   */
  const scarce = !soldOut && item.availableG !== null && item.availableG < item.minOrderG * 3;
  const favourite = isFavourite(favourites, item.id);

  const sheetProduct: SheetProduct = {
    productId: item.id,
    slug: item.slug,
    name: item.name,
    description: item.description,
    imagePath: item.imagePath,
    handling: item.handling,
    pricingMode: item.pricingMode,
    unitPriceCents: item.unitPriceCents,
    minOrderG: item.minOrderG,
    stepG: item.stepG,
    availableG: item.availableG,
    preps: item.preps,
  };

  return (
    <>
      <article className="group relative flex h-full flex-col">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-soft">
          {item.imagePath !== null && (
            <Image
              src={item.imagePath}
              alt=""
              fill
              // Matches the grid below: 2 columns to 1024, 3 to 1280, 4 above.
              // Getting this wrong is how a 360px phone downloads a 1280px photo.
              sizes="(max-width: 639px) 50vw, (max-width: 1023px) 50vw, (max-width: 1279px) 33vw, 25vw"
              priority={priority}
              className={`object-cover transition-transform duration-500 ease-brand group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${
                soldOut ? 'opacity-45 saturate-[0.4]' : ''
              }`}
            />
          )}

          <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1">
            {item.handling === 'COOKED_HOT' && <HotPill locale={locale} compact />}
            {soldOut && (
              <span className="rounded-full bg-surface/95 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-ink">
                {t(locale, 'shop.soldOut')}
              </span>
            )}
            {scarce && (
              <span className="rounded-full bg-danger px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-danger-ink">
                {t(locale, 'shop.nearlyGone')}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => toggleFavourite(item.id)}
            aria-pressed={favourite}
            aria-label={t(locale, favourite ? 'shop.unfavourite' : 'shop.favourite', {
              name: item.name,
            })}
            className="
              absolute right-2 top-2 grid size-9 place-items-center rounded-full bg-surface/90
              text-ink backdrop-blur-sm transition-transform duration-200 ease-brand
              hover:bg-surface active:scale-[0.9]
            "
          >
            <HeartIcon
              size={16}
              weight={favourite ? 'fill' : 'regular'}
              aria-hidden
              className={favourite ? 'text-danger' : 'text-muted'}
            />
          </button>

          {/*
            The quick-add sits on the image, half-overlapping its bottom edge,
            so it reads as belonging to the photo rather than to the text
            block. 44px, because it is the most-tapped control on the page.
          */}
          {!soldOut && (
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-label={`${t(locale, 'product.addToBasket')}: ${item.name}`}
              className="
                absolute -bottom-3 right-2 grid size-11 place-items-center rounded-full
                bg-accent text-accent-ink shadow-[0_4px_14px_-4px_rgb(3_25_35/0.5)]
                transition-transform duration-200 ease-brand hover:scale-[1.06]
                active:scale-[0.94]
              "
            >
              <PlusIcon size={19} weight="bold" aria-hidden />
            </button>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-0.5 pt-3">
          {/*
            ⚠ `pr-12` IS ON THE TITLE ALONE. The quick-add overhangs the bottom
            of the photo by half its height, so it covers the first line of
            text and nothing below it. Reserving that gutter down the whole
            block cost the price and the stock line 48px they had no reason to
            give up, and at a 164px card that is the difference between
            "9.75 kg left today" fitting on one line and wrapping onto two.
          */}
          <h3 className="!font-sans !text-body !leading-snug !tracking-normal !pb-0 pr-12 font-semibold">
            {/*
              ⚠ Manrope, not Bodoni, and the overrides say so loudly. `h3`
              carries the display face and a 28px floor from the base layer,
              which is right for a section heading and wrong for a card title
              in a 164px column. A didone at 16px has no hairlines left.
            */}
            <Link
              href={`/${locale}/p/${item.slug}`}
              className="after:absolute after:inset-0 hover:underline hover:underline-offset-4"
            >
              {item.name}
            </Link>
          </h3>

          <p className="tnum text-body font-semibold">
            {perKg ? ratePerKg(item.unitPriceCents, locale) : money(item.unitPriceCents, locale)}
          </p>

          {/*
            One meta line, dot-separated, in the delivery-app register: what
            you are buying, and what is left. Never more than two facts.
          */}
          <p className="text-meta text-muted">
            {perKg
              ? t(locale, 'product.estimated')
              : item.packMaxG !== null
                ? weight(item.packMaxG, locale)
                : weight(item.minOrderG, locale)}
            {!notDeclared && !soldOut && (
              <>
                {' · '}
                {t(locale, 'shop.leftToday', {
                  amount: weight(item.availableG ?? 0, locale),
                })}
              </>
            )}
          </p>
        </div>
      </article>

      {sheetOpen && (
        <ItemSheet product={sheetProduct} locale={locale} onClose={() => setSheetOpen(false)} />
      )}
    </>
  );
}

/** Shaped like the real card, never a spinner. Used by `loading.tsx`. */
export function ProductCardSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="aspect-[4/3] w-full animate-pulse rounded-md bg-soft motion-reduce:animate-none" />
      <div className="flex flex-1 flex-col gap-2 pt-3">
        <div className="h-4 w-4/5 animate-pulse rounded-sm bg-soft motion-reduce:animate-none" />
        <div className="h-4 w-1/2 animate-pulse rounded-sm bg-soft motion-reduce:animate-none" />
        <div className="h-3 w-2/3 animate-pulse rounded-sm bg-soft motion-reduce:animate-none" />
      </div>
    </div>
  );
}
