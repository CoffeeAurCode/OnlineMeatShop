'use client';

import { useState } from 'react';

import { money } from '@/ui/format';

/**
 * "Do you deliver to me?"
 *
 * ⭐ The hero's primary control, and the one structural argument in the design
 * direction (`04-PLAN` §10.1). This shop is delivery-only inside a radius, so
 * this is the first question every visitor actually has. The failure code for
 * getting it wrong, `outsideDeliveryArea` (P1), otherwise fires at checkout,
 * after someone has built a whole basket.
 *
 * Presentation class C (`04-PLAN` §10.3): a notice naming the area, with
 * exactly one action.
 */

type Result =
  | { served: true; postalCode: string; feeCents: number; freeAboveCents: number | null }
  | { served: false; postalCode: string };

export function PostcodeCheck() {
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
        setError('That does not look like a postal code. Try the first three characters.');
        setBusy(false);
        return;
      }
      setResult((await res.json()) as Result);
    } catch {
      setError('We could not check just now. Try again in a moment.');
    }
    setBusy(false);
  }

  return (
    <div>
      <form onSubmit={check} className="flex flex-wrap items-end gap-3">
        <div className="grow">
          <label htmlFor="postcode" className="block text-body font-semibold">
            Do we deliver to you?
          </label>
          <input
            id="postcode"
            name="postcode"
            type="text"
            autoComplete="postal-code"
            placeholder="A1A 1A1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-describedby={error === null ? undefined : 'postcode-error'}
            aria-invalid={error !== null}
            className={`tap mt-2 w-full rounded-sm border bg-raised px-3 text-body ${
              error === null ? 'border-line' : 'border-danger'
            }`}
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="tap shrink-0 rounded-sm bg-accent px-5 text-body font-semibold text-accent-ink transition-colors hover:bg-accent-hover active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? 'Checking' : 'Check'}
        </button>
      </form>

      {error !== null ? (
        <p id="postcode-error" role="alert" className="mt-3 text-body text-danger">
          {error}
        </p>
      ) : null}

      {result !== null ? (
        <p
          role="status"
          className={`mt-3 rounded-sm px-3 py-3 text-body ${
            result.served ? 'bg-raised text-ink' : 'bg-danger-wash text-danger'
          }`}
        >
          {result.served ? (
            <>
              Yes, we deliver to {result.postalCode}.{' '}
              {result.feeCents === 0 ? (
                'Delivery is free.'
              ) : (
                <>
                  Delivery is {money(result.feeCents)}
                  {result.freeAboveCents === null
                    ? '.'
                    : `, or free over ${money(result.freeAboveCents)}.`}
                </>
              )}
            </>
          ) : (
            <>
              We do not deliver to {result.postalCode} yet. We only cover a small local radius, and
              there is no counter to collect from.
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
