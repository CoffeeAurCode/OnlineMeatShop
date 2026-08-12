'use client';

import { useState } from 'react';

import { t, type Locale } from '@/i18n';
import { money } from '@/ui/format';

/**
 * "Do you deliver to me?"
 *
 * ⭐ The first question every visitor to a delivery-only shop actually has,
 * and the reason it has its own control rather than living at checkout: the
 * failure code for getting it wrong, `outsideDeliveryArea` (P1), otherwise
 * fires after someone has built a whole basket.
 *
 * All four interaction states are here: idle, busy, the two answers, and two
 * distinct errors. A malformed postal code and an unreachable server are
 * different problems and the customer can act on exactly one of them, so they
 * do not share a message.
 */

type Result =
  | { served: true; postalCode: string; feeCents: number; freeAboveCents: number | null }
  | { served: false; postalCode: string };

export function PostcodeCheck({ locale }: { locale: Locale }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (value.trim() === '') return;
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/serviceable', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postalCode: value }),
      });
      if (!res.ok) {
        setError(t(locale, 'checkout.postalHelp'));
        setBusy(false);
        return;
      }
      setResult((await res.json()) as Result);
    } catch {
      setError(t(locale, 'errors.generic'));
    }
    setBusy(false);
  }

  return (
    <div>
      <form onSubmit={check} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="min-w-0">
          {/* Label ABOVE the input, always. Never a placeholder as a label. */}
          <label htmlFor="postcode" className="block text-body font-semibold">
            {t(locale, 'delivery.checkHeading')}
          </label>
          <input
            id="postcode"
            name="postcode"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="postal-code"
            inputMode="text"
            placeholder={t(locale, 'delivery.checkPlaceholder')}
            aria-describedby="postcode-help"
            className="tap mt-2 w-full rounded-sm border border-line bg-raised px-3 text-body text-ink placeholder:text-muted"
          />
          <p id="postcode-help" className="mt-2 text-meta text-muted">
            {t(locale, 'checkout.postalHelp')}
          </p>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="tap inline-flex items-center justify-center rounded-sm bg-accent px-6 text-body font-semibold text-accent-ink transition-colors duration-200 hover:bg-accent-hover disabled:opacity-60 active:scale-[0.98]"
        >
          {busy ? t(locale, 'common.loading') : t(locale, 'delivery.checkCta')}
        </button>
      </form>

      {/* `aria-live` so the answer is announced, not just painted. */}
      <div aria-live="polite" className="mt-4 empty:hidden">
        {error !== null && (
          <p className="rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">{error}</p>
        )}
        {result !== null && result.served && (
          <p className="rounded-sm border border-line bg-soft px-3 py-2 text-body">
            {result.feeCents === 0
              ? t(locale, 'delivery.servedFree')
              : t(locale, 'delivery.served', { fee: money(result.feeCents, locale) })}
          </p>
        )}
        {result !== null && !result.served && (
          <p className="rounded-sm border border-line bg-soft px-3 py-2 text-body">
            {t(locale, 'delivery.notServed')}
          </p>
        )}
      </div>
    </div>
  );
}
