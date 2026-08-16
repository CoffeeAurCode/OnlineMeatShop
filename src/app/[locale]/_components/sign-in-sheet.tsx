'use client';

import { useEffect, useRef, useState } from 'react';
import { SpinnerGapIcon, XIcon } from '@phosphor-icons/react/dist/ssr';

import { t, type Locale } from '@/i18n';
import { useCustomerSession, type HistoryOrder } from '@/ui/customer-session';

import { closeSignIn, useSignInOpen } from './drawer-state';

/**
 * ⭐ THE SIGN-IN SHEET. A phone number, a texted code, and nothing else.
 *
 * ══ WHY THERE IS NO PASSWORD, NO EMAIL AND NO "CREATE ACCOUNT" ════════════
 *
 * The customer is on a phone, one-handed, deciding whether fish is worth the
 * trouble. Every field is a chance to leave. A number they already know plus a
 * code that arrives by itself is the shortest path to a proven identity, and
 * the number is the thing the shop actually needs anyway — it is what the
 * driver rings from the door.
 *
 * ⭐ ONE BUTTON FOR SIGN IN AND SIGN UP, AND THAT IS A SECURITY PROPERTY, NOT
 * A UX ONE. If the two were different buttons, or gave different answers, the
 * phone field would become a lookup tool: type numbers, learn who shops here.
 * The server returns the same response either way and this screen asks the
 * same question either way.
 *
 * ══ THE TWO STEPS ═════════════════════════════════════════════════════════
 *
 * `phone` → `code`. Going back to `phone` is always available, because the
 * single most common failure is a typo in the number, and a screen that traps
 * somebody on "enter the code we sent to the wrong number" is a screen they
 * close.
 *
 * ⚠ THE RESEND BUTTON IS DISABLED ON A COUNTDOWN. Supabase refuses a second
 * code within a few seconds and answers 429; without the countdown the
 * customer taps, gets an error, and concludes the shop is broken. The
 * countdown turns a refusal into an expectation.
 */

export function SignInSheet({ locale }: { locale: Locale }) {
  const open = useSignInOpen();
  if (!open) return null;
  return <Sheet locale={locale} />;
}

/** Seconds before the code may be asked for again. Supabase's own floor is 5. */
const RESEND_AFTER_S = 30;

