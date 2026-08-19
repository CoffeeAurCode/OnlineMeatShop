'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { FlameIcon, MapPinIcon, TrashIcon, XIcon } from '@phosphor-icons/react/dist/ssr';

import type { Locale } from '@/i18n';
import { quoteProblemMessage, t } from '@/i18n';
import { isPainted, thumb } from '@/ui/art';
import { lineKey, removeLine, setLineWeight, useCart, type CartLine } from '@/ui/cart';
import { money } from '@/ui/format';
import { hasDestination, locationLabel, useDeliveryLocation } from '@/ui/location';

import { useDialog, useScrollLock } from './dialog';
import { closeCart, openLocationSheet, useCartOpen } from './drawer-state';
import { WeightStepper } from './steppers';

/**
 * The basket, as a slide-over.
 *
 * ⚠ EVERY AMOUNT IN HERE COMES FROM THE SERVER. The drawer holds intent and
 * asks `/api/quote` what it costs. It never multiplies a rate by a weight,
 * because a second implementation of the price is a second answer, and the one
 * the customer sees would be the one that is wrong.
 *
 * The consequence is that the drawer has a LOADING state for its own totals,
 * which most cart drawers do not. That is the honest trade, and it is why the
 * line list renders immediately from local state while only the money waits.
 *
 * ── WHAT THE REDESIGN ADDED, AND WHY EACH ONE EARNS ITS ROW ───────────────
 *
 * 1. THE DESTINATION IS SENT WITH THE QUOTE. The drawer used to send
 *    `postalCode: null` and therefore could only ever show a subtotal, with
 *    the delivery fee appearing for the first time at checkout. Now the
 *    address the customer set in the header is part of the request, so the
 *    fee and the real total are visible while they are still shopping.
 *
 * 2. THE FREE-DELIVERY GAP. `amountToFreeDelivery` has existed in the domain
 *    since the beginning and nothing rendered it. Every competitor in the
 *    analysis shows this, and it is the one nudge that is also useful: it
 *    answers "should I add one more thing" with a number.
 *
 * 3. WEIGHTS ARE EDITABLE HERE. Changing your mind about how much fish you
 *    want is the single most likely edit in this basket, and it used to mean
 *    removing the line and starting the product page again.
 */

interface QuoteLine {
  productId: string;
  prepOptionId: string | null;
  name: string;
  imagePath: string | null;
  amountCents: number;
  isEstimate: boolean;
  problem: 'productUnavailable' | 'invalidQuantity' | 'insufficientStock' | null;
}

interface QuoteResponse {
  lines: QuoteLine[];
  lineSubtotalCents: number;
  deliveryFeeCents: number | null;
  estTotalCents: number | null;
  toFreeDeliveryCents: number | null;
  hasEstimate: boolean;
  hasHotLine: boolean;
  serviceable: boolean | null;
  /** `null` when the owner has not opened a trading day. Nothing is orderable. */
  businessDayId: string | null;
}

/**
 * The gate. Renders nothing at all until the basket is opened, so the panel
 * below genuinely mounts and unmounts.
 */
export function CartDrawer({ locale }: { locale: Locale }) {
  return useCartOpen() ? <Panel locale={locale} /> : null;
}

/**
 * ⚠ THE PANEL IS A SEPARATE COMPONENT SO THAT IT MOUNTS AND UNMOUNTS, and
 * that is not tidying.
 *
 * `useDialog` captures the invoking control on mount and puts focus back on
 * unmount. The previous version gated the same work behind an early return
 * INSIDE an effect on a component that stayed mounted forever, so there was no
 * unmount for the restore to hang off and the drawer dropped focus onto
 * `<body>` every time a customer closed it. On a keyboard that means the next
 * Tab starts again at the skip link.
 *
 * It also means the quote request lives here rather than being guarded by
 * `if (!open)`, which is one fewer condition to get wrong.
 */
