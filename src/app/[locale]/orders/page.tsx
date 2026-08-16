import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { verificationAvailable } from '@/adapters/phone-verifier';
import { isLocale, t } from '@/i18n';

import { OrderHistory } from '../_components/order-history';

/**
 * "My orders", behind a verified phone number.
 *
 * ⚠ NOT INDEXABLE, and the reason is not the usual one. This page is a list,
 * so there is nothing worth indexing, but the important part is that a crawler
 * following a link here must never end up with order data in an index.
 *
 * ⭐ THE `verificationAvailable()` BRANCH IS WHAT THIS PAGE USED TO ALWAYS
 * TAKE. On the deployed site it was false — the stub verifier refuses to exist
 * in production and there was nothing else — so every customer saw
 * "Something went wrong. Try again." with two real orders sitting in the
 * database. It is kept, because a deployment with no `NEXT_PUBLIC_SUPABASE_*`
 * still cannot sign anybody in and should say so rather than showing a button
 * that does nothing. It is simply no longer the normal case.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function OrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const available = verificationAvailable();

  return (
    <div className="mx-auto max-w-[36rem] px-4 py-14 sm:px-6 sm:py-20">
      <h1 className="!text-display-lg">{t(locale, 'verify.title')}</h1>

      {available ? (
        <OrderHistory locale={locale} />
      ) : (
        <p className="mt-6 rounded-md border border-line bg-soft px-4 py-3 text-body">
          {t(locale, 'auth.notAvailable')}
        </p>
      )}
    </div>
  );
}
