'use client';

import { useState } from 'react';
import Link from 'next/link';

import { t, type Locale } from '@/i18n';
import { money } from '@/ui/format';

/**
 * The "my orders" list, once a code has been accepted.
 *
 * ⚠ THE ORDERS LIVE IN COMPONENT STATE, NOT IN A COOKIE OR IN STORAGE.
 *
 * The server deliberately returns the list for one request rather than
 * minting a session, because a session would be a durable credential created
 * from an UNVERIFIED phone number. Keeping the result in memory means closing
 * the tab ends the access, which is the correct blast radius while the
 * verifier is a stub that accepts a fixed code.
 *
 * Each row links to its own token page, so there is one credential in the
 * system rather than two.
 */

interface HistoryOrder {
  publicToken: string;
  status: string;
  placedAtMs: number;
  estTotalCents: number;
  finalTotalCents: number | null;
}

export function OrderHistory({ locale }: { locale: Locale }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<HistoryOrder[] | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/session/customer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });

      if (res.ok) {
        const body = (await res.json()) as { orders: HistoryOrder[] };
        setOrders(body.orders);
      } else {
        setError(t(locale, 'verify.wrongCode'));
      }
    } catch {
      setError(t(locale, 'errors.generic'));
    }
    setBusy(false);
  }

  if (orders !== null) {
    if (orders.length === 0) {
      return (
        <div className="mt-8 rounded-md border border-line bg-raised px-6 py-14 text-center">
          <p className="text-lead font-semibold">{t(locale, 'order.historyEmpty')}</p>
          <p className="mx-auto mt-2 max-w-[36ch] text-body text-muted">
            {t(locale, 'order.historyEmptyBody')}
          </p>
        </div>
      );
    }

    return (
      <ul className="mt-8 grid gap-3">
        {orders.map((o) => (
          <li key={o.publicToken}>
            <Link
              href={`/${locale}/orders/${o.publicToken}`}
              className="flex items-center justify-between gap-4 rounded-md border border-line bg-raised px-4 py-4 transition-colors hover:border-accent"
            >
              <span className="min-w-0">
                <span className="block text-body font-semibold">
                  {t(locale, `status.${o.status}`)}
                </span>
                <span className="tnum block text-meta text-muted">
                  {new Date(o.placedAtMs).toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA')}
                </span>
              </span>
              <span className="tnum shrink-0 text-body font-semibold">
                {/*
                  The final total once it exists, the estimate until then, and
                  never both: a list is for recognising an order, not for
                  auditing it. The token page shows the full comparison.
                */}
                {money(o.finalTotalCents ?? o.estTotalCents, locale)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 grid gap-5">
      <p className="text-body text-muted">{t(locale, 'verify.body')}</p>

      {/*
        ⚠ Said plainly, on the screen, not only in a comment. Nobody using this
        should believe their number was checked.
      */}
      <p className="rounded-sm border border-line bg-soft px-3 py-2 text-meta">
        {t(locale, 'verify.devNotice')}
      </p>

      <div className="grid gap-2">
        <label htmlFor="hist-phone" className="text-body font-semibold">
          {t(locale, 'checkout.phoneLabel')}
        </label>
        <input
          id="hist-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="tap rounded-sm border border-line bg-raised px-3 text-body text-ink"
        />
      </div>

      <div className="grid gap-2">
        <label htmlFor="hist-code" className="text-body font-semibold">
          {t(locale, 'verify.codeLabel')}
        </label>
        <input
          id="hist-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-describedby="hist-code-help"
          className="tap rounded-sm border border-line bg-raised px-3 text-body text-ink"
        />
        <p id="hist-code-help" className="text-meta text-muted">
          {t(locale, 'verify.codeHelp')}
        </p>
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
        {busy ? t(locale, 'common.loading') : t(locale, 'verify.verify')}
      </button>
    </form>
  );
}
