import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { readShopIdentity } from '@/db/repositories/settings';
import { isLocale, t, type Locale } from '@/i18n';
import { shopName } from '@/ui/shop-config';

import { PostcodeCheck } from '../_components/postcode-check';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const l: Locale = isLocale(locale) ? locale : 'fr';
  return {
    title: t(l, 'delivery.title'),
    description: t(l, 'home.deliveryBody'),
    alternates: {
      languages: { 'en-CA': '/en/delivery', 'fr-CA': '/fr/delivery' },
    },
  };
}

export default async function DeliveryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  /*
   * ⚠ READ FROM THE DATABASE, AND THIS PAGE IS STILL PRERENDERED. The towns
   * are owner-edited settings now, so a build bakes whatever they said at
   * build time and `/api/admin/shop` calls `revalidatePath` to throw that
   * away the moment they change it. `readShopIdentity` swallows a database
   * failure into an empty identity rather than failing the build, which is the
   * same trade `src/db/build-time.ts` makes and for the same reason.
   */
  const { towns } = await readShopIdentity();

  return (
    <div className="mx-auto max-w-[46rem] px-4 py-14 sm:px-6 sm:py-20">
      <h1 className="!text-display-xl">{t(locale, 'delivery.title')}</h1>
      <p className="mt-6 max-w-[58ch] text-lead text-muted">{t(locale, 'home.deliveryBody')}</p>

      <div className="mt-10">
        <PostcodeCheck locale={locale} />
      </div>

      {towns.length > 0 && (
        <section className="mt-14 border-t border-line pt-10">
          <h2 className="!text-display">{shopName()}</h2>
          <ul className="mt-6 flex flex-wrap gap-2">
            {towns.map((town) => (
              <li key={town.slug}>
                <Link
                  href={`/${locale}/delivery/${town.slug}`}
                  className="tap inline-flex items-center rounded-full border border-line bg-raised px-4 text-meta transition-colors hover:border-accent"
                >
                  {town.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
