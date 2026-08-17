'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Driver sign-in: a number, then a texted code.
 *
 * ⚠ TWO STEPS IN ONE COMPONENT, not two routes. A driver standing in a van
 * with the shop's text already open should never lose the page they were sent
 * to — see the layout header. Keeping both steps here keeps the URL intact.
 *
 * ⚠ THE SERVER DECIDES, NOT THIS FORM. Every refusal here is a message; the
 * roster check, the code check and the session minting all happen server-side
 * and none of them can be talked out of anything by this file.
 */
export function SignInForm({ expired }: { expired: boolean }) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [real, setReal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    // Distinguished from a failed attempt because it is not one: nothing was
    // typed wrong and the driver needs to know the session simply ran out.
    expired ? 'Your sign-in expired. Enter your number again.' : null,
  );

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/driver/otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const body = (await res.json()) as { reason?: string; phone?: string; real?: boolean };

      if (res.ok) {
        setSent(true);
        setReal(body.real !== false);
        if (typeof body.phone === 'string') setPhone(body.phone);
      } else if (body.reason === 'notOnRoster') {
        // Said plainly. This is a shop tool used by a handful of people, and a
        // worker who mistypes their own number needs to know that is what
        // happened — not be left waiting for a text that is never coming.
        setError('That number is not on the shop’s driver list. Ask the shop to add it.');
      } else if (body.reason === 'tooSoon') {
        setError('A code was just sent. Wait a moment before asking for another.');
      } else if (body.reason === 'notAvailable') {
        setError('Sign-in is not configured on this deployment.');
      } else {
        setError('That does not look like a phone number.');
      }
    } catch {
      setError('Could not reach the server. Check the connection and try again.');
    }
    setBusy(false);
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/driver/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });

      if (res.ok) {
        // `refresh()` re-runs the layout's server-side guard, which is what
        // actually decides whether the portal renders. A client-side redirect
        // would paint the shell before the guard had agreed.
        router.refresh();
        return;
      }

      const body = (await res.json()) as { reason?: string };
      setError(
        body.reason === 'notOnRoster'
          ? 'That number is no longer on the shop’s driver list.'
          : 'That code is not right. Check the text and try again.',
      );
    } catch {
      setError('Could not reach the server. Check the connection and try again.');
    }
    setBusy(false);
  }

  return (
    <form onSubmit={sent ? submitCode : sendCode} className="grid gap-5">
      <h1 className="!text-display">Deliveries</h1>
      <p className="text-body text-muted">
        {sent
          ? `Enter the code sent to ${phone}.`
          : 'Sign in with the number the shop has for you.'}
      </p>

      {!sent ? (
        <div className="grid gap-2">
          <label htmlFor="phone" className="text-body font-semibold">
            Your phone number
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            autoCapitalize="none"
            autoCorrect="off"
            className="tap-lg rounded-sm border border-line bg-raised px-3 text-body text-ink"
          />
        </div>
      ) : (
        <div className="grid gap-2">
          <label htmlFor="code" className="text-body font-semibold">
            Code
          </label>
          <input
            id="code"
            name="code"
            // `numeric`, not `tel` — a keypad without the letters and the
            // punctuation, because the only thing entered here is digits.
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="tnum tap-lg rounded-sm border border-line bg-raised px-3 text-lead text-ink"
          />
          {!real && (
            <p className="text-meta text-muted">
              This deployment uses a fixed development code. No text was sent.
            </p>
          )}
        </div>
      )}

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
        {busy ? 'Working' : sent ? 'Sign in' : 'Send me a code'}
      </button>

      {sent && (
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setCode('');
            setError(null);
          }}
          className="tap text-body text-muted underline underline-offset-4"
        >
          Use a different number
        </button>
      )}
    </form>
  );
}
