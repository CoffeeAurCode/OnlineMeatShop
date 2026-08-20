'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CaretRightIcon,
  HeartIcon,
  MapPinIcon,
  ReceiptIcon,
  SignOutIcon,
  UserCircleIcon,
} from '@phosphor-icons/react/dist/ssr';

import { t, type Locale } from '@/i18n';
import { useCustomerSession, type HistoryOrder } from '@/ui/customer-session';
import { useFavourites } from '@/ui/favourites';
import { money } from '@/ui/format';
import { locationLabel, useDeliveryLocation } from '@/ui/location';

import { openLocationSheet, openSignIn } from './drawer-state';

interface AccountProduct {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly active: boolean;
  readonly priceLabel: string;
}

const ACTIVE_STATUSES = new Set(['PLACED', 'PREPARING', 'WEIGHED', 'READY', 'OUT']);

export function AccountHub({
  locale,
  verificationAvailable,
  products,
}: {
  locale: Locale;
  verificationAvailable: boolean;
  products: readonly AccountProduct[];
}) {
  const session = useCustomerSession();
  const favourites = useFavourites();
  const delivery = useDeliveryLocation();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    void session.refresh();
    // The provider exposes a stable callback; this page needs a fresh history
    // on arrival, not a polling effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = session.orders.filter((order) => ACTIVE_STATUSES.has(order.status));
  const past = session.orders.filter((order) => !ACTIVE_STATUSES.has(order.status));
  const saved = products.filter((product) => favourites.has(product.id));
  const missingSaved = Math.max(0, favourites.size - saved.length);
  const address = delivery.ready ? locationLabel(delivery.location) : null;

  async function signOut(): Promise<void> {
    setSigningOut(true);
    await session.signOut();
    setSigningOut(false);
  }

  return (
    <div className="mx-auto max-w-[52rem] px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-full bg-soft text-ink">
          <UserCircleIcon size={27} weight="duotone" aria-hidden />
        </span>
        <div>
          <h1 className="!text-display-lg">{t(locale, 'account.title')}</h1>
          <p className="text-meta text-muted">
            {session.phone == null
              ? t(locale, 'account.signedOut')
              : t(locale, 'auth.signedInAs', { phone: session.phone })}
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-5">
        <AccountSection icon={<ReceiptIcon size={20} aria-hidden />} title={t(locale, 'account.currentOrders')}>
          <Orders locale={locale} orders={current} loading={session.loading} />
          {session.phone == null && verificationAvailable && (
            <button
              type="button"
              onClick={openSignIn}
              className="tap-lg mt-3 rounded-sm bg-accent px-5 text-body font-semibold text-accent-ink"
            >
              {t(locale, 'auth.title')}
            </button>
          )}
          {session.phone == null && !verificationAvailable && (
            <p className="mt-3 text-meta text-danger">{t(locale, 'auth.notAvailable')}</p>
          )}
        </AccountSection>

        <AccountSection icon={<ReceiptIcon size={20} aria-hidden />} title={t(locale, 'account.pastOrders')}>
          <Orders locale={locale} orders={past} loading={session.loading} />
        </AccountSection>

        <AccountSection icon={<HeartIcon size={20} aria-hidden />} title={t(locale, 'account.favourites')}>
          {saved.length === 0 ? (
            <div>
              <p className="text-body text-muted">{t(locale, 'shop.noSavedBody')}</p>
              <Link
                href={`/${locale}/shop`}
                className="tap mt-2 inline-flex items-center gap-1 text-meta font-semibold text-accent underline underline-offset-4"
              >
                {t(locale, 'nav.shop')}
                <CaretRightIcon size={12} weight="bold" aria-hidden />
              </Link>
            </div>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {saved.map((product) => (
                <li key={product.id}>
                  <Link
                    href={`/${locale}/p/${product.slug}`}
                    className="press-card flex min-h-14 items-center justify-between gap-3 rounded-sm border border-line px-3 py-2 hover:border-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-body font-semibold">{product.name}</span>
                      <span className="tnum block text-meta text-muted">
                        {product.active ? product.priceLabel : t(locale, 'account.noLongerAvailable')}
                      </span>
                    </span>
                    <CaretRightIcon size={14} weight="bold" aria-hidden className="shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {missingSaved > 0 && (
            <p className="mt-2 text-meta text-muted">{t(locale, 'account.removedSaved', { count: missingSaved })}</p>
          )}
        </AccountSection>

        <AccountSection icon={<MapPinIcon size={20} aria-hidden />} title={t(locale, 'account.address')}>
          <p className="text-body font-semibold">{address ?? t(locale, 'location.setAddress')}</p>
          {address !== null && (
            <p className="mt-1 text-meta text-muted">
              {[delivery.location.city, delivery.location.region, delivery.location.postalCode]
                .filter((part) => part.trim() !== '')
                .join(' · ')}
            </p>
          )}
          <button
            type="button"
            onClick={openLocationSheet}
            className="tap mt-2 text-meta font-semibold text-accent underline underline-offset-4"
          >
            {address === null ? t(locale, 'location.setAddress') : t(locale, 'location.change')}
          </button>
        </AccountSection>
      </div>

      {session.phone != null && (
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void signOut()}
          className="tap-lg mt-6 flex w-full items-center justify-center gap-2 rounded-sm border border-line bg-raised px-5 text-body font-semibold text-ink disabled:opacity-50"
        >
          <SignOutIcon size={19} aria-hidden />
          {signingOut ? t(locale, 'account.signingOut') : t(locale, 'auth.signOut')}
        </button>
      )}
    </div>
  );
}

function AccountSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-line bg-raised px-4 py-4 sm:px-5">
      <h2 className="flex items-center gap-2 !font-sans !text-section !tracking-normal font-semibold">
        {icon}
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Orders({ locale, orders, loading }: { locale: Locale; orders: readonly HistoryOrder[]; loading: boolean }) {
  if (loading) return <p className="text-body text-muted">{t(locale, 'common.loading')}</p>;
  if (orders.length === 0) return <p className="text-body text-muted">{t(locale, 'order.historyEmpty')}</p>;

  return (
    <ul className="grid gap-2">
      {orders.map((order) => (
        <li key={order.publicToken}>
          <Link
            href={`/${locale}/orders/${order.publicToken}`}
            className="press-card flex min-h-14 items-center justify-between gap-4 rounded-sm border border-line px-3 py-2 hover:border-accent"
          >
            <span>
              <span className="block text-body font-semibold">{t(locale, `status.${order.status}`)}</span>
              <span className="tnum block text-meta text-muted">
                {new Date(order.placedAtMs).toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA')}
              </span>
            </span>
            <span className="tnum shrink-0 text-body font-semibold">
              {money(order.finalTotalCents ?? order.estTotalCents, locale)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
