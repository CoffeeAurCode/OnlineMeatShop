'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { lineKey, removeLine, setLineWeight, useCart, type CartLine } from '@/ui/cart';
import { money, weight } from '@/ui/format';

/**
 * The basket, priced by the server.
 *
 * Every amount here comes from `/api/quote`. Nothing is multiplied in the
 * browser, so the figure the customer reads is the figure the catalog gives,
 * and a stale page shows a stale total for exactly as long as it takes the
 * next quote to come back.
 *
 * Line problems are presentation class A (`04-PLAN` §10.3): the error sits
 * under the line it is about, in `--danger`, and the page does not move.
 */

interface QuotedLine {
  productId: string;
  slug: string;
  name: string;
  requestedG: number;
  prepOptionId: string | null;
  amountCents: number;
  isEstimate: boolean;
  problem: 'productUnavailable' | 'invalidQuantity' | 'insufficientStock' | null;
  availableG: number | null;
}

interface Quote {
  lines: QuotedLine[];
  lineSubtotalCents: number;
  hasEstimate: boolean;
  hasHotLine: boolean;
  problems: string[];
}

export function BasketView() {
  const { lines, ready } = useCart();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // No `setQuote(null)` on the way out. An empty basket renders its own
    // early return below, so a leftover quote is never displayed, and
    // clearing it here would be a cascading render for a value nothing reads.
    if (!ready || lines.length === 0) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch('/api/quote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            lines: lines.map((l) => ({
              productId: l.productId,
              requestedG: l.requestedG,
              prepOptionId: l.prepOptionId,
            })),
            postalCode: null,
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        setFailed(false);
        setQuote((await res.json()) as Quote);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lines, ready]);

  if (!ready) {
    // A skeleton shaped like the final layout, not a spinner. The list is
    // about to occupy this space and moving the page afterwards is worse than
    // waiting in the right shape.
    return (
      <div className="mt-8 space-y-4" aria-hidden>
        {[0, 1].map((i) => (
          <div key={i} className="h-20 rounded-md border border-line bg-raised" />
        ))}
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="mt-8 rounded-md border border-line bg-raised px-4 py-10">
        <p className="text-section font-semibold tracking-tight">Nothing in here yet</p>
        <p className="mt-2 max-w-[55ch] text-body text-muted">
          What we have changes every trading day, because everything is cut fresh and nothing rolls
          over.
        </p>
        <Link
          href="/shop"
          className="tap-lg mt-6 inline-flex items-center rounded-sm bg-accent px-5 text-lead font-semibold text-accent-ink"
        >
          See what we have today
        </Link>
      </div>
    );
  }

  const quoted = new Map(quote?.lines.map((l) => [`${l.productId}:${l.prepOptionId ?? ''}`, l]));
  const blocked = quote !== null && quote.problems.length > 0;

  return (
    <>
      <ul className="mt-8">
        {lines.map((line) => {
          const key = lineKey(line);
          const q = quoted.get(key);
          return (
            <li key={key} className="border-b border-line py-4">
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <Link href={`/p/${line.slug}`} className="text-body font-semibold">
                    {line.name}
                  </Link>
                  {line.prepLabel !== null ? (
                    <p className="mt-0.5 text-meta text-muted">{line.prepLabel}</p>
                  ) : null}
                </div>
                <p className="tnum shrink-0 text-body">
                  {q === undefined ? '· · ·' : money(q.amountCents)}
                  {q?.isEstimate === true ? <span className="text-muted"> est.</span> : null}
                </p>
              </div>

              <div className="mt-3 flex items-center justify-between gap-4">
                <p className="tnum text-meta text-muted">{weight(line.requestedG)}</p>
                <div className="flex items-center gap-3">
                  <QuantityButtons line={line} />
                  <button
                    type="button"
                    onClick={() => removeLine(key)}
                    className="tap px-2 text-meta text-muted underline underline-offset-4"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {q?.problem != null ? (
                <p className="mt-3 rounded-sm bg-danger-wash px-3 py-2 text-meta text-danger">
                  {problemCopy(q)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {failed ? (
        <p role="alert" className="mt-4 rounded-sm bg-danger-wash px-3 py-3 text-body text-danger">
          We could not price your basket just now. Reload the page.
        </p>
      ) : null}

      <div className="mt-6 flex items-baseline justify-between gap-4">
        <span className="text-lead font-semibold">Items</span>
        <span className="tnum text-lead font-semibold">
          {quote === null ? '· · ·' : money(quote.lineSubtotalCents)}
        </span>
      </div>

      {quote?.hasEstimate === true ? (
        <p className="mt-2 text-body text-muted">
          Items cut to order are estimates until they are weighed. Delivery is worked out at
          checkout, once we know where you are.
        </p>
      ) : null}

      {quote?.hasHotLine === true ? (
        <p className="mt-4 rounded-sm bg-hot-wash px-3 py-3 text-body text-hot">
          Your basket has hot food, so only slots we can get it to you hot in will be offered.
        </p>
      ) : null}

      <Link
        href="/checkout"
        aria-disabled={blocked}
        onClick={(e) => {
          if (blocked) e.preventDefault();
        }}
        className={`tap-lg mt-8 flex w-full items-center justify-center rounded-sm px-4 text-lead font-semibold ${
          blocked
            ? 'cursor-not-allowed border border-line bg-raised text-muted'
            : 'bg-accent text-accent-ink hover:bg-accent-hover'
        }`}
      >
        {blocked ? 'Fix the items above first' : 'Checkout'}
      </Link>
    </>
  );
}

function QuantityButtons({ line }: { line: CartLine }) {
  // The basket does not know the product's step size, so it nudges by the
  // weight already chosen rather than inventing one. Anything illegal is
  // caught server-side and reported on the line.
  const step = line.requestedG >= 1000 ? 250 : 100;
  const key = lineKey(line);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setLineWeight(key, Math.max(step, line.requestedG - step))}
        aria-label={`Less ${line.name}`}
        className="tap w-11 rounded-sm border border-line bg-raised"
      >
        －
      </button>
      <button
        type="button"
        onClick={() => setLineWeight(key, line.requestedG + step)}
        aria-label={`More ${line.name}`}
        className="tap w-11 rounded-sm border border-line bg-raised"
      >
        ＋
      </button>
    </div>
  );
}

function problemCopy(q: QuotedLine): string {
  switch (q.problem) {
    case 'productUnavailable':
      return 'We have taken this off the shop. Remove it to carry on.';
    case 'invalidQuantity':
      return 'We cannot cut that amount. Nudge it up or down and it will fix itself.';
    case 'insufficientStock':
      return q.availableG === null || q.availableG === 0
        ? 'This has gone for today.'
        : `Only ${weight(q.availableG)} left today.`;
    default:
      return '';
  }
}
