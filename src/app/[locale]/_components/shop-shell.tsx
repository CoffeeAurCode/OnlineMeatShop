import Link from 'next/link';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/ssr';

import { t, type Locale } from '@/i18n';
import { shopName } from '@/ui/shop-config';

import { AddressPill } from './address-pill';
import { BasketButton } from './basket-button';
import { LocaleSwitch } from './locale-switch';

/**
 * The storefront's shared furniture.
 *
 * ⭐ REBUILT AROUND THE ADDRESS. The header used to be a wordmark and four nav
 * links; it is now a delivery toolbar, in the order a delivery app puts one:
 * who you are buying from, where it is going, what you are looking for, what
 * is in the basket.
 *
 * ⚠ THE ORDER IS THE ARGUMENT, and the address is second on purpose. This shop
 * cannot sell anything to somebody outside its radius, so the address is not a
 * checkout field that happens to appear early: it is the qualifier for
 * everything below it. Every fee, every free-delivery nudge and every slot on
 * the site is either honest or hypothetical depending on whether that pill is
 * filled in.
 *
 * ── TWO ROWS ON A PHONE, ONE FROM `sm` UP, AND THE GATE IS WHY ────────────
 *
 * ⚠ THE FIRST CUT OF THIS PUT EVERYTHING ON ONE ROW AND IT OVERFLOWED. The
 * responsive sweep measured the document at 402px against a 360px viewport, on
 * every page, in both locales and both colour schemes, and named the culprit:
 * the right-hand cluster is `shrink-0` (correctly — a basket counter that
 * squashes is worse than one that wraps), so the overflow had nowhere to go.
 *
 * The arithmetic does not fit and no amount of tightening makes it: a
 * legible wordmark is about 90px, a useful address is about 100px, and the
 * locale toggle, search and basket are about 160px between them. That is
 * 350px of content plus gaps in a 360px viewport with 32px of page padding.
 *
 * So the address gets its own full-width row below 640px, which is better than
 * the compromise anyway: it is the most-tapped control on the site and it can
 * finally show a whole street name. The bar is 56px + 48px on a phone and a
 * single 72px row on everything else, which keeps the desktop cap.
 */

export function ShopHeader({ locale }: { locale: Locale }) {
  const home = `/${locale}`;

  return (
    <header className="storefront-header sticky top-0 z-40 border-b border-line">
      <div className="mx-auto max-w-[80rem] px-4 sm:px-6">
        <nav
          className="flex h-14 items-center gap-2 sm:h-[4.5rem] sm:gap-4"
          aria-label={t(locale, 'nav.menu')}
        >
          <Link href={home} className="flex min-w-0 shrink items-center sm:shrink-0">
            {/*
              The wordmark is the one place Bodoni is allowed below a heading
              size, because it IS the brand mark rather than text set in the
              display face. It is still 28px at the small end.
            */}
            <span className="display truncate !pb-0 !text-display">{shopName()}</span>
          </Link>

          <span aria-hidden className="hidden h-6 w-px shrink-0 bg-line md:block" />

          {/* One row from `sm` up. Below that it lives in the strip underneath. */}
          <div className="hidden min-w-0 sm:block">
            <AddressPill locale={locale} />
          </div>

          {/*
            The search box is a real form on a laptop and a link to the search
            page on a phone. A 44px input squeezed between a shop name and a
            basket counter is a field nobody can type in, and the page it leads
            to has the same input at full width.
          */}
          <form
            action={`${home}/search`}
            method="get"
            role="search"
            className="relative ml-auto hidden min-w-0 max-w-[22rem] flex-1 lg:block"
          >
            <label htmlFor="header-q" className="sr-only">
              {t(locale, 'nav.search')}
            </label>
            <MagnifyingGlassIcon
              size={17}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              id="header-q"
              name="q"
              type="search"
              placeholder={t(locale, 'nav.searchPlaceholder')}
              // ⚠ `bg-raised`, not `bg-soft`. Cream is a SECTION-BAND colour in this
              // token layer and is explicitly not for text backgrounds; a form field
              // on it reads as disabled, which is precisely the wrong signal on the
              // one control that invites typing.
              className="tap w-full rounded-full border border-line bg-raised pl-9 pr-3 text-meta text-ink placeholder:text-muted"
            />
          </form>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2 lg:ml-0">
            <Link
              href={`${home}/shop`}
              className="nav-link tap hidden items-center text-meta font-semibold xl:inline-flex"
            >
              {t(locale, 'nav.shop')}
            </Link>
            <Link
              href={`${home}/orders`}
              className="nav-link tap hidden items-center text-meta xl:inline-flex"
            >
              {t(locale, 'nav.myOrders')}
            </Link>
            <LocaleSwitch current={locale} />
            <BasketButton locale={locale} />
          </div>
        </nav>

        {/* The phone-only address row. `sm:hidden`, paired with the block above. */}
        <div className="flex min-w-0 items-center gap-2 pb-2 sm:hidden">
          <div className="min-w-0 flex-1">
            <AddressPill locale={locale} full />
          </div>
          <Link
            href={`${home}/search`}
            aria-label={t(locale, 'nav.search')}
            className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-raised text-ink"
          >
            <MagnifyingGlassIcon size={17} aria-hidden />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function ShopFooter({ locale }: { locale: Locale }) {
  const home = `/${locale}`;

  return (
    <footer className="mt-20 bg-accent-solid text-accent-solid-ink">
      <div className="mx-auto max-w-[80rem] px-4 py-14 sm:px-6 sm:py-20">
        <div className="grid gap-12 border-b border-white/25 pb-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="display max-w-[14ch] !text-display-xl">{t(locale, 'footer.heading')}</p>
            <p className="mt-5 max-w-[46ch] text-body text-white/75">{t(locale, 'footer.body')}</p>
          </div>
          <nav className="grid content-start gap-4 text-body lg:justify-self-end">
            <Link className="underline-offset-4 hover:underline" href={`${home}/shop`}>
              {t(locale, 'nav.shop')}
            </Link>
            <Link className="underline-offset-4 hover:underline" href={`${home}/delivery`}>
              {t(locale, 'nav.delivery')}
            </Link>
            <Link className="underline-offset-4 hover:underline" href={`${home}/how-weighing-works`}>
              {t(locale, 'nav.howItWorks')}
            </Link>
            <Link className="underline-offset-4 hover:underline" href={`${home}/orders`}>
              {t(locale, 'nav.myOrders')}
            </Link>
          </nav>
        </div>
        <div className="grid gap-4 pt-6 text-meta text-white/65 sm:grid-cols-2">
          <p className="font-semibold text-white">{shopName()}</p>
          <p className="sm:text-right">{t(locale, 'footer.priceNote')}</p>
        </div>
      </div>
    </footer>
  );
}
