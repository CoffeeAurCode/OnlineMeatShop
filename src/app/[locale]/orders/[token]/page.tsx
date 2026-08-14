import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CheckCircleIcon, CircleIcon } from '@phosphor-icons/react/dist/ssr';

import { orderByPublicToken, type TrackedOrder } from '@/db/repositories/tracking';
import { LIFECYCLE_ORDER } from '@/domain/lifecycle';
import { isLocale, t, type Locale } from '@/i18n';
import { shopTimeZone, slotWindow } from '@/ui/business-date';
import { money, weight } from '@/ui/format';

import { TestOrderBanner } from '../../_components/money-sentence';

/**
 * Tracking. No login, no account, no session.
 *
 * ⭐ THE TOKEN IN THE URL IS THE CREDENTIAL. See `src/db/repositories/tracking.ts`
 * for why that is the right design rather than a shortcut.
 *
 * ⚠ `noindex`, and it matters more here than on the other private pages. These
 * URLs are genuinely secret, and a crawler that reached one and indexed it
 * would publish a customer's address.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function TrackOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ placed?: string }>;
}) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  const { placed } = await searchParams;

  const order = await orderByPublicToken(token);

  if (order === null) {
    return (
      <div className="mx-auto max-w-[36rem] px-4 py-20 text-center sm:px-6">
        <h1 className="!text-display-lg">{t(locale, 'order.notFound')}</h1>
        <p className="mt-4 text-body text-muted">{t(locale, 'order.notFoundBody')}</p>
      </div>
    );
  }

  const tz = shopTimeZone();

  return (
    <div className="mx-auto grid max-w-[42rem] gap-8 px-4 py-10 sm:px-6 sm:py-14">
      <header className="grid gap-3">
        <h1 className="!text-display-lg">
          {placed === '1' ? t(locale, 'order.confirmedTitle') : t(locale, 'order.statusHeading')}
        </h1>
        {placed === '1' && <p className="text-lead text-muted">{t(locale, 'order.confirmedBody')}</p>}
      </header>

      {/* Unmissable, on every payment surface, including this one. */}
      {order.paymentProvider === 'stub' && <TestOrderBanner locale={locale} />}

      <Timeline status={order.status} locale={locale} />

      <section className="grid gap-3 rounded-md border border-line bg-raised p-5">
        <Row label={t(locale, 'order.slot')} value={slotWindow(tz, new Date(order.slotStartsAtMs), new Date(order.slotEndsAtMs), locale)} />
        <Row
          label={t(locale, 'order.deliverTo')}
          value={[order.addressLine1, order.addressLine2, order.city, order.province, order.postalCode]
            .filter((x) => x !== null && x !== '')
            .join(', ')}
        />
      </section>

      <section className="grid gap-4">
        <h2 className="!font-sans !text-section !pb-0 !tracking-normal font-semibold">
          {t(locale, 'order.items')}
        </h2>
        <ul className="grid gap-4">
          {order.lines.map((l, i) => (
            <li key={`${l.productName}-${i}`} className="grid gap-1 border-b border-line pb-4">
              <p className="text-body font-semibold">{l.productName}</p>
              {/*
                ⭐ ESTIMATE VERSUS ACTUAL, SIDE BY SIDE. This is the whole point
                of the receipt and the promise the shop made. Both numbers, in
                tabular figures so the columns line up, with the actual shown as
                pending rather than hidden until it exists.
              */}
              <div className="tnum grid grid-cols-2 gap-2 text-meta text-muted sm:grid-cols-4">
                <span>
                  {t(locale, 'order.estimatedWeight')}: {weight(l.requestedG, locale)}
                </span>
                <span>
                  {t(locale, 'order.actualWeight')}:{' '}
                  {l.actualG === null ? t(locale, 'order.notWeighedYet') : weight(l.actualG, locale)}
                </span>
                <span>{money(l.estAmountCents, locale)}</span>
                <span className="font-semibold text-ink">
                  {l.actAmountCents === null ? '' : money(l.actAmountCents, locale)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Totals order={order} locale={locale} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-meta font-semibold uppercase tracking-[0.1em] text-muted">{label}</dt>
      <dd className="text-body">{value}</dd>
    </div>
  );
}

function Totals({ order, locale }: { order: TrackedOrder; locale: Locale }) {
  return (
    <dl className="grid gap-2 rounded-md border border-line bg-raised p-5 text-body">
      <div className="flex justify-between">
        <dt>{t(locale, 'basket.subtotal')}</dt>
        <dd className="tnum">{money(order.estLineTotalCents, locale)}</dd>
      </div>
      <div className="flex justify-between">
        <dt>{t(locale, 'basket.delivery')}</dt>
        <dd className="tnum">
          {order.deliveryFeeCents === 0
            ? t(locale, 'basket.deliveryFree')
            : money(order.deliveryFeeCents, locale)}
        </dd>
      </div>
      <div className="flex justify-between border-t border-line pt-2">
        <dt>{t(locale, 'order.estimatedTotal')}</dt>
        <dd className="tnum">{money(order.estTotalCents, locale)}</dd>
      </div>
      {order.authorisedCents !== null && (
        <div className="flex justify-between text-muted">
          <dt>{t(locale, 'payment.heldMax')}</dt>
          <dd className="tnum">{money(order.authorisedCents, locale)}</dd>
        </div>
      )}
      {order.finalTotalCents !== null && (
        <div className="flex justify-between text-section font-semibold">
          <dt>{t(locale, 'order.finalTotal')}</dt>
          <dd className="tnum">{money(order.finalTotalCents, locale)}</dd>
        </div>
      )}
    </dl>
  );
}

/**
 * The status walk. Cancelled is shown on its own rather than as a step,
 * because it is not a point on the line, it is the line ending.
 */
function Timeline({ status, locale }: { status: string; locale: Locale }) {
  if (status === 'CANCELLED') {
    return (
      <p className="rounded-md border border-danger bg-danger-wash px-4 py-3 text-body text-danger">
        {t(locale, 'status.CANCELLEDBody')}
      </p>
    );
  }

  const reached = LIFECYCLE_ORDER.indexOf(status as never);

  return (
    <ol className="grid gap-0">
      {LIFECYCLE_ORDER.map((step, i) => {
        const done = i <= reached;
        const current = i === reached;
        return (
          <li key={step} className="flex gap-3">
            <div className="flex flex-col items-center">
              {done ? (
                <CheckCircleIcon size={22} weight="fill" aria-hidden className="text-accent" />
              ) : (
                <CircleIcon size={22} aria-hidden className="text-line" />
              )}
              {i < LIFECYCLE_ORDER.length - 1 && (
                <span className={`w-px flex-1 ${done ? 'bg-accent' : 'bg-line'}`} />
              )}
            </div>
            <div className={`pb-6 ${done ? '' : 'opacity-50'}`}>
              <p className="text-body font-semibold">{t(locale, `status.${step}`)}</p>
              {current && (
                <p className="text-meta text-muted">{t(locale, `status.${step}Body`)}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
