'use client';

import { useCart } from '@/ui/cart';

/**
 * The only pill-radius thing in the whole application.
 *
 * `04-PLAN` §9.7 allows `999px` here and nowhere else, and the exception is
 * written down so that "we already use a pill somewhere" cannot become the
 * argument for pill buttons later.
 */
export function BasketCount() {
  const { lines, ready } = useCart();

  // Renders nothing until storage has been read. Showing a zero first and then
  // correcting it makes a full basket look briefly lost, and the flash lands
  // exactly where the customer is looking.
  if (!ready || lines.length === 0) return null;

  return (
    <span className="tnum inline-flex min-w-6 items-center justify-center rounded-full bg-accent px-2 py-0.5 text-meta font-semibold text-accent-ink">
      {lines.length}
    </span>
  );
}
