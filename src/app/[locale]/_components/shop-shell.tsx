import Link from 'next/link';

import { t, type Locale } from '@/i18n';
import { shopName } from '@/ui/shop-config';

import { BasketButton } from './basket-button';
import { LocaleSwitch } from './locale-switch';

/**
 * The storefront's shared furniture.
 *
 * DENSITY 3 out here, against the console's 7. This half of the app is read
 * once by someone deciding whether to trust the shop; the console is operated
 * forty times a day by someone who already has.
 *
 * The header is a Server Component with two Client islands in it, the basket
 * button and the language toggle. That split is deliberate: making the whole
 * header a Client Component to get one counter would ship the shop name, every
 * nav label and both translations of them into the bundle for no reason.
 */

export function ShopHeader({ locale }: { locale: Locale }) {
  const home = `/${locale}`;

  return (
    <header className="storefront-header sticky top-0 z-40 border-b border-line">
      <nav
        // 72px, inside the 80px cap. A nav bar that eats a tenth of a phone
        // viewport is a nav bar competing with the fish.
        className="mx-auto flex h-[4.5rem] max-w-[76rem] items-center justify-between gap-3 px-4 sm:px-6"
        aria-label={t(locale, 'nav.menu')}
      >
        <Link href={home} className="flex min-w-0 items-center gap-2">
          {/*
            The wordmark is the one place Bodoni is allowed below a heading
            size, because it IS the brand mark rather than text set in the
            display face. It is still 28px at the small end.
          */}
          <span className="display truncate !pb-0 !text-display">{shopName()}</span>
        </Link>

        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          <Link
            href={`${home}/shop`}
            className="nav-link tap hidden items-center text-body font-semibold sm:inline-flex"
          >
            {t(locale, 'nav.shop')}
          </Link>
          <Link
            href={`${home}/delivery`}
            className="nav-link tap hidden items-center text-body md:inline-flex"
          >
            {t(locale, 'nav.delivery')}
          </Link>
          <Link
            href={`${home}/orders`}
            className="nav-link tap hidden items-center text-body md:inline-flex"
          >
            {t(locale, 'nav.myOrders')}
          </Link>
          <LocaleSwitch current={locale} />
          <BasketButton locale={locale} />
        </div>
      </nav>
    </header>
  );
}

export function ShopFooter({ locale }: { locale: Locale }) {
  const home = `/${locale}`;

  return (
    <footer className="mt-24 bg-accent-solid text-accent-solid-ink">
      <div className="mx-auto max-w-[76rem] px-4 py-14 sm:px-6 sm:py-20">
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
