'use client';

import { useEffect, useState } from 'react';

/**
 * A PERSISTENT bar, not a toast.
 *
 * `04-PLAN` §4 requires the owner to know that a write did not save. A toast
 * that disappears after four seconds is the exact opposite of that
 * requirement: the one time it matters is the time they looked away.
 *
 * There is deliberately no offline write queue behind this. An order placed
 * against stale stock is the highest-severity defect class in the system, so
 * being unable to save is the correct behaviour and this bar is how it is
 * reported. A spinner would be a lie.
 */
export function OfflineBar() {
  // Starts optimistic: `navigator.onLine` is unavailable during the server
  // render, and flashing "you are offline" on every page load would train the
  // owner to ignore the one bar they must never ignore.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  if (online) return null;

  return (
    <p
      role="status"
      aria-live="assertive"
      className="sticky top-0 z-10 bg-danger px-4 py-3 text-center text-body font-semibold text-danger-ink"
    >
      You are offline. Nothing you enter now will save.
    </p>
  );
}
