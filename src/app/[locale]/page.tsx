import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog, listCategories, prepsForProducts } from '@/db/repositories/catalog';
import { isLocale, t } from '@/i18n';

import { CategoryRail } from './_components/category-nav';
import { ProductGrid } from './_components/product-grid';

/**
 * Home.
 *
 * This is the ONE surface running at the marketing dials, VARIANCE 7 / MOTION
 * 5 / DENSITY 3, matching the shop's landing page. Everything from the
 * category grid inward drops to 4/3/6, because a grid of fish has to be
 * comparable and a hero does not.
 *
 * Motion is CSS only. The Motion library was declined deliberately: this
 * deploys to a free instance with a roughly one minute cold start and the
 * measured LCP is already close to its target, so a 34 kB animation runtime on
 * the critical path would buy nothing that a `transition` cannot do at this
 * intensity.
 */

/**
 * ⚠ NOT PRERENDERED, AND NOT CACHED. This page shows TODAY'S STOCK.
 *
 * It was `revalidate = 300`, which meant two things that are both wrong here.
 * The five minute window is a stock figure that can be five minutes stale on
 * the page a customer lands on first. Worse, `/fr` and `/en` are known paths
 * from the layout's `generateStaticParams`, so the page was PRERENDERED AT
 * BUILD -- baking whatever the counter held on the day of the deploy into
 * static HTML and serving it until the first revalidation.
 *
 * "Nothing rolls over" is the rule this whole application is built around. A
 * cached home page quietly breaks it.
 *
 * The cost is three queries per request. At this shop's volume that is
 * nothing, and it is server-rendered either way, so SEO is unaffected: a
 * crawler sees the same complete HTML.
 *
 * It also means the BUILD no longer needs a database, which is what CI's
 * canary build requires. See `src/db/build-time.ts`.
 */
export const dynamic = 'force-dynamic';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const day = await currentBusinessDay();
  const [categories, catalog] = await Promise.all([
    listCategories(locale),
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
        height, and `100dvh` is deliberately NOT used here: a hero pinned to
        the viewport pushes the counter below the fold, and the counter is what
        this page is for.
      */}
      <section className="relative overflow-hidden bg-accent-solid text-accent-solid-ink">
        <div className="mx-auto grid max-w-[76rem] gap-10 px-4 pb-14 pt-16 sm:px-6 sm:pb-20 sm:pt-24 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16">
          <div className="hero-copy grid gap-6">
            <h1 className="display !text-display-xl">{t(locale, 'home.heroHeading')}</h1>
            <p className="max-w-[42ch] text-lead text-white/80">{t(locale, 'home.heroBody')}</p>
            <div className="flex flex-wrap gap-3">
              <Link
                href={`/${locale}/shop`}
                className="tap-lg inline-flex items-center rounded-sm bg-brand px-6 text-body font-semibold text-midnight transition-transform duration-200 ease-brand hover:-translate-y-0.5 active:scale-[0.98]"
              >
                {t(locale, 'home.heroCta')}
              </Link>
              <Link
                href={`/${locale}/how-weighing-works`}
                className="tap-lg inline-flex items-center rounded-sm border border-white/35 px-6 text-body font-semibold transition-colors duration-200 hover:border-white"
              >
                {t(locale, 'home.heroSecondary')}
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

      <section className="mx-auto max-w-[76rem] px-4 py-16 sm:px-6 sm:py-24">
        <div className="grid gap-3">
          <h2 className="!text-display-lg">{t(locale, 'home.categoriesHeading')}</h2>
          <p className="max-w-[52ch] text-body text-muted">{t(locale, 'home.categoriesBody')}</p>
        </div>
        <div className="mt-8">
          <CategoryRail categories={categories} locale={locale} />
        </div>
      </section>

      {featured.length > 0 && (
        <section className="mx-auto max-w-[76rem] px-4 pb-16 sm:px-6 sm:pb-24">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="!text-display-lg">{t(locale, 'shop.title')}</h2>
            <Link
              href={`/${locale}/shop`}
              className="arrow-link text-body font-semibold text-muted hover:text-ink"
            >
              {t(locale, 'home.viewAll')}
            </Link>
          </div>
          <div className="mt-8">
            <ProductGrid items={featured} locale={locale} prepsByProduct={preps} />
          </div>
        </section>
      )}

      {/*
        A band, not a card. `--surface-soft` is cream and is allowed behind a
        heading and short copy in a section band, which is the one place the
        token layer permits it.
      */}
      <section className="bg-soft">
        <div className="mx-auto grid max-w-[76rem] gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:gap-16">
          <div className="grid content-start gap-4">
            <h2 className="!text-display">{t(locale, 'home.weighingHeading')}</h2>
            <p className="max-w-[52ch] text-body text-ink/80">{t(locale, 'home.weighingBody')}</p>
            <Link
              href={`/${locale}/how-weighing-works`}
              className="arrow-link w-fit text-body font-semibold"
            >
              {t(locale, 'nav.howItWorks')}
            </Link>
          </div>
          <div className="grid content-start gap-4">
            <h2 className="!text-display">{t(locale, 'home.deliveryHeading')}</h2>
            <p className="max-w-[52ch] text-body text-ink/80">{t(locale, 'home.deliveryBody')}</p>
            <Link href={`/${locale}/delivery`} className="arrow-link w-fit text-body font-semibold">
              {t(locale, 'nav.delivery')}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
