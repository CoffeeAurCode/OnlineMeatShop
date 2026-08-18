'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { HeartIcon, PlusIcon } from '@phosphor-icons/react/dist/ssr';

import type { Locale } from '@/i18n';
import { t } from '@/i18n';
import { isFavourite, toggleFavourite, useFavourites } from '@/ui/favourites';
import { pricePerUnit, ratePerKg, weight } from '@/ui/format';

import { FallbackTile, HandlingLabel } from './handling';
import { ItemSheet, type SheetProduct } from './item-sheet';

/**
 * ⭐ THE UNIT THE GRID IS MADE OF.
 *
 * ── THE SCAN ORDER IS THE SPEC, AND IT IS NOT NEGOTIABLE ──────────────────
 *
 * The design system numbers it: image, handling, save, name, price and unit,
 * availability, add. Every one of those is a question a customer asks in that
 * order, and the card is laid out in that order rather than in the order the
 * data happened to arrive.
 *
 * ── WHAT MOVED OFF THE PHOTOGRAPH, AND WHY ────────────────────────────────
 *
 * The card used to carry three things on top of the image: a hot pill, a
 * sold-out badge and a "nearly gone" badge, plus a floating quick-add
 * overhanging its bottom edge. All of that is now BELOW the image, and there
 * are two separate reasons.
 *
 * ⚠ THE FIRST IS LEGIBILITY. "Do not put important copy or pills over busy
 * food photography." A translucent chip on a plate of shellfish is legible in
 * the mock-up and unreadable on the one photograph where the highlights land
 * under it, and "Sold out today" is exactly the sentence that must not be the
 * one that fails.
 *
 * 🔴 THE SECOND IS A REAL DEFECT AND IT WAS SILENT. The card title carries a
 * stretched link (`after:absolute after:inset-0`) so the whole card is a click
 * target. That pseudo-element is absolutely positioned, has no `z-index`, and
 * sits LATER IN THE DOM than the favourite and quick-add buttons, which are
 * also absolutely positioned with no `z-index`. Painting order within a
 * stacking context is tree order, so the invisible overlay was drawn ON TOP OF
 * BOTH BUTTONS: tapping the heart or the plus opened the product page instead.
 * Nothing catches this. It typechecks, it lints, it renders correctly in a
 * screenshot, and it fails only under a finger.
 *
 * The favourite control now carries `relative z-10` to sit above the overlay,
 * and the add control is placed after the link in the tree, where it is above
 * it for free. **If you add another control to this card, one of those two is
 * the pattern to copy.**
 *
 * ── WHAT DELIBERATELY DID NOT CHANGE ──────────────────────────────────────
 *
 * Every card is the same shape and every price sits on the same baseline. A
 * product grid's entire job is COMPARABILITY; asymmetric cards and staggered
 * aspect ratios are what make a landing page feel designed and exactly what
 * stops a customer comparing two prices at a glance. VARIANCE stays at 4 here
 * even though the marketing surfaces run at 7.
 */

