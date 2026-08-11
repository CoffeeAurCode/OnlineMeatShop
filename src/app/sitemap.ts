import type { MetadataRoute } from 'next';

import { listCatalog } from '@/db/repositories/catalog';
import { deliveryTowns, siteOrigin } from '@/ui/shop-config';

/**
 * The sitemap, built from the catalog rather than maintained by hand.
 *
 * `/admin`, `/api`, `/basket` and `/checkout` are absent, and that is the
 * point: listing them invites a crawler to spend its budget on pages that
 * cannot rank and must not be indexed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();
  const catalog = await listCatalog(null);

  return [
    { url: origin, changeFrequency: 'daily', priority: 1 },
    { url: `${origin}/shop`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${origin}/delivery`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${origin}/how-weighing-works`, changeFrequency: 'monthly', priority: 0.6 },
    ...deliveryTowns().map((t) => ({
      url: `${origin}/delivery/${t.slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...catalog.map((c) => ({
      url: `${origin}/p/${c.slug}`,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
  ];
}
