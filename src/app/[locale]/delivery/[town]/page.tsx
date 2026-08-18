import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog } from '@/db/repositories/catalog';
import { readShopIdentity } from '@/db/repositories/settings';
import { isLocale, t, type Locale } from '@/i18n';
import { shopName } from '@/ui/shop-config';

import { PostcodeCheck } from '../../_components/postcode-check';

/**
 * The "fishmonger near me" surface.
 *
 * 🔴 THE DOORWAY-PAGE RISK IS REAL AND THIS FILE DOES NOT SOLVE IT.
 *
 * A set of pages differing only by a place name is exactly what the
 * doorway-page guidance targets, and generating one per town from a list is
 * the fastest route to that penalty. `04-PLAN` §10.5 is the rule: each town
 * page must carry materially unique content, the streets and landmarks
 * actually served, that town's slots and cut-offs and its fee. A town that
 * cannot sustain that is a SECTION on `/delivery`, not a route of its own.
 *
 * ⚠ Being bilingual DOUBLES this exposure: the same thin page now exists at
 * two URLs per town. The `hreflang` pair below is what tells a crawler they
 * are translations rather than duplicates, and it is load bearing here.
 *
 * What is here is the shell plus the one genuinely per-town fact available
 * today, which is live availability. **Do not expand `DELIVERY_TOWNS` until
 * the real per-town copy exists** (blocked on DQ-1 and DQ-3).
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; town: string }>;
}): Promise<Metadata> {
  const { locale, town } = await params;
  const l: Locale = isLocale(locale) ? locale : 'fr';
  const { towns } = await readShopIdentity();
  const found = towns.find((x) => x.slug === town);
  if (found === undefined) return {};

  return {
    title: `${t(l, 'delivery.title')} · ${found.name}`,
    description: `${shopName()} ${t(l, 'home.deliveryBody')}`,
    alternates: {
      languages: {
        'en-CA': `/en/delivery/${found.slug}`,
        'fr-CA': `/fr/delivery/${found.slug}`,
      },
    },
  };
}

/**
 * ⚠ NOT PRERENDERED. Same reason as the home page: this shows how many items
 * are on the counter today, and a build-time snapshot of that is a lie by the
 * next morning.
 *
 * `generateStaticParams` was removed rather than guarded, and the reason got
 * STRONGER when the town list moved out of the environment and into
 * `shop_setting` (2026-08-18): the list and the availability now come from the
 * same database, so prerendering the paths would mean generating a page for a
 * town the owner deleted this morning.
 */
export const dynamic = 'force-dynamic';

export default async function TownPage({
  params,
}: {
  params: Promise<{ locale: string; town: string }>;
}) {
  const { locale, town } = await params;
  if (!isLocale(locale)) notFound();

  const { towns } = await readShopIdentity();
  const found = towns.find((x) => x.slug === town);
  if (found === undefined) notFound();

  const day = await currentBusinessDay();
  const catalog = await listCatalog(day?.id ?? null);
  const available = catalog.filter((c) => c.availableG !== null && c.availableG > 0);

  return (
    <div className="mx-auto max-w-[46rem] px-4 py-14 sm:px-6 sm:py-20">
      <h1 className="!text-display-xl">
        {t(locale, 'delivery.title')} · {found.name}
      </h1>
      <p className="mt-6 max-w-[58ch] text-lead text-muted">{t(locale, 'home.weighingBody')}</p>

      <div className="mt-10">
        <PostcodeCheck locale={locale} />
      </div>

      <section className="mt-14 border-t border-line pt-10">
        <h2 className="!text-display">{t(locale, 'shop.title')}</h2>
        <p className="mt-4 text-body text-muted">
          {available.length === 0
            ? t(locale, 'shop.emptyBody')
            : t(locale, available.length === 1 ? 'shop.resultCountOne' : 'shop.resultCount', {
                count: available.length,
              })}
        </p>
      </section>
    </div>
  );
}
