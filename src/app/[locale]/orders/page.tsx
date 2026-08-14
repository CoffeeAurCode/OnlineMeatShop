import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { verificationAvailable } from '@/adapters/phone-verifier';
import { isLocale, t } from '@/i18n';

import { OrderHistory } from '../_components/order-history';

/**
 * "My orders", behind the stub verifier.
 *
 * ⚠ NOT INDEXABLE, and the reason is not the usual one. This page is a form,
 * so there is nothing worth indexing, but the important part is that a crawler
 * following a link here must never end up with order data in an index.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function OrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Checked on the server, so a deployment without a verifier does not render
  // a form that cannot work. The route refuses too; this is the courtesy.
  const available = verificationAvailable();

  return (
    <div className="mx-auto max-w-[36rem] px-4 py-14 sm:px-6 sm:py-20">
      <h1 className="!text-display-lg">{t(locale, 'verify.title')}</h1>

      {available ? (
        <OrderHistory locale={locale} />
      ) : (
        <p className="mt-6 rounded-md border border-line bg-soft px-4 py-3 text-body">
          {t(locale, 'errors.generic')}
        </p>
      )}
    </div>
  );
}
