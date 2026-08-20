'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/ssr';

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
 *
 * ⚠ IT LIVES IN THE TOP BAR NOW, so it runs on EVERY console screen rather
 * than only the order queue. That is the doctrine applied consistently: the
 * figure you are looking at was read after you last looked away, whichever
 * screen you are on. It is safe on the form screens because a soft refresh
 * re-renders the server tree and leaves client state — and therefore anything
 * half-typed into a field — exactly where it was.
 */
export function RefreshButton({ compact = false }: { compact?: boolean }) {
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

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        title="Read the numbers again"
        aria-label={pending ? 'Refreshing' : 'Refresh'}
        aria-live="polite"
        className="press grid size-9 shrink-0 place-content-center rounded-full bg-soft text-muted transition-colors hover:text-ink"
      >
        <ArrowsClockwiseIcon
          size={17}
          aria-hidden
          className={pending ? 'animate-spin' : undefined}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      className="tap shrink-0 rounded-full border border-line bg-raised px-4 text-body font-semibold"
      aria-live="polite"
    >
      {pending ? 'Refreshing' : 'Refresh'}
    </button>
  );
}
