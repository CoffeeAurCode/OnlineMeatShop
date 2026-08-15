'use client';

import { useEffect, useState } from 'react';
import { MapPinIcon, TruckIcon, WarningIcon } from '@phosphor-icons/react/dist/ssr';

import { t, type Locale } from '@/i18n';
import { money } from '@/ui/format';
import { hasDestination, useDeliveryLocation } from '@/ui/location';

import { openLocationSheet } from './drawer-state';

/**
 * The delivery answer, stated on the browsing pages.
 *
 * ⭐ THIS IS WHAT THE ADDRESS PILL IS FOR. Once the shop knows where somebody
 * is, it can say the fee and the free-delivery threshold as facts instead of
 * as "calculated at checkout", and a customer outside the radius finds out
 * here rather than after filling in a form.
 *
 * ⚠ IT HAS THREE STATES AND THEY READ DIFFERENTLY. Nobody has said where they
 * are; the shop delivers there; the shop does not. Collapsing the first into
 * the third is the bug the previous hero had: an unanswered question rendered
 * as a refusal.
 *
 * ⚠ IT IS NOT AN ENFORCEMENT MECHANISM. Precondition P1 refuses the order
 * server-side inside the placement transaction regardless of what this strip
 * says. This is a courtesy, and it is allowed to be briefly stale.
 */

interface Answer {
  served: boolean;
  feeCents?: number;
  freeAboveCents?: number | null;
  distanceM?: number;
}

export function DeliveryStrip({ locale }: { locale: Locale }) {
  const { location, ready } = useDeliveryLocation();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [failed, setFailed] = useState(false);

  const key =
    location.lat !== null && location.lng !== null
      ? `${location.lat},${location.lng}`
      : location.postalCode.trim().toUpperCase();

  useEffect(() => {
    if (!ready || !hasDestination(location)) return;

    const controller = new AbortController();
    void fetch('/api/serviceable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        lat: location.lat,
        lng: location.lng,
        postalCode: location.postalCode.trim() === '' ? null : location.postalCode,
      }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<Answer>) : Promise.reject(new Error('ask'))))
      .then((a) => {
        setAnswer(a);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        /*
         * ⚠ A FAILED CHECK IS NOT A REFUSAL, and it must not render as one.
         * Offline, a cold instance, or a route that is down all land here, and
         * "we do not deliver to you" would be a lie the shop cannot take back.
         * The generic radius sentence is true in every one of those cases, and
         * checkout is where this actually gets decided.
         */
        setFailed(true);
      });

    return () => controller.abort();
    // Keyed on the destination rather than the whole location object, so
    // editing the buzzer code does not re-ask whether the shop delivers.
  }, [key, ready, location]);

  // Nothing at all until storage has been read. Rendering the empty shell here
  // would put a bordered box on the page for one frame and then change it.
  if (!ready) return <Shell>{null}</Shell>;

  if (!hasDestination(location)) {
    return (
      <Shell>
        <MapPinIcon size={16} weight="fill" aria-hidden className="shrink-0 text-accent" />
        <span>{t(locale, 'location.stripUnknown')}</span>
        <button
          type="button"
          onClick={openLocationSheet}
          className="font-semibold underline underline-offset-4 hover:no-underline"
        >
          {t(locale, 'location.setAddress')}
        </button>
      </Shell>
    );
  }

  /*
   * ⚠ THE WAITING STATE SAYS SOMETHING. This used to render an empty bordered
   * box, which is what a broken component looks like — and because a failed
   * request left `answer` null forever, it stayed that way rather than
   * flickering. Measured against the live database before migration 0007 was
   * applied: `/api/serviceable` answered 500 and the page carried a blank
   * rectangle above the grid on every load.
   */
  if (answer === null) {
    return (
      <Shell>
        <TruckIcon size={16} weight="fill" aria-hidden className="shrink-0 text-accent" />
        <span className={failed ? '' : 'text-muted'}>{t(locale, 'location.stripUnknown')}</span>
      </Shell>
    );
  }

  if (!answer.served) {
    return (
      <Shell tone="danger">
        <WarningIcon size={16} weight="fill" aria-hidden className="shrink-0" />
        <span>{t(locale, 'errors.outsideDeliveryAreaGps')}</span>
        <button
          type="button"
          onClick={openLocationSheet}
          className="font-semibold underline underline-offset-4 hover:no-underline"
        >
          {t(locale, 'location.change')}
        </button>
      </Shell>
    );
  }

  const fee = answer.feeCents ?? 0;
  const freeAbove = answer.freeAboveCents ?? null;

  return (
    <Shell>
      <TruckIcon size={16} weight="fill" aria-hidden className="shrink-0 text-accent" />
      <span>
        {fee === 0
          ? t(locale, 'location.servedFree')
          : t(locale, 'location.served', { fee: money(fee, locale) })}
      </span>
      {freeAbove !== null && fee > 0 && (
        <span className="text-muted">
          {t(locale, 'location.freeAbove', { amount: money(freeAbove, locale) })}
        </span>
      )}
      <button
        type="button"
        onClick={openLocationSheet}
        className="ml-auto shrink-0 font-semibold underline underline-offset-4 hover:no-underline"
      >
        {t(locale, 'location.change')}
      </button>
    </Shell>
  );
}

/**
 * Fixed height in every state, empty included.
 *
 * The strip sits directly above a grid of photographs, and a strip that
 * appears once a `fetch` resolves shoves that grid down under the reader's
 * thumb. Reserving the row is the whole of the CLS budget on this page.
 */
function Shell({ children, tone = 'normal' }: { children: React.ReactNode; tone?: 'normal' | 'danger' }) {
  return (
    <p
      className={`flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border px-3 py-2 text-meta ${
        tone === 'danger'
          ? 'border-danger bg-danger-wash text-danger'
          : 'border-line bg-raised text-ink'
      }`}
    >
      {children}
    </p>
  );
}
