import type { MetadataRoute } from 'next';

import { siteOrigin } from '@/ui/shop-config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // The console must never be indexed, and neither must anything
      // per-customer. `next.config.ts` also sends X-Robots-Tag on /admin/*,
      // because robots.txt is a request and a header is an instruction.
      disallow: ['/admin', '/api', '/basket', '/checkout'],
    },
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
