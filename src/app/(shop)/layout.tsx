import { openingHours, shopLocality, shopName, shopPostalCode, shopRegion, shopStreet, siteOrigin } from '@/ui/shop-config';

import { ShopFooter, ShopHeader } from './_components/shop-shell';

/**
 * The storefront shell.
 *
 * `LocalBusiness` markup lives here rather than on the home page alone,
 * because for a single-location shop the map pack often outperforms the site
 * itself, and every page is a possible entry point from search.
 *
 * ⚠ Every value in it comes from the environment. The shop's real name,
 * address and hours are client data and this repository is public.
 */
export default function ShopLayout({ children }: { children: React.ReactNode }) {
  const origin = siteOrigin();

  const localBusiness = {
    '@context': 'https://schema.org',
    '@type': 'Butcher',
    '@id': `${origin}/#shop`,
    name: shopName(),
    url: origin,
    address: {
      '@type': 'PostalAddress',
      streetAddress: shopStreet(),
      addressLocality: shopLocality(),
      addressRegion: shopRegion(),
      postalCode: shopPostalCode(),
      addressCountry: 'CA',
    },
    currenciesAccepted: 'CAD',
    openingHours: openingHours(),
    // Delivery only, no walk-in trade. Saying so in the markup is the
    // difference between ranking for "butcher near me" and disappointing
    // everyone who drives over.
    availableDeliveryMethod: 'http://purl.org/goodrelations/v1#DeliveryModeOwnFleet',
  };

  return (
    <>
      <script
        type="application/ld+json"
        // The payload is built from environment values above, not from user
        // input, and JSON.stringify escapes what it contains.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusiness) }}
      />
      <div className="flex min-h-[100dvh] flex-col">
        <ShopHeader />
        <div className="flex-1">{children}</div>
        <ShopFooter />
      </div>
    </>
  );
}
