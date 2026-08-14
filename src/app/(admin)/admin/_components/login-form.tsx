'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Staff sign-in.
 *
 * English only, like the rest of the console. Two fields and one button:
 * `04-PLAN` §11 density, and this is a screen somebody uses once a day with
 * one hand.
 *
 * ⚠ ONE MESSAGE FOR EVERY FAILURE except lockout. Distinguishing "no such
 * user" from "wrong password" turns the form into an account oracle, and the
 * server already refuses to tell us which it was.
 */
export function LoginForm({ expired }: { expired: boolean }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    // Distinguished from a failed attempt because it is not one: the operator
    // typed nothing wrong and needs to know the session simply ran out.
    expired ? 'Your session expired. Sign in again.' : null,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        // `refresh()` re-runs the layout's server-side guard, which is what
        // actually decides whether the console renders. A client-side redirect
        // would render the shell before the guard had agreed.
        router.refresh();
        return;
      }

      const body = (await res.json()) as { reason?: string; untilMs?: number };
      if (body.reason === 'locked' && typeof body.untilMs === 'number') {
        const minutes = Math.max(1, Math.ceil((body.untilMs - Date.now()) / 60_000));
        setError(`Too many attempts. Try again in ${minutes} minutes.`);
      } else if (body.reason === 'notConfigured') {
        setError('Sign-in is not configured on this deployment.');
      } else {
        setError('That username and password do not match.');
      }
    } catch {
      setError('Could not reach the server. Check the connection and try again.');
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <h1 className="!text-display">Console</h1>

      <div className="grid gap-2">
        <label htmlFor="username" className="text-body font-semibold">
          Username
        </label>
        <input
          id="username"
          name="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          className="tap-lg rounded-sm border border-line bg-raised px-3 text-body text-ink"
        />
      </div>

      <div className="grid gap-2">
        <label htmlFor="password" className="text-body font-semibold">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="tap-lg rounded-sm border border-line bg-raised px-3 text-body text-ink"
        />
      </div>

      {error !== null && (
        <p role="alert" className="rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="tap-lg rounded-sm bg-accent text-lead font-semibold text-accent-ink disabled:opacity-60 active:scale-[0.99]"
      >
        {busy ? 'Signing in' : 'Sign in'}
      </button>
    </form>
  );
}
