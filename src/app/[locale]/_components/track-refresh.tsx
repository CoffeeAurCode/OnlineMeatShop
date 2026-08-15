'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-fetches the tracking page on an interval, while the order is live.
 *
 * ⭐ POLLING, NOT A SOCKET, AND THAT IS THE RIGHT ANSWER HERE RATHER THAN THE
 * CHEAP ONE.
 *
 * Supabase Realtime was in the design and was cut at launch (D18). What moves
 * this page is the owner tapping a button in the console, which happens six or
 * seven times over the life of an order, spread across an hour. A persistent
 * connection to carry seven events, held open on a free instance that spins
 * down after fifteen minutes of quiet, would cost more than it delivers. A
 * request every thirty seconds is roughly a hundred and twenty requests for a
 * one-hour delivery, at two to six orders a day.
 *
 * ⚠ IT STOPS ONCE THE ORDER IS SETTLED. `DELIVERED` and `CANCELLED` are
 * terminal, so the parent does not render this component for them at all. A
 * tracking page left open in a background tab for a week is the version that
 * quietly generates twenty thousand requests, and the fix has to be structural
 * rather than a note asking somebody to remember.
 *
 * `router.refresh()` re-runs the Server Component and patches the tree in
 * place. It does NOT reload the document, so scroll position, focus and the
 * basket drawer all survive, and the customer sees the status change rather
 * than the page flash.
 */
export function TrackRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = window.setInterval(() => {
      // ⚠ Only while the tab is actually being looked at. A phone in a pocket
      // does not need the fish's status, and browsers throttle background
      // timers unevenly enough that the alternative is a burst of requests all
      // firing at once when the tab wakes up.
      if (document.visibilityState !== 'visible') return;
      router.refresh();
    }, seconds * 1000);

    return () => window.clearInterval(id);
  }, [router, seconds]);

  return null;
}
