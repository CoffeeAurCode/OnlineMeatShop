'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Sign out.
 *
 * ⚠ Placed at the BOTTOM of the job list and nowhere else — never beside the
 * delivery button. A driver's phone is used one-handed, outdoors, often in the
 * dark, and the cost of a mis-tap here is being locked out of the round until
 * another text arrives.
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/driver/logout', { method: 'POST' });
    } catch {
      // Swallowed: the cookie clear is the server's job, and a failure here
      // leaves the driver signed in, which is the safe direction.
    }
    router.refresh();
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="tap text-body text-muted underline underline-offset-4 disabled:opacity-60"
    >
      {busy ? 'Signing out' : 'Sign out'}
    </button>
  );
}
