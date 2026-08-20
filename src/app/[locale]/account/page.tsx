import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { verificationAvailable } from '@/adapters/phone-verifier';
import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog, localisedName } from '@/db/repositories/catalog';
import { isLocale, t } from '@/i18n';
import { pricePerUnit, ratePerKg } from '@/ui/format';

import { AccountHub } from '../_components/account-hub';

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const day = await currentBusinessDay();
  const catalog = await listCatalog(day?.id ?? null, { includeInactive: true });

  return (
    <AccountHub
      locale={locale}
      verificationAvailable={verificationAvailable()}
      products={catalog.map((item) => ({
        id: item.id,
        slug: item.slug,
        name: localisedName(item, locale),
        active: item.active,
        priceLabel:
          item.pricing.mode === 'perKg'
            ? ratePerKg(item.pricing.ratePerKg, locale)
            : pricePerUnit(item.pricing.price, t(locale, 'product.unitPack'), locale),
      }))}
    />
  );
}
