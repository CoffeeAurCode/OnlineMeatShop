import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  CheckCircleIcon,
  CircleIcon,
  MapPinIcon,
  NavigationArrowIcon,
} from '@phosphor-icons/react/dist/ssr';

import { orderByPublicToken, type TrackedOrder } from '@/db/repositories/tracking';
import { LIFECYCLE_ORDER } from '@/domain/lifecycle';
import { isLocale, t, type Locale } from '@/i18n';
import { shopTimeZone, slotWindow } from '@/ui/business-date';
import { money, weight } from '@/ui/format';
import { mapsPinUrl } from '@/ui/maps';

import { TestOrderBanner } from '../../_components/money-sentence';
import { TrackRefresh } from '../../_components/track-refresh';

/**
 * Tracking. No login, no account, no session.
 *
 * ⭐ THE TOKEN IN THE URL IS THE CREDENTIAL. See `src/db/repositories/tracking.ts`
 * for why that is the right design rather than a shortcut.
 *
 * ⚠ `noindex`, and it matters more here than on the other private pages. These
 * URLs are genuinely secret, and a crawler that reached one and indexed it
 * would publish a customer's address and their coordinates.
 *
 * ── THE STATUS LINE IS THE PRODUCT ────────────────────────────────────────
 *
 * ⭐ EVERY STEP ON IT IS DRIVEN BY THE OWNER'S CONSOLE. There is no courier
 * telemetry, no map with a van moving on it, and none is planned: this shop has
 * one van and the owner advances the order from a phone. The line is therefore
 * exactly as truthful as the console, which is a stronger guarantee than an
 * interpolated marker that keeps moving after the driver has stopped for lunch.
 *
 * The page is a delivery-app tracking screen in every other respect: a status
 * hero that states the one thing the customer wants to know, the milestone
 * line under it, the window, the address with a map link, and the receipt.
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
  const window = slotWindow(
    tz,
    new Date(order.slotStartsAtMs),
    new Date(order.slotEndsAtMs),
    locale,
  );
  const settled = order.status === 'DELIVERED' || order.status === 'CANCELLED';

  return (
    <div className="mx-auto grid max-w-[42rem] gap-6 px-4 py-8 sm:px-6 sm:py-12">
      {/*
        Polls while the order is live, stops once it is not. See the component
        for why this is 30 seconds of polling rather than a socket.
      */}
      {!settled && <TrackRefresh seconds={30} />}

      {placed === '1' && (
        <p className="rounded-md border border-accent bg-soft px-4 py-3 text-body">
          <strong className="font-semibold">{t(locale, 'order.confirmedTitle')}.</strong>{' '}
          {t(locale, 'order.confirmedBody')}
        </p>
      )}

      {/* Unmissable, on every payment surface, including this one. */}
      {order.paymentProvider === 'stub' && <TestOrderBanner locale={locale} />}

      {/*
        ⭐ THE STATUS HERO. One sentence, large, answering the only question the
        customer opened this page to ask. Everything else on the screen is
        detail they may or may not want.
      */}
      <header className="grid gap-2 rounded-md bg-brand-ground px-5 py-6 text-brand-ground-ink">
        <p className="text-meta uppercase tracking-[0.1em] text-white/70">
          {t(locale, 'order.statusHeading')}
        </p>
        <h1 className="!text-display-lg !pb-0">{t(locale, `status.${order.status}`)}</h1>
        <p className="max-w-[44ch] text-body text-white/80">
          {t(locale, `status.${order.status}Body`)}
        </p>
        {order.status !== 'CANCELLED' && (
          <p className="tnum mt-2 text-body font-semibold">
            {t(locale, 'order.arriving', { window })}
          </p>
        )}
      </header>

      <Timeline status={order.status} locale={locale} />

      <DeliverySection order={order} locale={locale} />

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

/**
 * Where it is going, and how to look at that on a map.
 *
 * ⚠ THE MAP IS A LINK, NOT AN EMBED, and that is a decision. An embedded map
 * means a third-party script and an API key on a page that displays a
 * customer's home address, plus a tile request from that customer's browser to
 * a company that is not this shop, on a page they opened to check on some
 * fish. A link costs one tap and leaks nothing until it is taken.
 *
 * ⭐ THE DELIVERY-PARTNER BLOCK IS BUILT AND CURRENTLY NEVER RENDERS, because
 * nothing assigns a partner yet. It is here rather than added later so that
 * the shape of the data the backend has to produce is written down where it
 * will be read: a name and a phone number on the order, set from the console.
 * See the backend plan, part 4.
 */
