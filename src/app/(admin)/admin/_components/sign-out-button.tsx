'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SignOutIcon } from '@phosphor-icons/react/dist/ssr';

/**
 * Sign out of the console.
 *
 * ⚠ THE CONSOLE HAD NO WAY OUT UNTIL NOW. `/api/admin/logout` has existed the
 * whole time and nothing called it, so signing out meant clearing a cookie by
 * hand — which is a problem the moment the owner opens the console on somebody
 * else's laptop, and a worse one when a staff account has to be got off a
 * phone that is leaving the building.
 *
 * ⚠ TOP-RIGHT, DELIBERATELY, and this is the one exception to `04-PLAN` §11's
 * rule that nothing important lives where a thumb cannot reach. Signing out by
 * accident at 6am with a wet hand is the failure worth designing against here,
 * so the corner that is hardest to hit one-handed is the correct place for it.
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch {
      // Swallowed: clearing the cookie is the server's job, and a failure here
      // leaves the operator signed in, which is the safe direction.
    }
    router.refresh();
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      title="Sign out"
      aria-label={busy ? 'Signing out' : 'Sign out'}
      className="press grid size-12 shrink-0 place-content-center rounded-full bg-soft text-muted transition-colors hover:text-ink disabled:opacity-60"
    >
      <SignOutIcon size={17} aria-hidden />
    </button>
  );
}
