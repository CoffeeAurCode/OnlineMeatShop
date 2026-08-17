'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * The button that spends the link.
 *
 * ⚠ A BUTTON THAT POSTS, NEVER A REDIRECT ON RENDER. The whole single-use
 * design rests on the token being spent by a deliberate human action: a link
 * preview bot issues a GET, and a GET here must change nothing. See the page's
 * header for why that matters on every single dispatch.
 */
export function ClaimForm({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/driver/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = (await res.json()) as { ok?: boolean; to?: string; reason?: string };

      if (res.ok && body.ok === true) {
        /*
         * `replace`, not `push`. The link is spent, so leaving this page in the
         * history means a back-swipe lands on a screen whose button can only
         * fail from now on.
         */
        router.replace(body.to ?? '/driver');
        return;
      }

      setError(
        body.reason === 'spent'
          ? 'This link has just been used. If that was not you, tell the shop.'
          : body.reason === 'expired'
            ? 'This link has expired. Sign in with your number instead.'
            : body.reason === 'deactivated'
              ? 'You are not on the shop’s driver list any more.'
              : 'That did not work. Sign in with your number instead.',
      );
    } catch {
      setError('Could not reach the server. Check the connection and try again.');
    }
    setBusy(false);
  }

  return (
    <>
      {error !== null && (
        <p role="alert" className="rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void claim()}
        disabled={busy}
        className="tap-lg rounded-sm bg-accent text-lead font-semibold text-accent-ink disabled:opacity-60 active:scale-[0.99]"
      >
        {busy ? 'Signing in' : 'Open my deliveries'}
      </button>

      <Link
        href="/driver"
        className="tap text-center text-body text-muted underline underline-offset-4"
      >
        Sign in with my number instead
      </Link>
    </>
  );
}