function DeliverySection({ order, locale }: { order: TrackedOrder; locale: Locale }) {
  const address = [
    order.addressLine1,
    order.addressLine2,
    order.city,
    order.province,
    order.postalCode,
  ]
    .filter((x) => x !== null && x !== '' && x !== '-')
    .join(', ');

  const hasPin = order.lat !== null && order.lng !== null;

  return (
    <section className="grid gap-3 rounded-md border border-line bg-raised p-5">
      <h2 className="!font-sans !text-body !pb-0 !tracking-normal font-semibold uppercase tracking-[0.1em] text-muted">
        {t(locale, 'order.deliverTo')}
      </h2>

      <div className="flex items-start gap-3">
        <MapPinIcon size={18} weight="fill" aria-hidden className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-body">{address}</p>
          {order.deliveryNotes !== null && (
            <p className="mt-1 text-meta text-muted">{order.deliveryNotes}</p>
          )}
        </div>
      </div>

      {hasPin && (
        <a
          href={mapsPinUrl(Number(order.lat), Number(order.lng))}
          target="_blank"
          rel="noopener noreferrer"
          className="tap inline-flex w-fit items-center gap-2 rounded-sm border border-line px-3 text-meta font-semibold transition-colors hover:border-accent"
        >
          <NavigationArrowIcon size={14} weight="fill" aria-hidden />
          {t(locale, 'order.viewOnMap')}
        </a>
      )}
    </section>
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
 * The status walk.
 *
 * Cancelled is shown on its own rather than as a step, because it is not a
 * point on the line: it is the line ending.
 *
 * ⚠ HORIZONTAL ABOVE `sm`, VERTICAL BELOW IT. Six steps laid out horizontally
 * on a 360px phone give each label 55px, which wraps "Out for delivery" onto
 * three lines and makes the whole thing unreadable. The vertical form has room
 * for the body copy under the current step, which is where the useful sentence
 * lives.
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
    <>
      {/* Phone: vertical, with the current step's explanation under it. */}
      <ol className="grid gap-0 sm:hidden">
        {LIFECYCLE_ORDER.map((step, i) => {
          const done = i <= reached;
          const current = i === reached;
          return (
            <li key={step} className="flex gap-3">
              <div className="flex flex-col items-center">
                <Dot done={done} />
                {i < LIFECYCLE_ORDER.length - 1 && (
                  <span className={`w-px flex-1 ${done ? 'bg-accent' : 'bg-line'}`} />
                )}
              </div>
              <div className={`pb-5 ${done ? '' : 'opacity-45'}`}>
                <p className="text-body font-semibold">{t(locale, `status.${step}`)}</p>
                {current && (
                  <p className="text-meta text-muted">{t(locale, `status.${step}Body`)}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Laptop: horizontal, the shape a delivery app uses. */}
      <ol className="hidden sm:grid sm:grid-cols-6 sm:gap-0">
        {LIFECYCLE_ORDER.map((step, i) => {
          const done = i <= reached;
          return (
            <li key={step} className="grid justify-items-center gap-2 text-center">
              <div className="flex w-full items-center">
                <span
                  className={`h-px flex-1 ${i === 0 ? 'bg-transparent' : done ? 'bg-accent' : 'bg-line'}`}
                />
                <Dot done={done} />
                <span
                  className={`h-px flex-1 ${
                    i === LIFECYCLE_ORDER.length - 1
                      ? 'bg-transparent'
                      : i < reached
                        ? 'bg-accent'
                        : 'bg-line'
                  }`}
                />
              </div>
              <p className={`text-meta font-semibold ${done ? '' : 'text-muted opacity-60'}`}>
                {t(locale, `status.${step}`)}
              </p>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Dot({ done }: { done: boolean }) {
  return done ? (
    <CheckCircleIcon size={22} weight="fill" aria-hidden className="shrink-0 text-accent" />
  ) : (
    <CircleIcon size={22} aria-hidden className="shrink-0 text-line" />
  );
}
