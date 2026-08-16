import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';

import { LOCALES, htmlLang, isLocale, t } from '@/i18n';
import { CustomerSessionProvider } from '@/ui/customer-session';
import { shopName, siteOrigin } from '@/ui/shop-config';

import '../globals.css';
import { CartDrawer } from './_components/cart-drawer';
import { LocationSheet } from './_components/location-sheet';
import { SignInSheet } from './_components/sign-in-sheet';
import { ShopFooter, ShopHeader } from './_components/shop-shell';

/**
 * ⭐ THE STOREFRONT'S ROOT LAYOUT. It renders `<html>` and `<body>`.
 *
 * There is deliberately NO `src/app/layout.tsx`. This app has two root layouts
 * (the other is the console's) because it is genuinely two products that share
 * a token layer and nothing else, and because of a concrete constraint:
 *
 * ⚠ `<html lang>` MUST CHANGE WITH THE LOCALE. A French page announcing itself
 * as `en-CA` is read aloud by a screen reader in an English voice and is
 * indexed as English. Only a root layout can render `<html>`, and only a
 * layout INSIDE `[locale]` knows the locale, so the root layout has to be this
 * one. The alternative, reading a header in a shared root layout, would make
 * every page dynamic and lose the static rendering the storefront's SEO
 * depends on.
 *
 * Navigating between the two roots is a full page load. That is correct here:
 * nobody walks from the shopfront into the console mid-session.
 */

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // No `maximumScale`. A zoom lock is hostile, and this is a shop with a lot
  // of small print about weights.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#031923' },
  ],
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const l = isLocale(locale) ? locale : 'fr';

  return {
    title: { default: `${shopName()} · ${t(l, 'nav.tagline')}`, template: `%s · ${shopName()}` },
    description: t(l, 'home.heroBody'),
    // Both locales point at each other, plus `x-default`. Without this a
    // bilingual site competes with itself in search rather than consolidating.
    alternates: {
      languages: {
        'en-CA': '/en',
        'fr-CA': '/fr',
        'x-default': '/fr',
      },
    },
  };
}

/**
 * Both locales are known at build time, so both are prerendered. This is what
 * lets the catalog pages stay static.
 */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleRootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // A path like `/de/shop` reaches here with an unknown segment. 404 rather
  // than silently falling back, or `/anything` becomes a duplicate of the home
  // page at an infinite number of URLs.
  if (!isLocale(locale)) notFound();

  return (
    <html lang={htmlLang(locale)}>
      <head>
        <link
          rel="preload"
          href="/fonts/manrope-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/bodoni-moda-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        {/*
          ⭐ THE SHOP NODE, SITE-WIDE. Every product page's Offer names this as
          its `seller` by `@id`, so defining it on the home page alone would
          leave that reference dangling on the 74 pages that actually matter
          for search.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Store',
              '@id': `${siteOrigin()}/#shop`,
              name: shopName(),
              url: `${siteOrigin()}/${locale}`,
              currenciesAccepted: 'CAD',
            }),
          }}
        />
        <a
          href="#main"
          className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[100] focus-visible:rounded-sm focus-visible:bg-raised focus-visible:px-4 focus-visible:py-3 focus-visible:text-body focus-visible:font-semibold"
        >
          {t(locale, 'nav.skipToContent')}
        </a>
        {/*
          ⭐ THE SESSION PROVIDER WRAPS THE WHOLE TREE, INCLUDING THE HEADER.

          It holds no credential — that is an `httpOnly` cookie the browser
          sends by itself and JavaScript cannot read. What it holds is the
          cached ANSWER to "am I signed in", so the header, the checkout button
          and the sign-in sheet all agree without three separate round trips.

          ⚠ It is a Client Component boundary, and it is placed here rather
          than around each consumer for a specific reason: the sheet is opened
          from checkout and its result has to be visible to the header at the
          same instant. Two providers would be two caches, and the one that did
          not hear about the sign-in would keep saying "sign in".
        */}
        <CustomerSessionProvider>
          <div className="flex min-h-[100dvh] flex-col">
            <ShopHeader locale={locale} />
            <main id="main" className="flex-1">
              {children}
            </main>
            <ShopFooter locale={locale} />
          </div>
          {/*
            Every overlay is mounted once at the root rather than per page, so
            opening one never unmounts the page behind it and a customer can
            keep browsing with one open. Each renders nothing until it is
            opened, and `drawer-state` guarantees only one of them ever is.
          */}
          <CartDrawer locale={locale} />
          <LocationSheet locale={locale} />
          <SignInSheet locale={locale} />
        </CustomerSessionProvider>
      </body>
    </html>
  );
}
