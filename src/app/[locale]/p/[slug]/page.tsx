import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { currentBusinessDay } from '@/db/repositories/availability';
import {
  listCatalog,
  localisedDescription,
  localisedName,
  prepsForProducts,
  productBySlug,
} from '@/db/repositories/catalog';
import { staticParamsOr } from '@/db/build-time';
import { LOCALES, htmlLang, isLocale, t, type Locale } from '@/i18n';
import { decimalString, money, pricePerUnit, ratePerKg, weight } from '@/ui/format';
import { siteOrigin } from '@/ui/shop-config';

import { AddToBasket } from '../../_components/add-to-basket';
import { ProductGrid } from '../../_components/product-grid';
import { FallbackTile, HandlingLabel, HotPill } from '../../_components/handling';

/**
 * One product. The deep dive, not the only way to buy: the grid's card can add
 * to the basket without ever opening this page.
 *
 * ⭐ The price and today's availability are IN THE HTML, not fetched after
 * load. That is the whole SEO argument for this stack (`04-PLAN` §5): a
 * client-rendered product page is near-invisible to a crawler, which is
 * affordable for a national brand buying traffic and fatal for a single shop
 * living on local organic search.
 */

export const revalidate = 60;

export async function generateStaticParams() {
  // Slugs only. Prices and quantities are re-read at request time; prerendering
  // the paths just avoids a cold render, which is exactly why it is safe to
  // skip when the catalog cannot be read. See `src/db/build-time.ts`.
  const catalog = await staticParamsOr('the catalog', () => listCatalog(null));
  return LOCALES.flatMap((locale) => catalog.map((c) => ({ locale, slug: c.slug })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const l: Locale = isLocale(locale) ? locale : 'fr';
  const found = await productBySlug(slug, null);
  if (found === null) return {};

  const { item } = found;
  const name = localisedName(item, l);
  const price =
    item.pricing.mode === 'perKg'
      ? ratePerKg(item.pricing.ratePerKg, l)
      : money(item.pricing.price, l);

  return {
    title: name,
    description: localisedDescription(item, l) ?? `${name}, ${price}.`,
    alternates: {
      languages: { 'en-CA': `/en/p/${slug}`, 'fr-CA': `/fr/p/${slug}` },
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();

  const day = await currentBusinessDay();
  const found = await productBySlug(slug, day?.id ?? null);
  if (found === null) notFound();

  const { item, preps } = found;
  const name = localisedName(item, locale);
  const description = localisedDescription(item, locale);
  const origin = siteOrigin();

  const minOrderG = item.pricing.mode === 'perKg' ? item.pricing.minOrder : item.pricing.wMin;
  const soldOut = item.availableG !== null && item.availableG < minOrderG;
  const notToday = item.availableG === null;

  // Same counter, minus this fish. Loaded here rather than in a client
  // component so the links are in the HTML and crawlable.
  const catalog = await listCatalog(day?.id ?? null);
  const related = catalog
    .filter((c) => c.categoryId === item.categoryId && c.id !== item.id)
    .slice(0, 4);
  const relatedPreps = await prepsForProducts(related.map((r) => r.id));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description: description ?? undefined,
    inLanguage: htmlLang(locale),
    image: item.imagePath === null ? undefined : `${origin}${item.imagePath}`,
    url: `${origin}/${locale}/p/${item.slug}`,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'CAD',
      // Per-kg products are advertised at their rate, with the unit stated, so
      // the markup cannot be read as a price for the whole item.
      price: decimalString(
        item.pricing.mode === 'perKg' ? item.pricing.ratePerKg : item.pricing.price,
      ),
      ...(item.pricing.mode === 'perKg'
        ? {
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'KGM' },
            },
          }
        : {}),
      availability:
        notToday || soldOut ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      seller: { '@id': `${origin}/#shop` },
    },
  };

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: t(locale, 'shop.title'), item: `${origin}/${locale}/shop` },
      { '@type': 'ListItem', position: 2, name, item: `${origin}/${locale}/p/${item.slug}` },
    ],
  };

  return (
    <div className="mx-auto max-w-[76rem] px-4 py-10 sm:px-6 sm:py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />

      <Link
        href={`/${locale}/shop`}
        className="arrow-link inline-flex text-meta font-semibold text-muted hover:text-ink"
      >
        {t(locale, 'product.backToShop')}
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:gap-14">
        {/*
          ⚠ STICKY ON A LAPTOP, AND IT IS NOT DECORATION. The right column is
          taller than a 4:3 photograph in a half-width track, so the media
          column ended in about 250px of empty page. Pinning it means the
          customer can still see the fish while they choose how it is cut,
          which is the one decision this page exists for. `self-start` is what
          lets a grid item be shorter than its row; without it the item
          stretches and `sticky` has nothing to move within.
        */}
        <div className="relative aspect-4/3 self-start overflow-hidden rounded-md bg-soft lg:sticky lg:top-[6rem]">
          {item.imagePath === null ? (
            <FallbackTile name={name} handling={item.handling} locale={locale} />
          ) : (
            <Image
              src={item.imagePath}
              alt={name}
              fill
              // The LCP element on this page, so it is priority and its sizes
              // are honest: full width on a phone, half above 1024.
              sizes="(max-width: 1023px) 100vw, 50vw"
              priority
              className="object-cover"
            />
          )}
        </div>

        <div className="grid content-start gap-5">
          {item.handling === 'COOKED_HOT' ? (
            <HotPill locale={locale} />
          ) : (
            <HandlingLabel handling={item.handling} locale={locale} />
          )}

          <h1 className="!text-display-xl">{name}</h1>

          <div className="grid gap-1">
            <p className="tnum text-section font-semibold">
              {item.pricing.mode === 'perKg'
                ? ratePerKg(item.pricing.ratePerKg, locale)
                : pricePerUnit(item.pricing.price, t(locale, 'product.unitPack'), locale)}
            </p>
            <p className="text-meta text-muted">
              {item.pricing.mode === 'perKg'
                ? t(locale, 'product.estimatedNote')
                : t(locale, 'product.fixedWeightNote')}
            </p>
            {item.pricing.mode === 'pack' && (
              <p className="tnum text-meta text-muted">
                {t(locale, 'product.packRange', {
                  min: weight(item.pricing.wMin, locale),
                  max: weight(item.pricing.wMax, locale),
                })}
              </p>
            )}
            {item.pricing.mode === 'perKg' && (
              <p className="tnum text-meta text-muted">
                {t(locale, 'product.minimumOrder', {
                  amount: weight(item.pricing.minOrder, locale),
                })}{' '}
                · {t(locale, 'product.stepNote', { amount: weight(item.pricing.step, locale) })}
              </p>
            )}
          </div>

          {description !== null && (
            <p className="max-w-[58ch] text-body text-muted">{description}</p>
          )}

          <p className="text-body">
            {notToday
              ? t(locale, 'shop.shopClosed')
              : soldOut
                ? t(locale, 'shop.soldOut')
                : t(locale, 'shop.leftToday', { amount: weight(item.availableG ?? 0, locale) })}
          </p>

          {item.handling === 'COOKED_HOT' && (
            <p className="rounded-md border border-line bg-soft px-4 py-3 text-body">
              {t(locale, 'handling.hotExplainer')}
            </p>
          )}

          <AddToBasket
            locale={locale}
            product={{
              productId: item.id,
              slug: item.slug,
              name,
              pricingMode: item.pricing.mode,
              unitPriceCents:
                item.pricing.mode === 'perKg' ? item.pricing.ratePerKg : item.pricing.price,
              minOrderG,
              stepG: item.pricing.mode === 'perKg' ? item.pricing.step : minOrderG,
              availableG: item.availableG,
              preps,
            }}
          />
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-20">
          <h2 className="!text-display">{t(locale, 'product.relatedHeading')}</h2>
          <div className="mt-6">
            {/*
              The same grid component the feed uses, rather than a hand-rolled
              row. Two implementations of a product card is how one of them
              quietly stops showing the "sold out" badge.
            */}
            <ProductGrid items={related} locale={locale} prepsByProduct={relatedPreps} />
          </div>
        </section>
      )}
    </div>
  );
}
