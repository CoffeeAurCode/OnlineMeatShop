'use client';

import { BasketIcon } from '@phosphor-icons/react/dist/ssr';

import { t, type Locale } from '@/i18n';
import { useCart } from '@/ui/cart';

import { openCart } from './drawer-state';

/**
 * The header's basket control: a count, and the thing that opens the drawer.
 *
 * ⭐ THE ONE SOLID-WHITE CONTROL ON THE BAND, and it is the only one that gets
 * to be. The reference top bar gives its cluster exactly one filled focal
 * control and leaves the rest translucent; on a saturated field that is what
 * separates "the thing you press" from "the things that are there". The basket
 * is that control here because it is the end of every path through the shop.
 *
 * ⚠ WHITE FILL WITH A TEAL GLYPH, NOT `bg-accent`. In light mode `--accent`
 * IS `--hero-ground` — an accent-filled button on this band is an invisible
 * button. Both directions of the white/teal pair are 5.36:1, in both schemes,
 * because the band's ground is pinned.
 *
 * The count renders as blank rather than as `0` until the store has read
 * `localStorage`. `cart.ready` exists for exactly this: the server cannot know
 * the basket, so a confident `0` in the server HTML would flash to `3` on
 * hydration, and it would do it on the one element a customer is watching to
 * confirm their order survived a page load.
 *
 * ⚠ THE WORD "BASKET" IS GONE FROM THE FACE OF IT and lives only in the
 * accessible name. The reference's controls are glyphs, the badge already
 * carries the number, and the mobile tab bar still spells the word out under
 * its own basket icon. Nothing that needs the label has lost it.
 */
export function BasketButton({ locale }: { locale: Locale }) {
  const cart = useCart();
  const count = cart.lines.length;
  const showCount = cart.ready && count > 0;

  return (
    <button
      type="button"
      onClick={openCart}
      className="press relative grid size-11 shrink-0 place-items-center rounded-full bg-white text-hero-ground shadow-[0_6px_16px_-8px_rgb(3_25_35/0.55)]"
      aria-label={
        showCount
          ? `${t(locale, 'nav.openBasket')}, ${t(locale, count === 1 ? 'basket.itemCountOne' : 'basket.itemCount', { count })}`
          : t(locale, 'nav.openBasket')
      }
    >
      <BasketIcon size={20} weight="bold" aria-hidden />
      {/*
        ⚠ THE BADGE IS ONLY DRAWN WHEN THERE IS SOMETHING TO COUNT. It sits
        half off the circle, so an always-present `0` would put a permanent
        blister on the one control the eye lands on first.

        The ring is the band colour, not white: it separates the badge from the
        circle it overlaps whichever of the two it happens to cross.
      */}
      {showCount && (
        <span
          className="tnum absolute -right-0.5 -top-0.5 grid min-w-[1.125rem] place-items-center rounded-full bg-hero-ground px-1 text-[0.625rem] font-bold leading-[1.125rem] text-white ring-2 ring-white"
          aria-hidden="true"
        >
          {count}
        </span>
      )}
    </button>
  );
}
