import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog, listCategories, prepsForProducts } from '@/db/repositories/catalog';
import { isLocale, t } from '@/i18n';

import { CategoryTiles } from './_components/category-nav';
import { Hero } from './_components/hero';
import { ProductGrid } from './_components/product-grid';

/**
 * Home — the app feed.
 *
 * ⭐ THIS IS A BUYING SURFACE, NOT A LANDING PAGE. It opens on the counters
 * and today's fish, in the order and at the density the Figma reference's home
 * screen (`163:838`) uses. Phase 2 of `08-PLAN-figma-uber-eats-parity.md`.
 *
 * ── THE MODULES, IN ORDER ─────────────────────────────────────────────────
 *
 * 1. the landing band — colour field, headline, search, scattered gouache
 * 2. counter tiles — the two-tier grid, overlapping the band
 * 3. today's counter — the product grid
 * 4. do you come to me — the delivery chart, and the hand-off to the address
 *
 * ⚠ THE BAND IS NOT THE EDITORIAL HERO THAT WAS DELETED. That one carried a
 * display heading, a lead paragraph, a SECOND COPY OF THE ADDRESS CONTROL and a
 * 4:3 photograph, and on a phone it WAS the entire first viewport. This one is
 * a shallow fixed strip, it duplicates no control, and it adds the thing that
 * screen lacked outright: a working search field below 1024px, where the
 * header's collapses to an icon. See `_components/hero.tsx`.
 *
 * ⚠ NOTHING HERE INVENTS A PROMOTION, A RATING, AN ETA OR A DISCOUNT to fill a
 * slot the reference fills that way. The reference's home screen carries promo
 * pills, star ratings, delivery-fee lines and an offers carousel; this shop has
 * none of those, and a decorative substitute would be a lie in a price
 * position.
 *
 * ── MOTION ────────────────────────────────────────────────────────────────
 *
 * Feedback only: colour and pressed states, sheets and drawers arriving, a
 * product image settling on hover. No entrance animation, no scroll-driven
 * reveal, no marquee. Motion is CSS; the Motion library stays declined, since
 * this deploys to a free instance with a cold start and a 34 kB animation
 * runtime on the critical path buys nothing a `transition` cannot do here.
 */

/**
 * ⚠ NOT PRERENDERED, AND NOT CACHED. This page shows TODAY'S STOCK.
 *
 * It was `revalidate = 300`, which meant two wrong things. Five minutes is a
 * stock figure that can be five minutes stale on the page a customer lands on
 * first. Worse, `/fr` and `/en` are known paths from the layout's
 * `generateStaticParams`, so the page was PRERENDERED AT BUILD -- baking
 * whatever the counter held on the day of the deploy into static HTML.
 *
 * "Nothing rolls over" is the rule this whole application is built around. A
 * cached home page quietly breaks it.
 *
 * It also means the BUILD no longer needs a database, which is what CI's
 * canary build requires. See `src/db/build-time.ts`.
 */
