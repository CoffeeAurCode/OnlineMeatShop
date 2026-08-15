import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ClockIcon, ScalesIcon, TruckIcon } from '@phosphor-icons/react/dist/ssr';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog, listCategories, prepsForProducts } from '@/db/repositories/catalog';
import { isLocale, t } from '@/i18n';

import { AddressPill } from './_components/address-pill';
import { CategoryRail } from './_components/category-nav';
import { ProductGrid } from './_components/product-grid';

/**
 * Home.
 *
 * ⭐ THE HERO ASKS FOR THE ADDRESS. That is the borrowing from every delivery
 * app that matters most, and it is not a style choice: this shop cannot sell
 * to somebody outside its radius, so "where are you" is the qualifying
 * question and everything below it is contingent on the answer. Asking it here
 * means a refusal costs one tap rather than a filled-in checkout form, and it
 * makes the fee, the free-delivery threshold and the slot list honest on every
 * screen that follows.
 *
 * The old hero had two buttons into the catalog and a postcode box further
 * down whose answer was thrown away, so checkout asked again.
 *
 * ── DIALS ─────────────────────────────────────────────────────────────────
 *
 * The hero runs at the marketing settings, VARIANCE 7 / MOTION 5 / DENSITY 3.
 * Everything from the counter rail inward drops to 4/3/6: a grid of fish has
 * to be comparable and a hero does not.
 *
 * Motion is CSS only. The Motion library was declined deliberately and stays
 * declined: this deploys to a free instance with a roughly one minute cold
 * start, the measured LCP is already close to target, and a 34 kB animation
 * runtime on the critical path buys nothing a `transition` cannot do at this
 * intensity.
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
        Asymmetric split, not a centred hero. `min-h` rather than a fixed
        height, and `100dvh` is deliberately NOT used: a hero pinned to the
        viewport pushes the counter below the fold, and the counter is what
        this page is for.
      */}
      <section className="relative overflow-hidden bg-accent-solid text-accent-solid-ink">
        <div className="mx-auto grid max-w-[80rem] gap-10 px-4 pb-14 pt-12 sm:px-6 sm:pb-20 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16">
          <div className="hero-copy grid gap-6">
            <h1 className="display !text-display-xl">{t(l, 'home.heroHeading')}</h1>
            <p className="max-w-[42ch] text-lead text-white/80">{t(l, 'home.heroBody')}</p>

            {/*
              ⚠ THE ADDRESS CONTROL IS THE PRIMARY ACTION HERE, and the link
              into the catalog is the secondary one. That is the inversion.
            */}
            <div className="grid max-w-[30rem] gap-3">
              <AddressPill locale={l} variant="hero" />
              <Link
                href={`/${l}/shop`}
                className="tap-lg inline-flex items-center justify-center rounded-sm border border-white/35 px-6 text-body font-semibold transition-colors duration-200 hover:border-white"
              >
                {t(l, 'home.heroCta')}
              </Link>
            </div>
          </div>

          <div className="relative aspect-4/3 overflow-hidden rounded-md">
            <Image
              src="/sherbrooke/hero-counter.webp"
              alt=""
              fill
              sizes="(max-width: 1023px) 100vw, 48vw"
              priority
              className="object-cover"
            />
          </div>
        </div>
      </section>

      {/*
        ⭐ THE THREE PROMISES, directly under the hero. Uber puts fees and ETAs
        here because they are the facts that decide whether somebody continues,
        and the equivalents here are the three things that make this shop
        different from a supermarket: the weighing, the windows, the radius.

        Three items in one row is the layout the design rules single out as a
        cliché, and it is right here for the reason the rule allows: these are
        genuinely three peer facts of the same kind, read together, and any
        asymmetry between them would imply a ranking that does not exist.
      */}
      <section className="border-b border-line bg-raised">
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

      <section className="mx-auto max-w-[80rem] px-4 py-12 sm:px-6 sm:py-16">
        <div className="grid gap-2">
          <h2 className="!text-display-lg">{t(l, 'home.categoriesHeading')}</h2>
          <p className="max-w-[52ch] text-body text-muted">{t(l, 'home.categoriesBody')}</p>
        </div>
        <div className="mt-8">
          <CategoryRail categories={categories} locale={l} />
        </div>
      </section>

      {featured.length > 0 && (
        <section className="mx-auto max-w-[80rem] px-4 pb-16 sm:px-6 sm:pb-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="!text-display-lg">{t(l, 'home.todayHeading')}</h2>
            <Link
              href={`/${l}/shop`}
              className="arrow-link text-body font-semibold text-muted hover:text-ink"
            >
              {t(l, 'home.viewAll')}
            </Link>
          </div>
          <div className="mt-8">
            <ProductGrid items={featured} locale={l} prepsByProduct={preps} />
          </div>
        </section>
      )}

      {/*
        A band, not a card. `--surface-soft` is cream and is allowed behind a
        heading and short copy in a section band, which is the one place the
        token layer permits it.
      */}
      <section className="bg-soft">
        <div className="mx-auto grid max-w-[80rem] gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-16">
          <div className="grid content-start gap-4">
            <h2 className="!text-display">{t(l, 'home.weighingHeading')}</h2>
            <p className="max-w-[52ch] text-body text-ink/80">{t(l, 'home.weighingBody')}</p>
            <Link
              href={`/${l}/how-weighing-works`}
              className="arrow-link w-fit text-body font-semibold"
            >
              {t(l, 'nav.howItWorks')}
            </Link>
          </div>
          <div className="grid content-start gap-4">
            <h2 className="!text-display">{t(l, 'home.deliveryHeading')}</h2>
            <p className="max-w-[52ch] text-body text-ink/80">{t(l, 'home.deliveryBody')}</p>
            <Link href={`/${l}/delivery`} className="arrow-link w-fit text-body font-semibold">
              {t(l, 'nav.delivery')}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
