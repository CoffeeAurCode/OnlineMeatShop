'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BasketIcon,
  HouseIcon,
  ReceiptIcon,
  StorefrontIcon,
} from '@phosphor-icons/react/dist/ssr';

import { t, type Locale } from '@/i18n';
import { useCart } from '@/ui/cart';

import { openCart, useCartOpen } from './drawer-state';

/**
 * ⭐ THE PERSISTENT MOBILE TAB BAR. Phase 1 of the Figma parity plan.
 *
 * Modelled on the reference's `Bottom Navigation` component (`622:5018`):
 * icon over a 10px label, the active tab in full ink with a filled icon, the
 * rest muted with an outline icon. The geometry is the reference's; the
 * destinations are ours.
 *
 * ⚠ FOUR TABS, NOT THE REFERENCE'S FIVE, and the missing one is deliberate.
 * The reference runs `Home · Browse · Grocery · Baskets · Account`. `Grocery`
 * is a second vendor type — this is one fishmonger, and rendering a storefront
 * we do not have is exactly the "fake choice" the plan bans. `Account` in the
 * reference carries rewards, promotions, saved payment methods and family
 * accounts, none of which exist here; the only account surface with anything
 * behind it is the order history, so that is what the fourth tab is.
 *
 * See `08-A-figma-frame-inventory.md` §6.1 in the private parent repo for the
 * full mapping and why each reference tab survived or did not.
 *
 * ── WHY THE BASKET IS A BUTTON AND THE OTHER THREE ARE LINKS ──────────────
 *
 * The basket is an overlay, not a route. Making it a `<Link>` to a page we do
 * not have, or to `#`, would break the back button in the one place a customer
 * is most likely to press it. It reads as a tab and behaves as a disclosure,
 * which is what the reference does too — its `Baskets` tab opens a sheet.
 *
 * ⚠ HIDDEN FROM `lg` UP, AND ADDITIVE BELOW IT. The header keeps every
 * destination it had; this bar does not replace it. The footer still carries
 * `delivery` and `how-weighing-works`, which have no tab, so the page must
 * stay scrollable past this bar — hence the bottom padding in the layout.
 */

export function BottomNav({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const cart = useCart();
  const cartOpen = useCartOpen();
  const home = `/${locale}`;

  /*
   * ⚠ `startsWith` on the SEGMENT, not on the string. `/en/shopping` is not
   * `/en/shop`, and a bare `startsWith('/en/shop')` says it is. The trailing
   * boundary check is what stops a future route from lighting the wrong tab.
   */
  const inSection = (base: string) => pathname === base || pathname.startsWith(`${base}/`);

  // The catalog tab owns browsing in all three of its shapes: the counter, a
  // single product, and search. They are one activity to a customer.
  const onShop =
    inSection(`${home}/shop`) || inSection(`${home}/p`) || inSection(`${home}/search`);
  const onOrders = inSection(`${home}/orders`);
  const onHome = pathname === home;

  const count = cart.lines.length;

  return (
    <nav
      aria-label={t(locale, 'nav.primary')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-raised pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto grid max-w-[30rem] grid-cols-4">
        <li>
          <Tab href={home} active={onHome} label={t(locale, 'nav.home')} Icon={HouseIcon} />
        </li>
        <li>
          <Tab
            href={`${home}/shop`}
            active={onShop}
            label={t(locale, 'nav.shop')}
            Icon={StorefrontIcon}
          />
        </li>
        <li>
          <Tab
            active={cartOpen}
            label={t(locale, 'nav.basket')}
            Icon={BasketIcon}
            onClick={openCart}
            /*
              Blank rather than `0` until the cart store has read
              `localStorage`, for the same reason `basket-button` does it: a
              confident `0` in the server HTML flashes to `3` on hydration, on
              the one number a customer is watching.
            */
            badge={cart.ready && count > 0 ? count : null}
            announce={
              cart.ready && count > 0
                ? `${t(locale, 'nav.openBasket')}, ${t(locale, count === 1 ? 'basket.itemCountOne' : 'basket.itemCount', { count })}`
                : t(locale, 'nav.openBasket')
            }
          />
        </li>
        <li>
          <Tab
            href={`${home}/orders`}
            active={onOrders}
            label={t(locale, 'nav.myOrders')}
            Icon={ReceiptIcon}
          />
        </li>
      </ul>
    </nav>
  );
}

type TabProps = {
  active: boolean;
  label: string;
  Icon: typeof HouseIcon;
  href?: string;
  onClick?: () => void;
  badge?: number | null;
  announce?: string;
};

/**
 * One tab. `aria-current="page"` on the links is what tells a screen reader
 * which of four identical-sounding controls it is standing on; the ink change
 * alone says it only to people who can see it.
 */
function Tab({ active, label, Icon, href, onClick, badge, announce }: TabProps) {
  const body = (
    <>
      <span className="relative">
        <Icon size={24} weight={active ? 'fill' : 'regular'} aria-hidden />
        {badge != null && (
          <span
            className="tnum absolute -right-2.5 -top-1.5 grid min-w-[1.125rem] place-items-center rounded-full bg-accent px-1 text-[0.625rem] font-bold leading-4 text-accent-ink"
            aria-hidden="true"
          >
            {badge}
          </span>
        )}
      </span>
      {/*
        10px, from the reference's tab-bar type role. It is below this project's
        normal floor on purpose and only here: the label is a redundant name for
        an icon that already carries the meaning, and every tab also has an
        accessible name that does not depend on reading it.
      */}
      <span className="text-[0.625rem] font-semibold leading-none">{label}</span>
    </>
  );

  const className = `flex min-h-14 w-full flex-col items-center justify-center gap-1 pb-1 pt-2 transition-colors duration-(--duration-fast) ease-brand ${
    active ? 'text-ink' : 'text-muted'
  }`;

  if (href !== undefined) {
    return (
      <Link href={href} aria-current={active ? 'page' : undefined} className={className}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} aria-label={announce} className={className}>
      {body}
    </button>
  );
}
