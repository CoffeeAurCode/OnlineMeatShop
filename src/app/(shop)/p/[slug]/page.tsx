import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog, productBySlug } from '@/db/repositories/catalog';
import { decimalString, money, weight } from '@/ui/format';
import { shopName, siteOrigin } from '@/ui/shop-config';

import { AddToBasket } from '../../_components/add-to-basket';
import { PriceLine, ProductTile, handlingLabel } from '../../_components/shop-shell';

/**
 * One product.
 *
 * ⭐ The price and today's availability are IN THE HTML, not fetched after
 * load. That is the whole SEO argument for this stack (`04-PLAN` §5): a
 * client-rendered product page is near-invisible to a crawler, which is
 * affordable for a national brand buying traffic and fatal for a single shop
 * living on local organic search.
 */

export const revalidate = 60;

export async function generateStaticParams() {
  // Slugs only. The prices and quantities on these pages are re-read at
  // request time; pre-rendering the paths just avoids a cold render.
  const catalog = await listCatalog(null);
  return catalog.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const found = await productBySlug(slug, null);
  if (found === null) return { title: 'Not found' };

  const { item } = found;
  const price =
    item.pricing.mode === 'perKg'
      ? `${money(item.pricing.ratePerKg)} per kg`
      : `${money(item.pricing.price)} a pack`;

  return {
    title: `${item.name} · ${shopName()}`,
    description:
      item.description ??
      `${item.name}, ${price}. ${item.pricing.mode === 'perKg' ? 'Cut to order and charged on the exact weight.' : 'Fixed price.'} Delivered locally.`,
    alternates: { canonical: `${siteOrigin()}/p/${item.slug}` },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const day = await currentBusinessDay();
  const found = await productBySlug(slug, day?.id ?? null);
  if (found === null) notFound();

  const { item, preps } = found;
  const origin = siteOrigin();
  const soldOut = item.availableG !== null && item.availableG === 0;
  const notToday = item.availableG === null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: item.name,
    description: item.description ?? undefined,
    url: `${origin}/p/${item.slug}`,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'CAD',
      // Per-kg products are advertised at their rate, with the unit stated, so
      // the markup cannot be read as a price for the whole item.
      price: decimalString(
        item.pricing.mode === 'perKg' ? item.pricing.ratePerKg : item.pricing.price,
      ),
      ...(item.pricing.mode === 'perKg'
        ? { priceSpecification: { '@type': 'UnitPriceSpecification', referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'KGM' } } }
        : {}),
      availability:
        notToday || soldOut
          ? 'https://schema.org/OutOfStock'
          : 'https://schema.org/InStock',
      seller: { '@id': `${origin}/#shop` },
    },
  };

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Shop', item: `${origin}/shop` },
      { '@type': 'ListItem', position: 2, name: item.name, item: `${origin}/p/${item.slug}` },
    ],
  };

  return (
    <main className="mx-auto max-w-[68rem] px-4 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <ProductTile name={item.name} handling={item.handling} ratio="wide" />
        </div>

        <div>
          <p className="text-meta text-muted">{handlingLabel(item.handling)}</p>
          <h1 className="mt-1 text-display font-semibold tracking-tight">{item.name}</h1>

          <div className="mt-4 text-lead">
            <PriceLine pricing={item.pricing} />
          </div>

          {item.description !== null ? (
            <p className="mt-4 max-w-[60ch] text-body text-muted">{item.description}</p>
          ) : null}

          <p className="mt-4 text-body text-muted">
            {notToday
              ? 'Not out today. Stock is declared each trading morning.'
              : soldOut
                ? 'Gone for today.'
                : `${weight(item.availableG ?? 0)} left today.`}
          </p>

          {item.handling === 'COOKED_HOT' ? (
            <p className="mt-4 rounded-sm bg-hot-wash px-3 py-3 text-body text-hot">
              Hot food limits your whole order to a delivery slot we can get it to you hot in. That
              is a food-safety rule.
            </p>
          ) : null}

          {item.pricing.mode === 'perKg' ? (
            <p className="mt-6 max-w-[60ch] text-body">
              Cut to order, so the final weight decides the price. We hold the estimate and charge
              the exact amount once it is weighed.
            </p>
          ) : null}

          <div className="mt-8">
            <AddToBasket
              productId={item.id}
              slug={item.slug}
              name={item.name}
              pricing={item.pricing}
              preps={preps}
              disabled={notToday || soldOut}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
