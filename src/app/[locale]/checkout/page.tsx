import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { currentBusinessDay } from '@/db/repositories/availability';
import { slotsFrom } from '@/db/repositories/fulfilment';
import { isLocale, t, type Locale } from '@/i18n';
import { businessDateIn, businessDatePlus, shopTimeZone, slotWindow } from '@/ui/business-date';

import { readSettings } from '@/db/repositories/settings';

import { CheckoutForm } from '../_components/checkout-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const l: Locale = isLocale(locale) ? locale : 'fr';
  return { title: t(l, 'checkout.title'), robots: { index: false, follow: false } };
}

// Slot capacity is point-in-time. A cached checkout page offers a window that
// filled up ten minutes ago, and the customer finds out at the last step.
export const dynamic = 'force-dynamic';

/**
 * Loading the slots, including reading the clock.
 *
 * Deliberately outside the component: a render must be pure, and whether a
 * cut-off has passed is a fact about the moment the data was fetched rather
 * than about the moment React happens to render it.
 */
/**
 * How many days ahead a window may be chosen, counting today.
 *
 * DTM §19 DQ-9, an assumption rather than a client answer: three days keeps
 * every booked slot well inside the life of a card authorisation, since the
 * money is only captured once the fish has been weighed. The seed deliberately
 * creates more days than this — see `slotsFrom`.
 */
const BOOKING_HORIZON_DAYS = 3;

async function loadSlots(tz: string, locale: Locale) {
  const now = new Date();
  const today = businessDateIn(tz, now);
  const slots = await slotsFrom(today, businessDatePlus(tz, now, BOOKING_HORIZON_DAYS - 1));
  const nowMs = now.getTime();

  return slots.map((s) => ({
    id: s.id,
    label: slotWindow(tz, new Date(s.startsAtMs), new Date(s.endsAtMs), locale),
    hotEligible: s.hotEligible,
    full: s.bookedCount >= s.capacity,
    cutoffPassed: s.cutoffAtMs <= nowMs,
  }));
}

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const tz = shopTimeZone();
  const day = await currentBusinessDay();
  const slots = await loadSlots(tz, locale);
  // Whether the shop is taking cash today. A display decision — the route
  // handler re-reads it and is the one that binds. See `CheckoutForm`.
  const settings = await readSettings();

  return (
    <div className="mx-auto max-w-[36rem] px-4 py-10 sm:px-6 sm:py-14">
      {/*
        One column, capped at 560px, at every width. A checkout that reflows
        into two columns on a laptop makes the reader hunt for the next field,
        and there is nothing here worth the extra horizontal space.
      */}
      <h1 className="!text-display-lg">{t(locale, 'checkout.title')}</h1>

      {day === null ? (
        <p className="mt-8 rounded-md border border-line bg-raised px-4 py-8 text-body text-muted">
          {t(locale, 'errors.shopClosed')}
        </p>
      ) : (
        <CheckoutForm slots={slots} locale={locale} codEnabled={settings['checkout.codEnabled']} />
      )}
    </div>
  );
}