function Sheet({ locale }: { locale: Locale }) {
  const { adopt } = useCustomerSession();
  const panel = useRef<HTMLDivElement>(null);
  const phoneField = useRef<HTMLInputElement>(null);
  const codeField = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  /** The NORMALISED number the server said it texted. Shown, never re-parsed. */
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const field = step === 'phone' ? phoneField.current : codeField.current;
    field?.focus();
  }, [step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSignIn();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const body = (await res.json()) as { ok?: boolean; phone?: string; real?: boolean; reason?: string };

      if (res.ok && body.ok === true) {
        setSentTo(body.phone ?? phone);
        setDevMode(body.real === false);
        setStep('code');
        setCooldown(RESEND_AFTER_S);
      } else {
        setError(t(locale, `auth.${body.reason ?? 'notAvailable'}`));
        // A 429 means a code is already in flight. Start the countdown anyway,
        // so the next tap is possible rather than another refusal.
        if (res.status === 429) setCooldown(RESEND_AFTER_S);
      }
    } catch {
      setError(t(locale, 'errors.generic'));
    }
    setBusy(false);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: sentTo, code }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        phone?: string;
        orders?: HistoryOrder[];
        reason?: string;
      };

      if (res.ok && body.ok === true) {
        /*
         * ⭐ ADOPT BEFORE CLOSING. The checkout page re-renders on the session
         * change and its "Place order" button becomes live in the same frame
         * the sheet disappears. Closing first and refreshing after leaves a
         * beat where the customer is signed in and the button still says sign
         * in — short, and exactly long enough to be tapped.
         */
        adopt(body.phone ?? sentTo, body.orders ?? []);
        closeSignIn();
      } else {
        setError(t(locale, `auth.${body.reason ?? 'wrongCode'}`));
      }
    } catch {
      setError(t(locale, 'errors.generic'));
    }
    setBusy(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-sheet-title"
    >
      <button
        type="button"
        onClick={closeSignIn}
        aria-label={t(locale, 'auth.close')}
        className="absolute inset-0 animate-[fade-in_200ms_ease-out] bg-midnight/55 backdrop-blur-[2px]"
      />

      <div
        ref={panel}
        className="
          elev relative z-10 max-h-[92dvh] w-full max-w-[28rem] animate-[sheet-up_220ms_cubic-bezier(0.22,1,0.36,1)]
          overflow-hidden rounded-t-lg bg-raised sm:rounded-lg
        "
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2
              id="signin-sheet-title"
              className="!font-sans !text-section !pb-0 !tracking-normal font-semibold"
            >
              {t(locale, step === 'phone' ? 'auth.title' : 'auth.codeTitle')}
            </h2>
            <p className="mt-1 max-w-[34ch] text-meta text-muted">
              {step === 'phone'
                ? t(locale, 'auth.body')
                : t(locale, 'auth.codeSentTo', { phone: sentTo })}
            </p>
          </div>
          <button
            type="button"
            onClick={closeSignIn}
            aria-label={t(locale, 'auth.close')}
            className="tap -mr-2 grid w-11 shrink-0 place-items-center rounded-sm text-muted hover:text-ink"
          >
            <XIcon size={20} aria-hidden />
          </button>
        </header>

        {step === 'phone' ? (
          <form onSubmit={send} className="grid gap-4 px-5 py-5">
            <div className="grid gap-2">
              <label htmlFor="signin-phone" className="text-body font-semibold">
                {t(locale, 'auth.phoneLabel')}
              </label>
              <input
                ref={phoneField}
                id="signin-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-describedby="signin-phone-help"
                className="tap-lg rounded-sm border border-line bg-soft px-3 text-lead text-ink"
              />
              <p id="signin-phone-help" className="text-meta text-muted">
                {t(locale, 'auth.phoneHelp')}
              </p>
            </div>

            {error !== null && (
              <p role="alert" className="rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || phone.trim() === ''}
              className="tap-lg flex items-center justify-center gap-2 rounded-sm bg-accent text-lead font-semibold text-accent-ink disabled:opacity-50 active:scale-[0.99]"
            >
              {busy && <SpinnerGapIcon size={18} className="animate-spin" aria-hidden />}
              {busy ? t(locale, 'auth.sending') : t(locale, 'auth.proceed')}
            </button>

            <p className="text-center text-meta text-muted">{t(locale, 'auth.terms')}</p>
          </form>
        ) : (
          <form onSubmit={verify} className="grid gap-4 px-5 py-5">
            {devMode && (
              <p className="rounded-sm border border-line bg-soft px-3 py-2 text-meta">
                {t(locale, 'auth.devNotice')}
              </p>
            )}

            <div className="grid gap-2">
              <label htmlFor="signin-code" className="text-body font-semibold">
                {t(locale, 'auth.codeLabel')}
              </label>
              <input
                ref={codeField}
                id="signin-code"
                name="code"
                /*
                 * `one-time-code` is what makes iOS and Android offer the code
                 * from the notification instead of making somebody memorise
                 * six digits and switch apps. It is the single highest-value
                 * attribute on this screen.
                 */
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="tap-lg tnum rounded-sm border border-line bg-soft px-3 text-display-sm tracking-[0.3em] text-ink"
              />
            </div>

            {error !== null && (
              <p role="alert" className="rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || code.trim() === ''}
              className="tap-lg flex items-center justify-center gap-2 rounded-sm bg-accent text-lead font-semibold text-accent-ink disabled:opacity-50 active:scale-[0.99]"
            >
              {busy && <SpinnerGapIcon size={18} className="animate-spin" aria-hidden />}
              {busy ? t(locale, 'auth.verifying') : t(locale, 'auth.verify')}
            </button>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setStep('phone');
                  setCode('');
                  setError(null);
                }}
                className="tap text-meta text-muted underline underline-offset-4"
              >
                {t(locale, 'auth.changeNumber')}
              </button>
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || cooldown > 0}
                className="tap text-meta text-muted underline underline-offset-4 disabled:no-underline disabled:opacity-60"
              >
                {cooldown > 0
                  ? t(locale, 'auth.resendIn', { seconds: cooldown })
                  : t(locale, 'auth.resend')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
