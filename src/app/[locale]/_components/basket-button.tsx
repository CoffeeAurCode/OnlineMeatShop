'use client';

import { BasketIcon } from '@phosphor-icons/react/dist/ssr';

import { t, type Locale } from '@/i18n';
import { useCart } from '@/ui/cart';

import { openCart } from './drawer-state';

/**
 * The header's basket control: a count, and the thing that opens the drawer.
 *
 * The count renders as blank rather than as `0` until the store has read
 * `localStorage`. `cart.ready` exists for exactly this: the server cannot know
 * the basket, so a confident `0` in the server HTML would flash to `3` on
 * hydration, and it would do it on the one element a customer is watching to
 * confirm their order survived a page load.
 */
export function BasketButton({ locale }: { locale: Locale }) {
  const cart = useCart();
  const count = cart.lines.length;

  return (
    <button
      type="button"
      onClick={openCart}
      className="tap inline-flex items-center gap-2 rounded-sm border border-line bg-raised px-3 text-body font-semibold transition-[transform,border-color] duration-(--duration-fast) ease-brand hover:border-accent active:scale-[0.98]"
      aria-label={
        cart.ready && count > 0
          ? `${t(locale, 'nav.openBasket')}, ${t(locale, count === 1 ? 'basket.itemCountOne' : 'basket.itemCount', { count })}`
          : t(locale, 'nav.openBasket')
      }
    >
      <BasketIcon size={18} aria-hidden />
      <span className="hidden sm:inline">{t(locale, 'nav.basket')}</span>
      <span
        className="tnum grid min-w-6 place-items-center rounded-full bg-accent px-1.5 py-0.5 text-[0.6875rem] font-bold text-accent-ink"
        aria-hidden="true"
      >
        {cart.ready ? count : ''}
      </span>
    </button>
  );
}
