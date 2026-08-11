'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';

/**
 * Explicit refresh, plus a refresh when the phone comes back to the app.
 *
 * The focus listener is the one that matters in practice: the owner puts the
 * phone down, cuts meat for ten minutes, picks it up and reads a screen that
 * was rendered before any of that happened. Refreshing on focus means the
 * numbers they act on were fetched after they last looked away.
 *
 * `router.refresh()` re-runs the Server Component against the database. There
 * is no client-side cache to invalidate because there is no client-side cache.
 */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      startTransition(() => router.refresh());
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [router]);

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      className="tap shrink-0 rounded-sm border border-line bg-raised px-4 text-body font-semibold"
      aria-live="polite"
    >
      {pending ? 'Refreshing' : 'Refresh'}
    </button>
  );
}