function Panel({ locale }: { locale: Locale }) {
  const cart = useCart();
  const { location, ready } = useDeliveryLocation();
  const [fetchedQuote, setQuote] = useState<QuoteResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useDialog(panel, closeCart, closeButton);
  useScrollLock();

  /*
   * 🔴 THE REQUEST BODY IS DERIVED AS A STRING, AND THE EFFECT DEPENDS ON THAT
   * STRING. Getting this wrong makes the basket show skeletons for ever.
   *
   * It used to be built inside the effect, whose dependency array carried
   * `cart.lines` and `location`. Both are OBJECTS: any re-render that replaces
   * either identity re-runs the effect, and the cleanup calls
   * `controller.abort()`. Measured over CDP: one request sent, one 200
   * received, one `net::ERR_ABORTED`. The abort landed between the response
   * headers and `.json()` resolving, so `setQuote` never ran, the `.catch`
   * swallowed the `AbortError` by design, and every amount in the drawer
   * stayed a pulsing grey bar with no error anywhere.
   *
   * ⚠ IT ONLY SURFACED WHEN THE PANEL STARTED MOUNTING ON OPEN. While the
   * drawer was permanently mounted behind `if (!open) return`, the stores had
   * settled long before anybody could press the basket, so the effect's first
   * run was also its last. The dependencies were always wrong; the old mount
   * timing hid it.
   *
   * A string cannot have an unstable identity. It also states the rule
   * exactly: RE-ASK THE SERVER WHEN, AND ONLY WHEN, THE QUESTION CHANGES. Edit
   * the buzzer code or the delivery notes and nothing re-quotes, because
   * neither is in here.
   */
  const quoteBody = JSON.stringify({
    lines: cart.lines.map((l) => ({
      productId: l.productId,
      requestedG: l.requestedG,
      prepOptionId: l.prepOptionId,
    })),
    lat: location.lat,
    lng: location.lng,
    postalCode: location.postalCode.trim() === '' ? null : location.postalCode,
    locale,
  });

  useEffect(() => {
    // See `checkout-form.tsx`: the empty case is DERIVED below rather than
    // written back into state from inside the effect.
    if (cart.lines.length === 0) return;
    const controller = new AbortController();

    void fetch('/api/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: quoteBody,
    })
      .then((r) => (r.ok ? (r.json() as Promise<QuoteResponse>) : Promise.reject(new Error('quote'))))
      .then((q) => {
        setQuote(q);
        setFailed(false);
      })
      .catch((error: unknown) => {
        // An aborted request is the effect cleaning up after itself, not a
        // failure, and showing an error for it would flash on every keystroke.
        if (error instanceof Error && error.name === 'AbortError') return;
        setFailed(true);
      });

    return () => controller.abort();
  }, [quoteBody, cart.lines.length]);

  const empty = cart.lines.length === 0;
  // Derived, so removing the last line cannot leave a stale subtotal on screen.
  const quote = empty ? null : fetchedQuote;

  // The shop is shut, rather than short of one fish. Every line comes back
  // unpriceable in that state, so the reason is said ONCE in the footer
  // instead of four times as "not enough of this left today", which would be
  // both wrong and alarming.
  const closed = quote !== null && quote.businessDayId === null;
  const blocked = closed || (quote?.lines.some((l) => l.problem !== null) ?? false);
  const addressLabel = ready ? locationLabel(location) : null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={t(locale, 'nav.close')}
        onClick={closeCart}
        className="absolute inset-0 bg-[rgb(3_25_35/0.55)] motion-safe:animate-[fade-in_var(--duration-standard)_ease-out]"
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
        className="absolute inset-y-0 right-0 flex h-[100dvh] w-full flex-col bg-surface elev-drawer motion-safe:animate-[slide-in_var(--duration-standard)_var(--ease-brand)] lg:w-[420px]"
      >
        {/*
          ⭐ THE ONE POLITE ANNOUNCEMENT IN THE BASKET, and there is exactly one
          on purpose. §12 asks for result counts, quote refreshes and basket
          changes to be announced politely; three separate live regions in one
          panel would talk over each other every time a stepper moves, because
          removing a line changes the count AND re-quotes.

          So it is a single sentence carrying both facts, `aria-live="polite"`
          so it waits for a pause, and visually hidden because the same two
          numbers are already on screen for everyone who can see them.
        */}
        <p aria-live="polite" className="sr-only">
          {t(locale, cart.lines.length === 1 ? 'basket.itemCountOne' : 'basket.itemCount', {
            count: cart.lines.length,
          })}
          {quote?.estTotalCents != null &&
            `. ${t(locale, 'basket.total')} ${money(quote.estTotalCents, locale)}`}
        </p>

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
            {/*
              The destination, restated where the money is. A fee is only
              meaningful next to the address it was computed for, and this is
              also the fastest route to fixing a wrong one.
            */}
            <button
              type="button"
              onClick={openLocationSheet}
              className="flex items-center gap-2 border-b border-line bg-soft px-4 py-2.5 text-left text-meta hover:bg-soft/70 sm:px-6"
            >
              <MapPinIcon size={14} weight="fill" aria-hidden className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate">
                {addressLabel ?? t(locale, 'location.stripUnknown')}
              </span>
              <span className="shrink-0 font-semibold underline underline-offset-4">
                {addressLabel === null
                  ? t(locale, 'location.setAddress')
                  : t(locale, 'location.change')}
              </span>
            </button>

            <ul className="flex-1 divide-y divide-line overflow-y-auto px-4 sm:px-6">
              {cart.lines.map((line) => (
                <DrawerLine
                  key={lineKey(line)}
                  line={line}
                  locale={locale}
                  quoted={
                    quote?.lines.find(
                      (q) =>
                        q.productId === line.productId && q.prepOptionId === line.prepOptionId,
                    ) ?? null
                  }
                  shopClosed={closed}
                />
              ))}
            </ul>

            <footer
              className="border-t border-line px-4 py-4 sm:px-6"
              // Without this the checkout button sits under the iPhone home
              // indicator and is genuinely unpressable.
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            >
              {quote?.hasHotLine === true && (
                <p className="mb-3 flex items-start gap-2 rounded-sm border border-line bg-soft px-3 py-2 text-meta">
                  <FlameIcon size={14} weight="fill" aria-hidden className="mt-0.5 shrink-0 text-hot" />
                  <span>{t(locale, 'basket.hotNotice')}</span>
                </p>
              )}

              {failed ? (
                <p className="mb-3 rounded-sm bg-danger-wash px-3 py-2 text-meta text-danger">
                  {t(locale, 'errors.generic')}
                </p>
              ) : closed ? (
                <p className="mb-3 rounded-sm bg-danger-wash px-3 py-2 text-meta text-danger">
                  {t(locale, 'errors.shopClosed')}
                </p>
              ) : (
                <Totals quote={quote} locale={locale} hasAddress={hasDestination(location)} />
              )}

              <p className="mb-4 text-meta text-muted">{t(locale, 'basket.estimateNote')}</p>

              {/*
                A basket the server will refuse does not get a button to the
                checkout. The refusal would be identical either way — P1…P8 do
                not care what the drawer rendered — but finding out after
                typing an address is the version that wastes the customer's
                evening.
              */}
              {blocked ? (
                <span
                  aria-disabled="true"
                  className="tap-lg flex items-center justify-center rounded-sm bg-accent text-lead font-semibold text-accent-ink opacity-60"
                >
                  {t(locale, 'basket.checkout')}
                </span>
              ) : (
                <Link
                  href={`/${locale}/checkout`}
                  data-parity="basket-checkout"
                  onClick={closeCart}
                  className="tap-lg flex items-center justify-center gap-3 rounded-sm bg-accent px-5 text-lead font-semibold text-accent-ink transition-colors duration-(--duration-fast) hover:bg-accent-hover active:scale-[0.99]"
                >
                  <span>{t(locale, 'basket.checkout')}</span>
                  {quote?.estTotalCents != null && (
                    <span className="tnum ml-auto">{money(quote.estTotalCents, locale)}</span>
                  )}
                </Link>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Subtotal, fee, total, and the gap to free delivery.
 *
 * ⚠ THE FEE HAS THREE RENDERINGS, not two. A number, the word "free", and "we
 * do not know yet because you have not told us where you are". The third is
 * the one that is usually got wrong by rendering `$0.00`, which is a promise
 * the shop has not made.
 */
function Totals({
  quote,
  locale,
  hasAddress,
}: {
  quote: QuoteResponse | null;
  locale: Locale;
  hasAddress: boolean;
}) {
  const skeleton = (
    <span className="inline-block h-4 w-16 animate-pulse rounded-sm bg-soft align-middle motion-reduce:animate-none" />
  );

  return (
    <div className="mb-3 grid gap-1.5">
      <dl className="grid gap-1 text-meta">
        <div className="flex justify-between">
          <dt>{t(locale, 'basket.subtotal')}</dt>
          <dd className="tnum">
            {quote === null ? skeleton : money(quote.lineSubtotalCents, locale)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>{t(locale, 'basket.delivery')}</dt>
          <dd className="tnum">
            {quote === null ? (
              skeleton
            ) : !hasAddress ? (
              <button
                type="button"
                onClick={openLocationSheet}
                className="font-semibold text-muted underline underline-offset-4 hover:text-ink"
              >
                {t(locale, 'basket.deliveryUnknown')}
              </button>
            ) : quote.deliveryFeeCents === null ? (
              <span className="text-danger">{t(locale, 'basket.deliveryUnserved')}</span>
            ) : quote.deliveryFeeCents === 0 ? (
              t(locale, 'basket.deliveryFree')
            ) : (
              money(quote.deliveryFeeCents, locale)
            )}
          </dd>
        </div>
      </dl>

      <div className="flex items-baseline justify-between border-t border-line pt-2">
        <span className="text-body font-semibold">{t(locale, 'basket.total')}</span>
        <span className="tnum text-section font-semibold">
          {quote === null ? (
            skeleton
          ) : quote.estTotalCents === null ? (
            money(quote.lineSubtotalCents, locale)
          ) : (
            money(quote.estTotalCents, locale)
          )}
        </span>
      </div>

      {quote?.toFreeDeliveryCents != null && quote.toFreeDeliveryCents > 0 && (
        <FreeDeliveryGap
          gapCents={quote.toFreeDeliveryCents}
          subtotalCents={quote.lineSubtotalCents}
          locale={locale}
        />
      )}
    </div>
  );
}

/**
 * "Add $6.50 more for free delivery."
 *
 * ⚠ THE SENTENCE CARRIES THE MEANING AND THE BAR IS DECORATION FOR IT, which
 * is the right way round. A bare progress bar is a dashboard element that asks
 * the reader to infer a number; the number is right there, and the bar just
 * says how close. Under `prefers-reduced-motion` the fill stops animating and
 * nothing is lost, because nothing was in the animation.
 */
function FreeDeliveryGap({
  gapCents,
  subtotalCents,
  locale,
}: {
  gapCents: number;
  subtotalCents: number;
  locale: Locale;
}) {
  const threshold = subtotalCents + gapCents;
  const pct = threshold === 0 ? 0 : Math.min(100, Math.round((subtotalCents / threshold) * 100));

  return (
    <div className="grid gap-1.5 rounded-sm bg-soft px-3 py-2">
      <p className="text-meta">
        {t(locale, 'basket.toFreeDelivery', { amount: money(gapCents, locale) })}
      </p>
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t(locale, 'basket.toFreeDelivery', { amount: money(gapCents, locale) })}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-(--duration-standard) ease-brand"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function DrawerLine({
  line,
  locale,
  quoted,
  shopClosed,
}: {
  line: CartLine;
  locale: Locale;
  quoted: QuoteLine | null;
  shopClosed: boolean;
}) {
  const key = lineKey(line);
  // Said once in the footer when the whole shop is shut; per line only when
  // this line is the thing that is wrong.
  const problem = shopClosed ? null : (quoted?.problem ?? null);

  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-3 py-4">
      <div className="relative row-span-2 size-[4.5rem] overflow-hidden rounded-sm bg-soft">
        {quoted === null ? (
          <div className="absolute inset-0 animate-pulse bg-soft motion-reduce:animate-none" />
        ) : quoted.imagePath === null ? (
          <div
            aria-hidden
            className="absolute inset-0 grid place-items-center bg-soft text-section font-semibold text-muted"
          >
            {line.name.trim().charAt(0).toUpperCase()}
          </div>
        ) : (
          <Image
            src={thumb(quoted.imagePath)}
            alt=""
            fill
            sizes="72px"
            className={`object-cover ${isPainted(quoted.imagePath) ? 'painted' : ''}`}
          />
        )}
      </div>

      <div className="min-w-0">
        <div className="flex gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-semibold">{line.name}</p>
            {line.prepLabel !== null && <p className="text-meta text-muted">{line.prepLabel}</p>}
            {problem !== null && (
              <p className="mt-1 text-meta text-danger">
                {quoteProblemMessage(locale, problem, quoted?.name ?? line.name)}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span
              className={
                problem === null
                  ? 'tnum text-body font-semibold'
                  : 'tnum text-body font-semibold text-muted line-through'
              }
            >
              {quoted === null ? (
                <span className="inline-block h-4 w-14 animate-pulse rounded-sm bg-soft motion-reduce:animate-none" />
              ) : (
                money(quoted.amountCents, locale)
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
        </div>
      </div>

      {/*
        ⚠ THE STEPPER HAS NO MINIMUM OR STEP TO ENFORCE HERE, because the
        basket stores intent and does not carry the catalog's rules with it.
        Changing the weight to something illegal is therefore possible, and it
        comes back from the next quote as `invalidQuantity` on this line with
        the checkout button disabled. That is the correct place for the answer:
        the catalog is the server's, and a copy of `minOrder` in
        `localStorage` would go stale the first time the shop changed it.
      */}
      <div className="min-w-0 overflow-x-auto">
        <WeightStepper
          grams={line.requestedG}
          minG={100}
          stepG={100}
          maxG={null}
          onChange={(g) => setLineWeight(key, g)}
          locale={locale}
        />
      </div>
    </li>
  );
}