export const dynamic = 'force-dynamic';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // A path like `/de` reaches here with an unknown segment. 404 rather than
  // silently falling back, or `/anything` becomes a duplicate of this page at
  // an infinite number of URLs.
  if (!isLocale(locale)) notFound();
  const l = locale;

  const day = await currentBusinessDay();
  const [categories, catalog] = await Promise.all([
    listCategories(l),
    listCatalog(day?.id ?? null),
  ]);

  // Eight, from across the counters, that are actually available today. A
  // "featured" row showing sold-out fish is worse than no featured row.
  const featured = catalog.filter((c) => c.availableG === null || c.availableG > 0).slice(0, 8);
  const preps = await prepsForProducts(featured.map((f) => f.id));

  return (
    <>
      {/*
        ⭐ THE BAND, AND THE `h1` LIVES IN IT NOW. See `hero.tsx` for what was
        taken from the client's reference and what was refused.

        ⚠ THIS IS NOT THE EDITORIAL HERO THAT WAS DELETED, and the difference is
        the whole argument. That one was a full-bleed brand panel carrying a
        display heading, a lead paragraph, a SECOND COPY OF THE ADDRESS CONTROL
        and a 4:3 photograph — it filled a phone's entire first viewport with
        things that are not fish and pushed the counter below the fold. This
        band is a fixed, shallow strip that ends well inside the first viewport,
        it repeats no control, and it carries the one thing that screen was
        missing outright: a working search field below 1024px.
      */}
      <Hero locale={l} />

      {/*
        ⚠ THE COUNTERS PULL UP INTO THE BAND. `-mt-8` overlaps the tiles onto
        the teal, so the two sections read as one surface rather than as a
        coloured block sitting on top of a white page — which is the reference's
        own trick, and the cheapest way to stop a hero looking like a bolted-on
        banner. `relative` is what puts them above the band's own stacking
        context; the specks inside it are at `z-index: -1` and stay behind.
      */}
      <section className="relative mx-auto -mt-8 max-w-[80rem] px-4 pb-6 sm:px-6">
        <div className="rounded-lg bg-surface p-3 elev-card sm:p-4">
          {/*
            The counters need a heading in the outline, but not one on the
            screen: the reference goes straight from the location row into the
            tiles, and six labelled photographs do not need to be told they are
            categories. Visually hidden, so the structure is there for anyone
            navigating by heading.
          */}
          <h2 className="sr-only">{t(l, 'home.categoriesHeading')}</h2>
          <CategoryTiles categories={categories} locale={l} />
        </div>
      </section>

      {featured.length > 0 && (
        <>
          {/*
            The reference's section band: a full-bleed strip of ground between
            feed modules, doing the job a heading rule would otherwise do.
          */}
          <div aria-hidden className="h-2 bg-soft" />
          <section className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6 sm:py-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="!text-section font-bold">{t(l, 'home.todayHeading')}</h2>
              <Link
                href={`/${l}/shop`}
                className="arrow-link text-meta font-semibold text-muted hover:text-ink"
              >
                {t(l, 'home.viewAll')}
              </Link>
            </div>
            <div className="mt-4">
              <ProductGrid items={featured} locale={l} prepsByProduct={preps} />
            </div>
          </section>
        </>
      )}

      {/*
        ⭐ THE QUALIFYING QUESTION, LAST. "Do you come to me" is geography, and
        it is the one thing that can make everything above irrelevant — so it
        closes the page and hands off to the address control rather than
        competing with the counter for the first viewport.

        ⚠ NO RADIUS, NO FEE, NO DELIVERY TIME, NO FREE-DELIVERY THRESHOLD. Those
        are real values the shop configures and the API answers for a SPECIFIC
        address; the delivery strip and the basket show them once somebody has
        said where they are. Printing a plausible figure here to fill the layout
        is exactly the invention §3 forbids, and it is the kind that gets read
        as a promise.

        The chart is a painting of a coastline with a cyan radius drawn on it —
        deliberately a drawing and not a map, because a real-looking map with a
        real-looking boundary would be making precisely the promise the
        paragraph refuses to make.
      */}
      <section className="border-t border-line">
        <div className="mx-auto grid max-w-[80rem] items-center gap-8 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-2 lg:gap-16">
          <div className="grid content-start gap-4 lg:order-2">
            <h2 className="!text-display-lg !pb-0">{t(l, 'home.deliveryHeading')}</h2>
            <p className="max-w-[46ch] text-body text-muted">{t(l, 'home.deliveryBody')}</p>
            <Link href={`/${l}/delivery`} className="arrow-link w-fit text-body font-semibold">
              {t(l, 'nav.delivery')}
            </Link>
          </div>

          <div className="overflow-hidden rounded-lg lg:order-1">
            <Image
              src="/painted/delivery-map.webp"
              alt=""
              aria-hidden
              width={1200}
              height={900}
              className="painted w-full"
            />
          </div>
        </div>
      </section>
    </>
  );
}
