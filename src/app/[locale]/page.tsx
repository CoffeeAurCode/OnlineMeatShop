import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ClockIcon, ScalesIcon, TruckIcon } from '@phosphor-icons/react/dist/ssr';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog, listCategories, prepsForProducts } from '@/db/repositories/catalog';
import { isLocale, t } from '@/i18n';

import { CategoryTiles } from './_components/category-nav';
import { ProductGrid } from './_components/product-grid';

/**
 * Home — the app feed.
 *
 * ⭐ THIS IS A BUYING SURFACE, NOT A LANDING PAGE. It opens on the counters
 * and today's fish, in the order and at the density the Figma reference's home
 * screen (`163:838`) uses. Phase 2 of `08-PLAN-figma-uber-eats-parity.md`.
 *
 * ── THE FIVE MODULES, IN ORDER ────────────────────────────────────────────
 *
 * 1. counter tiles — the two-tier grid, straight from the reference
 * 2. today's counter — the product grid, above every explanation
 * 3. the three promises — weighing, windows, radius
 * 4. the exact-weight explanation
 * 5. the delivery explanation
 *
 * ⚠ THE EDITORIAL HERO WAS DELETED, NOT MOVED. It was a full-bleed brand panel
 * carrying a `--text-display-xl` heading, a lead paragraph, a second copy of
 * the address control and a 4:3 photograph, and on a phone it WAS the first
 * viewport. The address survives in the sticky header, where it is visible on
 * this screen and on every screen after it; the heading and the photograph do
 * not survive at all.
 *
 * ⚠ MODULES 3-5 MOVED BELOW THE PRODUCTS. They used to sit between the hero
 * and the counters. They answer "why is this shop different", which is a
 * question somebody asks after seeing something they want.
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
        ⭐ THE BUYING ENTRY STATE. No hero.

        ⚠ THE EDITORIAL HERO IS GONE — a full-bleed brand panel with a
        `--text-display-xl` heading, a paragraph, a duplicate address control
        and a 4:3 photograph. It filled the entire first viewport of a phone
        with things that are not fish, and the counter, which is what somebody
        opens this page to see, started below the fold.

        The reference home screen (`163:838`) reaches its first real product
        card at about 600px on a 375×812 device. That is the density this
        section exists to match.

        ⚠ THE ADDRESS IS NOT REPEATED HERE, and the reference would put it
        here. Ours is in the sticky header, on its own full-width row below
        `sm`, so it is present in this viewport AND in every one after it.
        Rendering it twice on the one screen where it is already visible is
        strictly worse than pinning it once.
      */}
      <section className="mx-auto max-w-[80rem] px-4 pb-6 pt-5 sm:px-6 sm:pt-7">
        {/*
          The screen title, at the display face's floor rather than at
          `--text-display-lg`. The reference sets its one and only screen title
          at 24/700 and has no editorial type at all; 28px Bodoni is as close
          to that as this project's type rules allow, and the brand face is an
          approved difference.

          ⚠ IT IS STILL `heroHeading` — the page's real subject, not the name
          of the module under it. The hero is gone; the sentence that told a
          search engine and a screen reader what this page IS survives it. A
          home page whose `h1` reads "Shop by counter" has described its first
          widget instead of itself.
        */}
        <h1 className="display !text-display">{t(l, 'home.heroHeading')}</h1>
        <div className="mt-4">
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
        ⭐ THE THREE PROMISES — the weighing, the windows, the radius.

        ⚠ THEY USED TO SIT DIRECTLY UNDER THE HERO, ABOVE THE COUNTER. Phase 2
        of the parity plan says to move trust education out of the first app
        viewport, and it is right: these are the facts that answer "why is this
        shop different", which is a question somebody asks AFTER seeing
        something they want, not before. Uber puts fees and ETAs at the top
        because those decide whether to continue; ours are explanations.
      */}
      <div aria-hidden className="h-2 bg-soft" />
      <section className="border-y border-line bg-raised">
        <ul className="mx-auto grid max-w-[80rem] gap-6 px-4 py-8 sm:grid-cols-3 sm:px-6">
          {[
            { icon: ScalesIcon, key: 'weighed' },
            { icon: ClockIcon, key: 'sameDay' },
            { icon: TruckIcon, key: 'radius' },
          ].map(({ icon: Icon, key }) => (
            <li key={key} className="flex gap-3">
              <Icon size={22} weight="duotone" aria-hidden className="mt-0.5 shrink-0 text-accent" />
              <div className="grid gap-0.5">
                <p className="text-body font-semibold">{t(l, `home.promise.${key}.title`)}</p>
                <p className="text-meta text-muted">{t(l, `home.promise.${key}.body`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/*
        ⭐ 5. THE EXACT-WEIGHT EXPLANATION, ON ITS OWN.

        ⚠ THIS AND THE DELIVERY BAND BELOW USED TO BE ONE TWO-COLUMN SECTION,
        two headings side by side in a single cream box. §9 lists them as two
        of the seven things the home page does, and they are genuinely two
        different questions: "why is the price an estimate" is about money and
        is the single most surprising thing about buying here, while "do you
        come to me" is about geography and is the qualifying question. Sitting
        them in adjacent columns made them read as a pair of footnotes.

        A narrow reading column, not a grid. `--surface-soft` is cream and this
        is the one place the token layer permits it: a bounded editorial band
        with a heading and short copy, never behind body text at length.
      */}
      <section className="bg-soft">
        <div className="mx-auto grid max-w-[46rem] gap-6 px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="!text-display-lg">{t(l, 'home.weighingHeading')}</h2>
          <p className="max-w-[56ch] text-lead text-ink/80">{t(l, 'home.weighingBody')}</p>

          {/*
            The three beats, as a numbered sequence rather than three cards.
            The order IS the content — estimate, hold, exact charge — and three
            equal boxes would say these are alternatives rather than steps.

            ⚠ THE HEADINGS ARE THE SAME STRINGS `/how-weighing-works` USES.
            Not a copy: the same keys. Two wordings of the shop's central
            promise is how one of them ends up describing the old flow.
          */}
          <ol className="mt-2 grid gap-4">
            {(['step1Heading', 'step2Heading', 'step3Heading'] as const).map((key, i) => (
              <li key={key} className="flex items-baseline gap-4 border-t border-line pt-4">
                <span className="tnum shrink-0 text-meta font-semibold text-muted">{i + 1}</span>
                <span className="text-lead font-semibold">{t(l, `weighing.${key}`)}</span>
              </li>
            ))}
          </ol>

          <Link
            href={`/${l}/how-weighing-works`}
            className="arrow-link w-fit text-body font-semibold"
          >
            {t(l, 'nav.howItWorks')}
          </Link>
        </div>
      </section>

      {/*
        ⭐ 6. THE DELIVERY EXPLANATION: coverage, fee logic, and the hot-food
        window rule, which are the three facts §9 names.

        ⚠ EVERY ONE OF THEM IS A RULE, NOT A NUMBER. No radius in kilometres,
        no fee, no free-delivery threshold, no delivery time. Those are real
        values the shop configures and the API answers for a specific address,
        and the delivery strip and the basket already show them once somebody
        has said where they are. Printing a plausible figure here to fill the
        layout is exactly the invention §3 forbids, and it is the kind that
        gets read as a promise.
      */}
      <section className="border-t border-line">
        {/*
          The shop's own provenance image, wide, and carrying no copy over it.
          Empty `alt`: it says nothing a screen reader needs that the three
          facts below do not already say.
        */}
        <div className="relative aspect-[16/6] w-full overflow-hidden bg-soft sm:aspect-[16/5]">
          <Image
            src="/sherbrooke/atlantic-water.webp"
            alt=""
            fill
            sizes="100vw"
            loading="lazy"
            className="object-cover"
          />
        </div>

        <div className="mx-auto grid max-w-[80rem] gap-8 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[22rem_1fr] lg:gap-16">
          <div className="grid content-start gap-4">
            <h2 className="!text-display-lg">{t(l, 'home.deliveryHeading')}</h2>
            <p className="max-w-[42ch] text-body text-muted">{t(l, 'home.deliveryBody')}</p>
            <Link href={`/${l}/delivery`} className="arrow-link w-fit text-body font-semibold">
              {t(l, 'nav.delivery')}
            </Link>
          </div>

          <dl className="grid gap-0">
            {(['area', 'fee', 'hot'] as const).map((key) => (
              <div key={key} className="grid gap-1 border-t border-line py-5 first:border-t-0 first:pt-0 sm:grid-cols-[16rem_1fr] sm:gap-6">
                <dt className="text-body font-semibold">
                  {t(l, `home.deliveryFact.${key}.title`)}
                </dt>
                <dd className="max-w-[56ch] text-body text-muted">
                  {t(l, `home.deliveryFact.${key}.body`)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

    </>
  );
}
