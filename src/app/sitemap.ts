import type { MetadataRoute } from 'next';

import { staticParamsOr } from '@/db/build-time';
import { listCatalog } from '@/db/repositories/catalog';
import { LOCALES } from '@/i18n';
import { deliveryTowns, siteOrigin } from '@/ui/shop-config';

/**
 * The sitemap, built from the catalog rather than maintained by hand.
 *
 * `/admin`, `/api`, `/checkout` and `/orders` are absent, and that is the
 * point: listing them invites a crawler to spend its budget on pages that
 * cannot rank and must not be indexed. `/orders/[token]` especially, since
 * those URLs are secret.
 *
 * ⚠ EVERY ENTRY IS LOCALISED, AND CARRIES ITS TRANSLATION.
 *
 * This used to emit bare `/shop` and `/p/<slug>`. After the move to
 * `/[locale]`, those paths only REDIRECT, so the sitemap was handing a crawler
 * a list of redirects and no canonical URL for either language. Each entry now
 * appears once per locale with `alternates.languages` pointing at its
 * counterpart, which is what stops a bilingual site competing with itself.
 *
 * ⚠ The catalog read is guarded. A sitemap is worth having in a degraded form
 * -- the static pages are still listed -- and it is never worth failing a
 * deployment over. See `src/db/build-time.ts`.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();
  const catalog = await staticParamsOr('the catalog for the sitemap', () => listCatalog(null));

  /** One entry per locale, each naming the other as its alternate. */
  const localised = (
    path: string,
    changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'],
    priority: number,
  ): MetadataRoute.Sitemap =>
    LOCALES.map((locale) => ({
      url: `${origin}/${locale}${path}`,
      changeFrequency,
      priority,
      alternates: {
        languages: Object.fromEntries(
          LOCALES.map((l) => [l === 'fr' ? 'fr-CA' : 'en-CA', `${origin}/${l}${path}`]),
        ),
      },
    }));

  return [
    ...localised('', 'daily', 1),
    ...localised('/shop', 'daily', 0.9),
    ...localised('/delivery', 'monthly', 0.7),
    ...localised('/how-weighing-works', 'monthly', 0.6),
    ...deliveryTowns().flatMap((t) => localised(`/delivery/${t.slug}`, 'weekly', 0.7)),
    ...catalog.flatMap((c) => localised(`/p/${c.slug}`, 'daily', 0.8)),
  ];
}
