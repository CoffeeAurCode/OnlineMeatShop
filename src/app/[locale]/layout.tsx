import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';

import { LOCALES, htmlLang, isLocale, t } from '@/i18n';
import { CustomerSessionProvider } from '@/ui/customer-session';
import { readShopIdentity } from '@/db/repositories/settings';
import { formatPostalCode } from '@/domain/serviceability';
import { hasAddress, openingHoursSpecification } from '@/domain/shop';
import { shopName, siteOrigin } from '@/ui/shop-config';

import '../globals.css';
import { BottomNav } from './_components/bottom-nav';
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

  /*
   * ⭐ ONE READ OF THE SHOP'S OWN DETAILS, HERE, FOR THE WHOLE STOREFRONT.
   *
   * The `Store` node below and the footer both need it, and both render on
   * every page. Reading it in each would be two queries per page for two
   * copies of the same seven values.
   *
   * ⚠ THIS LAYOUT PRERENDERS. `readShopIdentity` therefore swallows a database
   * failure into an empty identity instead of throwing: `next build` runs
   * against an unreachable database in CI on purpose, and an unguarded read
   * here would turn that into a failed deployment of otherwise correct code.
   * `/api/admin/shop` calls `revalidatePath` on save, so an edit reaches these
   * pages without waiting for a deploy.
   */
  const identity = await readShopIdentity();
  const hours = openingHoursSpecification(identity.hours);

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
              /*
                ⚠ EVERY FIELD BELOW IS OMITTED WHEN UNSET, never emitted empty.
                A `PostalAddress` with blank streets is worse than no address
                at all: Google reads it, finds nothing, and the shop competes
                with its own incomplete listing.
              */
              ...(hasAddress(identity)
                ? {
                    address: {
                      '@type': 'PostalAddress',
                      streetAddress: identity.street,
                      addressLocality: identity.locality,
                      addressRegion: identity.region,
                      // ⚠ THE DISPLAY FORM, WITH THE SPACE. `H3K1W6` is how it
                      // is stored so that two spellings cannot become two
                      // values; `H3K 1W6` is how Canada Post writes it and
                      // what a consumer of this node should be handed.
                      postalCode: formatPostalCode(identity.postalCode),
                      addressCountry: 'CA',
                    },
                  }
                : {}),
              ...(identity.phone === '' ? {} : { telephone: identity.phone }),
              ...(hours.length === 0 ? {} : { openingHoursSpecification: hours }),
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
          {/*
            ⚠ THE BOTTOM PADDING IS NOT DECORATION — the tab bar is `fixed`, so
            without it the bar sits on top of the last ~64px of every page, and
            what it covers is the footer, which is where `delivery` and
            `how-weighing-works` live. It clears at `lg`, where the bar hides.
          */}
          <div className="flex min-h-[100dvh] flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0">
            <ShopHeader locale={locale} />
            <main id="main" className="flex-1">
              {children}
            </main>
            <ShopFooter locale={locale} identity={identity} />
          </div>
          <BottomNav locale={locale} />
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