export interface CardItem {
  readonly id: string;
  /**
   * Which counter it belongs to, so the catalog can band its rows by section.
   * ⚠ NULLABLE: a product may sit outside every category, and one that does
   * still has to appear on the page — see the orphan branch in `GridList`.
   */
  readonly categoryId: string | null;
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

/**
 * A card's props are a superset of the sheet's. Written once, because two
 * copies of this mapping diverge the first time the sheet needs a new field
 * and only one caller is updated — and the symptom is a sheet that opens with
 * the wrong minimum weight from one surface and the right one from the other.
 */
function toSheetProduct(item: CardItem): SheetProduct {
  return {
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

  const sheetProduct = toSheetProduct(item);

  return (
    <>
      <article className="group relative flex h-full flex-col gap-1">
        {/* 1. The photograph, or an honest tile in its place. */}
        <div className="relative mb-2 aspect-[4/3] w-full overflow-hidden rounded-md bg-soft">
          {item.imagePath === null ? (
            <FallbackTile name={item.name} handling={item.handling} locale={locale} />
          ) : (
            <Image
              src={item.imagePath}
              alt=""
              fill
              // Matches the grid below: 2 columns to 1024, 3 to 1280, 4 above.
              // Getting this wrong is how a 360px phone downloads a 1280px photo.
              sizes="(max-width: 639px) 50vw, (max-width: 1023px) 50vw, (max-width: 1279px) 33vw, 25vw"
              priority={priority}
              className={`object-cover transition-transform duration-(--duration-image) ease-brand group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${
                soldOut ? 'opacity-45 saturate-[0.4]' : ''
              }`}
            />
          )}

          {/*
            3. Save. The one control the system allows on top of the image,
            because it is a control rather than copy: it carries its meaning in
            its shape and its `aria-pressed` state, not in a word that has to
            stay readable over a photograph.

            ⚠ `z-10` IS LOAD-BEARING. See the header of this file.
          */}
          <button
            type="button"
            onClick={() => toggleFavourite(item.id)}
            aria-pressed={favourite}
            aria-label={t(locale, favourite ? 'shop.unfavourite' : 'shop.favourite', {
              name: item.name,
            })}
            className="
              absolute right-2 top-2 z-10 grid size-10 place-items-center rounded-full
              bg-surface text-ink transition-transform duration-(--duration-fast)
              ease-brand hover:bg-soft active:scale-[0.9]
            "
          >
            <HeartIcon
              size={16}
              weight={favourite ? 'fill' : 'regular'}
              aria-hidden
              className={favourite ? 'text-danger' : 'text-muted'}
            />
          </button>
        </div>

        {/* 2. Handling, in words, before the name. */}
        <HandlingLabel handling={item.handling} locale={locale} />

        {/* 4. The name, and the link that makes the whole card a target. */}
        <h3 className="!font-sans !text-body !leading-snug !tracking-normal !pb-0 font-semibold">
          {/*
            ⚠ Manrope, not Bodoni, and the overrides say so loudly. `h3`
            carries the display face and a 28px floor from the base layer,
            which is right for a section heading and wrong for a card title in
            a 164px column. A didone at 16px has no hairlines left.
          */}
          <Link
            href={`/${locale}/p/${item.slug}`}
            className="after:absolute after:inset-0 hover:underline hover:underline-offset-4"
          >
            {item.name}
          </Link>
        </h3>

        {/*
          5. Price AND UNIT. ⚠ NEVER A BARE AMOUNT.
          "$18.99" against a pack of scallops and "$18.99" against a kilo of
          cod are the same three characters and completely different offers.
          Both modes state their unit, in the same position, so the column is
          comparable at a glance.
        */}
        <p className="tnum text-body font-semibold">
          {perKg
            ? ratePerKg(item.unitPriceCents, locale)
            : pricePerUnit(item.unitPriceCents, t(locale, 'product.unitPack'), locale)}
        </p>

        {/*
          6. Availability, and 7. the add control, on one row. The add sits
          last in the tree, which is what puts it above the stretched link
          without needing a `z-index` of its own.
        */}
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <p className="min-w-0 text-meta text-muted">
            {soldOut ? (
              <span className="font-semibold text-ink">{t(locale, 'shop.soldOut')}</span>
            ) : (
              <>
                {perKg
                  ? t(locale, 'product.estimated')
                  : item.packMaxG !== null
                    ? weight(item.packMaxG, locale)
                    : weight(item.minOrderG, locale)}
                {!notDeclared && (
                  <>
                    {' · '}
                    <span className={scarce ? 'font-semibold text-ink' : undefined}>
                      {scarce
                        ? t(locale, 'shop.nearlyGone')
                        : t(locale, 'shop.leftToday', {
                            amount: weight(item.availableG ?? 0, locale),
                          })}
                    </span>
                  </>
                )}
              </>
            )}
          </p>

          {!soldOut && (
            <button
              type="button"
              data-parity="add"
              onClick={() => setSheetOpen(true)}
              aria-label={`${t(locale, 'product.addToBasket')}: ${item.name}`}
              className="
                relative z-10 grid size-11 shrink-0 place-items-center rounded-full
                bg-accent text-accent-ink transition-transform duration-(--duration-fast)
                ease-brand hover:scale-[1.06] active:scale-[0.94]
              "
            >
              <PlusIcon size={19} weight="bold" aria-hidden />
            </button>
          )}
        </div>
      </article>

      {sheetOpen && (
        <ItemSheet product={sheetProduct} locale={locale} onClose={() => setSheetOpen(false)} />
      )}
    </>
  );
}

/**
 * ⭐ THE MENU ROW. Figma parity, Phase 4, against `289:1962` Restaurant
 * Details — which is OUR catalog page, because we are the single restaurant.
 *
 * ── WHY THE CATALOG IS A LIST AND THE HOME FEED IS STILL A GRID ───────────
 *
 * The reference draws its menu as rows: name, price, description, and a small
 * square photograph on the right. A card grid and a row list carry the same
 * information; the row carries it in about 110px instead of about 260px, and
 * it has somewhere for the DESCRIPTION to go — which a 164px card column does
 * not, so the grid drops it entirely. On a counter where "Atlantic salmon
 * fillet" and "Atlantic salmon fillet, skin on" are different products, the
 * sentence underneath is the thing that tells them apart.
 *
 * The home feed keeps cards, because the reference's home feed is also cards:
 * it is a browsing surface where the photograph is doing the selling. The
 * catalog is a choosing surface, and there the words are.
 *
 * ⚠ THE Z-INDEX RULE FROM THE CARD APPLIES HERE UNCHANGED. The title carries
 * the stretched link; the favourite button needs `relative z-10` to sit above
 * it, and the add button is placed after the link in the tree. Read the header
 * of this file before adding a third control.
 */
export function ProductRow({
  item,
  locale,
  priority = false,
}: {
  item: CardItem;
  locale: Locale;
  priority?: boolean;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const favourites = useFavourites();

  const perKg = item.pricingMode === 'perKg';
  const soldOut = item.availableG !== null && item.availableG < item.minOrderG;
  const notDeclared = item.availableG === null;
  const scarce = !soldOut && item.availableG !== null && item.availableG < item.minOrderG * 3;
  const favourite = isFavourite(favourites, item.id);

  return (
    <>
      <article className="group relative flex items-start gap-3 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <HandlingLabel handling={item.handling} locale={locale} />

          <h3 className="!font-sans !text-body !leading-snug !tracking-normal !pb-0 font-semibold">
            <Link
              href={`/${locale}/p/${item.slug}`}
              className="after:absolute after:inset-0 hover:underline hover:underline-offset-4"
            >
              {item.name}
            </Link>
          </h3>

          <p className="tnum text-body font-semibold">
            {perKg
              ? ratePerKg(item.unitPriceCents, locale)
              : pricePerUnit(item.unitPriceCents, t(locale, 'product.unitPack'), locale)}
          </p>

          {/*
            The description, clamped to two lines. The reference clamps at
            three at 375px; ours runs to two because our type is a point larger
            and the row has to stay comparable down the column.
          */}
          {item.description !== null && (
            <p className="line-clamp-2 max-w-[52ch] text-meta text-muted">{item.description}</p>
          )}

          <p className="min-w-0 text-meta text-muted">
            {soldOut ? (
              <span className="font-semibold text-ink">{t(locale, 'shop.soldOut')}</span>
            ) : (
              <>
                {perKg
                  ? t(locale, 'product.estimated')
                  : item.packMaxG !== null
                    ? weight(item.packMaxG, locale)
                    : weight(item.minOrderG, locale)}
                {!notDeclared && (
                  <>
                    {' · '}
                    <span className={scarce ? 'font-semibold text-ink' : undefined}>
                      {scarce
                        ? t(locale, 'shop.nearlyGone')
                        : t(locale, 'shop.leftToday', {
                            amount: weight(item.availableG ?? 0, locale),
                          })}
                    </span>
                  </>
                )}
              </>
            )}
          </p>
        </div>

        <div className="relative shrink-0">
          <div className="relative size-24 overflow-hidden rounded-md bg-soft sm:size-28">
            {item.imagePath === null ? (
              <FallbackTile name={item.name} handling={item.handling} locale={locale} compact />
            ) : (
              <Image
                src={item.imagePath}
                alt=""
                fill
                sizes="(max-width: 639px) 96px, 112px"
                priority={priority}
                className={`object-cover transition-transform duration-(--duration-image) ease-brand group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${
                  soldOut ? 'opacity-45 saturate-[0.4]' : ''
                }`}
              />
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
              absolute -left-2 -top-2 z-10 grid size-11 place-items-center rounded-full
              text-ink transition-transform duration-(--duration-fast) ease-brand active:scale-[0.9]
            "
          >
            <span className="grid size-8 place-items-center rounded-full bg-surface elev-card">
              <HeartIcon
                size={15}
                weight={favourite ? 'fill' : 'regular'}
                aria-hidden
                className={favourite ? 'text-danger' : 'text-muted'}
              />
            </span>
          </button>

          {!soldOut && (
            <button
              type="button"
              data-parity="add"
              onClick={() => setSheetOpen(true)}
              aria-label={`${t(locale, 'product.addToBasket')}: ${item.name}`}
              className="
                absolute -bottom-2 -right-2 z-10 grid size-11 place-items-center rounded-full
                bg-accent text-accent-ink transition-transform duration-(--duration-fast)
                ease-brand hover:scale-[1.06] active:scale-[0.94]
              "
            >
              <PlusIcon size={18} weight="bold" aria-hidden />
            </button>
          )}
        </div>
      </article>

      {sheetOpen && (
        <ItemSheet
          product={toSheetProduct(item)}
          locale={locale}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
}

/** Shaped like the real card, never a spinner. Used by `loading.tsx`. */
export function ProductCardSkeleton() {
  const bar = 'animate-pulse rounded-sm bg-soft motion-reduce:animate-none';
  return (
    <div className="flex h-full flex-col gap-1">
      <div className="mb-2 aspect-[4/3] w-full animate-pulse rounded-md bg-soft motion-reduce:animate-none" />
      <div className={`h-3 w-1/3 ${bar}`} />
      <div className={`h-4 w-4/5 ${bar}`} />
      <div className={`h-4 w-1/2 ${bar}`} />
      <div className="mt-auto flex items-end justify-between gap-2 pt-1">
        <div className={`h-3 w-2/3 ${bar}`} />
        <div className="size-11 shrink-0 animate-pulse rounded-full bg-soft motion-reduce:animate-none" />
      </div>
    </div>
  );
}
