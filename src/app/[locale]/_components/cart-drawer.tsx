'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { TrashIcon, XIcon } from '@phosphor-icons/react/dist/ssr';

import type { Locale } from '@/i18n';
import { t } from '@/i18n';
import { lineKey, removeLine, useCart, type CartLine } from '@/ui/cart';
import { money, weight } from '@/ui/format';

import { closeCart, useCartOpen } from './drawer-state';

/**
 * The basket, as a slide-over.
 *
 * ⚠ EVERY AMOUNT IN HERE COMES FROM THE SERVER. The drawer holds intent and
 * asks `/api/quote` what it costs. It never multiplies a rate by a weight,
 * because a second implementation of the price is a second answer, and the one
 * the customer sees would be the one that is wrong.
 *
 * The consequence is that the drawer has a LOADING state for its own totals,
 * which most cart drawers do not. That is the honest trade and it is why the
 * line list renders immediately from local state while only the money waits.
 */

interface QuoteLine {
  productId: string;
  prepOptionId: string | null;
  name: string;
  amountCents: number;
  isEstimate: boolean;
  problem: string | null;
}

interface QuoteResponse {
  lines: QuoteLine[];
  lineSubtotalCents: number;
  estTotalCents: number | null;
  hasEstimate: boolean;
}

export function CartDrawer({ locale }: { locale: Locale }) {
  const open = useCartOpen();
  const cart = useCart();
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  const signature = cart.lines.map((l) => `${lineKey(l)}@${l.requestedG}`).join('|');

  // Re-quote whenever the basket changes, and only while the drawer is open:
  // a closed drawer has nothing to show and the request would be wasted.
  useEffect(() => {
    if (!open || cart.lines.length === 0) {
      setQuote(null);
      return;
    }
    const controller = new AbortController();
    setFailed(false);

    void fetch('/api/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        lines: cart.lines.map((l) => ({
          productId: l.productId,
          requestedG: l.requestedG,
          prepOptionId: l.prepOptionId,
        })),
        postalCode: null,
        locale,
      }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<QuoteResponse>) : Promise.reject(new Error('quote'))))
      .then(setQuote)
      .catch((error: unknown) => {
        // An aborted request is the effect cleaning up after itself, not a
        // failure, and showing an error for it would flash on every keystroke.
        if (error instanceof Error && error.name === 'AbortError') return;
        setFailed(true);
      });

    return () => controller.abort();
  }, [open, signature, locale, cart.lines]);

  // Escape closes, and the body does not scroll behind the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCart();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const empty = cart.lines.length === 0;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={t(locale, 'nav.close')}
        onClick={closeCart}
        className="absolute inset-0 bg-[rgb(3_25_35/0.55)] motion-safe:animate-[fade-in_200ms_ease-out]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, 'basket.title')}
        /*
          Full-screen sheet below 1024px, a 420px panel above. `100dvh` not
          `100vh`: on iOS Safari the address bar makes `vh` taller than the
          visible viewport, which puts the checkout button under the chrome.
        */
        className="absolute inset-y-0 right-0 flex h-[100dvh] w-full flex-col bg-surface shadow-2xl motion-safe:animate-[slide-in_260ms_var(--ease-brand)] lg:w-[420px]"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-4 sm:px-6">
          <h2 className="!text-display">{t(locale, 'basket.title')}</h2>
          <button
            ref={closeButton}
            type="button"
            onClick={closeCart}
            aria-label={t(locale, 'nav.close')}
            className="tap grid size-11 place-items-center rounded-sm border border-line bg-raised active:scale-[0.94]"
          >
            <XIcon size={18} weight="bold" aria-hidden />
          </button>
        </header>

        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-lead font-semibold">{t(locale, 'basket.empty')}</p>
            <p className="max-w-[32ch] text-body text-muted">{t(locale, 'basket.emptyBody')}</p>
            <Link
              href={`/${locale}/shop`}
              onClick={closeCart}
              className="tap inline-flex items-center rounded-sm bg-accent px-5 text-body font-semibold text-accent-ink"
            >
              {t(locale, 'basket.emptyCta')}
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-line overflow-y-auto px-4 sm:px-6">
              {cart.lines.map((line) => (
                <DrawerLine
                  key={lineKey(line)}
                  line={line}
                  locale={locale}
                  amountCents={
                    quote?.lines.find(
                      (q) =>
                        q.productId === line.productId && q.prepOptionId === line.prepOptionId,
                    )?.amountCents ?? null
                  }
                />
              ))}
            </ul>

            <footer
              className="border-t border-line px-4 py-4 sm:px-6"
              // Without this the checkout button sits under the iPhone home
              // indicator and is genuinely unpressable.
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            >
              {failed ? (
                <p className="mb-3 rounded-sm bg-danger-wash px-3 py-2 text-meta text-danger">
                  {t(locale, 'errors.generic')}
                </p>
              ) : (
                <div className="mb-3 flex items-baseline justify-between">
                  <span className="text-body font-semibold">{t(locale, 'basket.subtotal')}</span>
                  <span className="tnum text-section font-semibold">
                    {quote === null ? (
                      <span className="inline-block h-5 w-20 animate-pulse rounded-sm bg-soft align-middle motion-reduce:animate-none" />
                    ) : (
                      money(quote.lineSubtotalCents, locale)
                    )}
                  </span>
                </div>
              )}
              <p className="mb-4 text-meta text-muted">{t(locale, 'basket.estimateNote')}</p>
              <Link
                href={`/${locale}/checkout`}
                onClick={closeCart}
                className="tap-lg flex items-center justify-center rounded-sm bg-accent text-lead font-semibold text-accent-ink transition-colors duration-200 hover:bg-accent-hover active:scale-[0.99]"
              >
                {t(locale, 'basket.checkout')}
              </Link>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

function DrawerLine({
  line,
  locale,
  amountCents,
}: {
  line: CartLine;
  locale: Locale;
  amountCents: number | null;
}) {
  const key = lineKey(line);
  return (
    <li className="flex gap-3 py-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold">{line.name}</p>
        {line.prepLabel !== null && <p className="text-meta text-muted">{line.prepLabel}</p>}
        <p className="tnum mt-1 text-meta text-muted">{weight(line.requestedG, locale)}</p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <span className="tnum text-body font-semibold">
          {amountCents === null ? (
            <span className="inline-block h-4 w-14 animate-pulse rounded-sm bg-soft motion-reduce:animate-none" />
          ) : (
            money(amountCents, locale)
          )}
        </span>
        <button
          type="button"
          onClick={() => removeLine(key)}
          aria-label={t(locale, 'basket.removeItem', { name: line.name })}
          className="tap grid size-11 place-items-center rounded-sm text-muted transition-colors hover:text-danger active:scale-[0.94]"
        >
          <TrashIcon size={16} aria-hidden />
        </button>
      </div>
    </li>
  );
}
