import type { Metadata } from 'next';

import { currentBusinessDay } from '@/db/repositories/availability';
import { slotsFrom } from '@/db/repositories/fulfilment';
import { businessDateIn, shopTimeZone, slotWindow } from '@/ui/business-date';

import { CheckoutForm } from '../_components/checkout-form';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

// Slot capacity is point-in-time. A cached checkout page offers a slot that
// filled up ten minutes ago, and the customer finds out at the last step.
export const dynamic = 'force-dynamic';

/**
 * Loading the slots, including reading the clock.
 *
 * Deliberately outside the component: a render must be pure, and whether a
 * cut-off has passed is a fact about the moment the data was fetched rather
 * than about the moment React happens to render it.
 */
async function loadSlots(tz: string) {
  const today = businessDateIn(tz, new Date());
  const slots = await slotsFrom(today);
  const now = Date.now();

  return slots.map((s) => ({
    id: s.id,
    label: slotWindow(tz, new Date(s.startsAtMs), new Date(s.endsAtMs)),
    hotEligible: s.hotEligible,
    full: s.bookedCount >= s.capacity,
    cutoffPassed: s.cutoffAtMs <= now,
  }));
}

export default async function CheckoutPage() {
  const tz = shopTimeZone();
  const day = await currentBusinessDay();
  const slots = await loadSlots(tz);

  return (
    <main className="mx-auto max-w-[46rem] px-4 py-12">
      <h1 className="text-display font-semibold tracking-tight">Checkout</h1>

      {day === null ? (
        <p className="mt-8 rounded-md border border-line bg-raised px-4 py-8 text-body text-muted">
          The shop is not taking orders at the moment. Stock goes up each trading morning.
        </p>
      ) : (
        <CheckoutForm slots={slots} />
      )}
    </main>
  );
}
