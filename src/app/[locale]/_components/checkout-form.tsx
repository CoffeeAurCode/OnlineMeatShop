'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FlameIcon, MapPinIcon, PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr';

import { quoteProblemMessage, t, type Locale } from '@/i18n';
import { clearCart, lineKey, useCart } from '@/ui/cart';
import { useCustomerSession } from '@/ui/customer-session';
import { money, weight } from '@/ui/format';
import { isDeliverable, useDeliveryLocation } from '@/ui/location';

import { useDialog } from './dialog';
import { openCart, openLocationSheet, openSignIn } from './drawer-state';
import { MoneySentence, TestOrderBanner } from './money-sentence';

/**
 * Checkout. The one gate.
 *
 * ⚠ THE DESIGN SKILL DOES NOT APPLY TO THIS SCREEN, by its own scope rule:
 * multi-step forms and wizards are out of it. This follows `04-PLAN` §11
 * instead, at VARIANCE 3 / MOTION 2 / DENSITY 6. Predictability is the feature
 * here. No asymmetry, no reveal animations, no surprises between the total and
 * the button.
 *
 * ⚠ THE BROWSER DECIDES NOTHING. Every amount on this screen came from
 * `/api/quote`, and the amount actually charged is recomputed inside the
 * placement transaction. The fields below are intent.
 *
 * ── WHAT THE REDESIGN CHANGED ─────────────────────────────────────────────
 *
 * ⭐ THE ADDRESS IS NO LONGER TYPED HERE. It was captured in the header, in
 * the hero, or in the basket, and this screen SHOWS it with an edit control.
 * That is worth stating as a principle rather than a layout: an address typed
 * at the last step is an address the shop could not have validated earlier, so
 * the customer learns they are outside the radius after filling in a form.
 * Capturing it first turns eight fields into a review card.
 *
 * What remains here is genuinely per-order: who to phone, which window, and
 * the confirmation itself.
 */

export interface SlotOption {
  id: string;
  label: string;
  hotEligible: boolean;
  full: boolean;
  cutoffPassed: boolean;
}

interface Quote {
  lines: {
    productId: string;
    prepOptionId: string | null;
    name: string;
    amountCents: number;
    /**
     * ⚠ A LINE WITH A PROBLEM IS PRICED BUT NOT SUMMED. `quoteBasket` leaves
     * it out of `lineSubtotalCents`, so rendering the amount without the
     * problem shows a list of prices above a subtotal that does not add up.
     */
    problem: 'productUnavailable' | 'invalidQuantity' | 'insufficientStock' | null;
  }[];
  lineSubtotalCents: number;
  deliveryFeeCents: number | null;
  estTotalCents: number | null;
  catalogVersion: number;
  hasHotLine: boolean;
  serviceable: boolean | null;
}

export function CheckoutForm({
  slots,
  locale,
  codEnabled,
}: {
  slots: SlotOption[];
  locale: Locale;
  /**
   * ⚠ A DISPLAY DECISION ONLY. `/api/checkout` re-reads the setting and
   * refuses a cash order with `codUnavailable` regardless of what this
   * component was told at render time. Two checks that look redundant and are
   * not: this one is so the customer is never offered something they cannot
   * have, and the server's is so a stale tab cannot place one anyway.
   */
  codEnabled: boolean;
}) {
  /*
   * ⭐ THE SIGN-IN STATE, READ BUT NEVER TRUSTED.
   *
   * This decides what the BUTTON SAYS. It does not decide whether the order is
   * allowed — `/api/checkout` re-reads the signed cookie and refuses with
   * `signInRequired` regardless of what this component believes. Two checks
   * that look redundant, and are not: this one is so the customer is never
   * surprised, and the server's is so the rule is actually enforced.
   */
  const session = useCustomerSession();
  const router = useRouter();
  const cart = useCart();
  const { location, ready } = useDeliveryLocation();

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [slotId, setSlotId] = useState('');
  /*
   * ⭐ CARD IS THE DEFAULT, AND THAT IS A DELIBERATE CHOICE RATHER THAN AN
   * ALPHABETICAL ONE. A prepaid order is settled before the driver leaves; a
   * cash order carries the shop's exposure all the way to a doorstep. The
   * quieter, safer option should be the one nobody has to pick.
   */
  const [payMode, setPayMode] = useState<'PREPAID' | 'COD'>('PREPAID');

  const [fetchedQuote, setQuote] = useState<Quote | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /*
   * ⭐ P8, ON SCREEN. `priceChanged` is the one refusal that must not read as
   * an error, because nothing went wrong: the shop repriced something while
   * this page was open, the server caught it before touching a card, and the
   * customer now has to see both numbers and decide.
   *
   * ⚠ IT WAS A SENTENCE IN A RED BOX, which is the failure the design system
   * names in so many words: "Never silently accept a changed total. Show old
   * and new totals side by side in a blocking dialog with two explicit
   * actions." A one-line error asks the customer to press the same button
   * again and hope, and the number they would be agreeing to was never shown
   * to them.
   */
  const [priceChange, setPriceChange] = useState<{ oldCents: number; newCents: number } | null>(
    null,
  );
  /*
   * Bumped to force a re-quote when nothing the effect watches has changed.
   * A repricing happens on the SHOP's side, so the basket and the destination
   * are both identical and the effect would otherwise never re-run.
   */
  const [quoteNonce, setQuoteNonce] = useState(0);

  /*
   * ⚠ THE REQUEST BODY IS A DERIVED STRING AND THE EFFECT DEPENDS ON IT.
   *
   * It used to be built inside the effect, with `cart.lines` and `location` in
   * the dependency array. Both are objects; a replaced identity re-runs the
   * effect, and the cleanup aborts a request that had already succeeded. The
   * basket drawer is where that was caught — see the long note in
   * `cart-drawer.tsx` for the CDP trace — and this screen carried the same
   * hazard with the same silent symptom: totals that never arrive.
   *
   * A string cannot have an unstable identity, and it states the rule exactly:
   * re-ask the server when, and only when, the question changes.
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

  // Re-quoted whenever the basket or the destination changes, because the
  // delivery fee depends on the second and every amount depends on the first.
  useEffect(() => {
    // No `setQuote(null)` here for the empty basket. Calling setState in an
    // effect body causes a cascading render, and React 19's lint rejects it
    // for good reason; the empty case is DERIVED below instead.
    if (cart.lines.length === 0) return;
    const controller = new AbortController();
    void fetch('/api/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: quoteBody,
    })
      .then((r) => (r.ok ? (r.json() as Promise<Quote>) : Promise.reject(new Error('quote'))))
      .then(setQuote)
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [quoteBody, cart.lines.length, quoteNonce]);

  /*
   * Derived, not stored. An emptied basket must not keep showing the totals of
   * what used to be in it, and deriving that is both simpler and correct
   * during the render where the basket changed.
   */
  const quote = cart.lines.length === 0 ? null : fetchedQuote;

  // A basket the server will refuse does not get an enabled button. P1…P8
  // reject it either way; the only question is whether the customer finds out
  // before or after typing a phone number.
  const hasProblem = quote?.lines.some((l) => l.problem !== null) ?? false;

  /*
   * ⭐ THE HOT-FOOD SLOT RULE, SHOWN. Hiding the windows that cannot carry hot
   * food is a COURTESY, not the guarantee: precondition P7 refuses the order
   * server-side regardless, because this is a food-safety rule and a filtered
   * list is not an enforcement mechanism. Both exist on purpose.
   */
  const hot = quote?.hasHotLine === true;
  const usable = slots.filter((s) => !s.cutoffPassed && (!hot || s.hotEligible));

  /*
   * ⭐ THE PROVEN NUMBER WINS, AND IT IS DERIVED RATHER THAN COPIED INTO
   * STATE.
   *
   * The server refuses the order unless the body's phone normalises to the
   * cookie's (`phoneMismatch`), so a customer who signed in with one number
   * and then edited the field would be blocked with no idea why.
   *
   * ⚠ An effect that copied `session.phone` into `phone` would work and is
   * the obvious shape — it is also a setState inside an effect, which React's
   * own lint rule refuses, and correctly: it renders once with the stale value
   * and again with the fresh one. A derived constant has no intermediate
   * state to be wrong in. The `phone` field below is only ever shown, and only
   * ever typed into, while signed OUT.
   */
  const provenPhone = session.phone ?? phone;

  function validate(): boolean {
    const errors: Record<string, string> = {};
    /*
     * ⚠ THE PHONE RULE IS DELIBERATELY LOOSE NOW. It used to demand exactly
     * ten digits, which is right for Canada and refuses every number a test
     * order from anywhere else would use. Seven to fifteen digits is the E.164
     * range; `normalisePhone` on the server is what decides the canonical
     * form, and it is the only opinion that has to be right.
     */
    // Skipped entirely when signed in: the number came from a code texted to
    // it, so re-validating its shape here could only ever disagree with the
    // server about a number the server already proved.
    const digits = provenPhone.replace(/\D/g, '');
    if (session.phone == null && (digits.length < 7 || digits.length > 15)) {
      errors.phone = t(locale, 'checkout.phoneInvalid');
    }
    if (!isDeliverable(location)) errors.address = t(locale, 'checkout.addressIncomplete');
    if (slotId === '') errors.slotId = t(locale, 'checkout.required');
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || quote === null) return;

    /*
     * ⭐ THE SIGN-IN GATE, AT THE MOMENT OF THE TAP.
     *
     * Deliberately here rather than as a redirect on page load. A customer who
     * has filled in a window and is ready to pay should not lose that to a
     * navigation; opening the sheet over the page keeps every field they
     * entered, and the sheet closing puts them back on a live button.
     */
    if (session.phone == null) {
      openSignIn();
      return;
    }

    if (!validate()) return;

    setSubmitting(true);
    setFailure(null);

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lines: cart.lines.map((l) => ({
            productId: l.productId,
            requestedG: l.requestedG,
            prepOptionId: l.prepOptionId,
          })),
          lat: location.lat,
          lng: location.lng,
          postalCode: location.postalCode.trim() === '' ? null : location.postalCode,
          addressLine1: location.line1,
          addressLine2: location.line2.trim() === '' ? null : location.line2,
          city: location.city,
          province: location.region.trim() === '' ? '-' : location.region,
          deliveryNotes: location.notes.trim() === '' ? null : location.notes,
          dropOff: t(locale, `location.dropOff.${location.dropOff}`),
          slotId,
          phone: provenPhone,
          name: name.trim() === '' ? null : name,
          email: email.trim() === '' ? null : email,
          catalogVersion: quote.catalogVersion,
          // Never `payMode` from a hidden field the customer never saw: if the
          // shop turned cash off while this page was open, send the card path
          // rather than a mode the server is about to refuse.
          payMode: codEnabled ? payMode : 'PREPAID',
        }),
      });

      const body = (await res.json()) as {
        ok?: boolean;
        publicToken?: string;
        reason?: string;
        // Sent by `/api/checkout` alongside `priceChanged`, and by nothing else.
        estTotalCents?: number;
        detail?: { productName?: string };
      };

      if (res.ok && body.ok === true && body.publicToken !== undefined) {
        // Cleared only AFTER the server confirms. Clearing optimistically loses
        // the basket on any failure, which is the worst possible moment.
        clearCart();
        router.push(`/${locale}/orders/${body.publicToken}?placed=1`);
        return;
      }

      // Each failure code has its own sentence. A generic "something went
      // wrong" on a checkout is what makes a customer try again and place two
      // orders.
      const reason = body.reason ?? 'generic';

      /*
       * ⚠ THE OLD TOTAL IS READ OFF THE QUOTE THIS SCREEN WAS SHOWING, not
       * echoed back by the server, because the server never saw it. That is
       * also what makes the comparison honest: it is the number this customer
       * actually looked at, beside the number the catalog now says.
       */
      if (res.status === 409 && reason === 'priceChanged' && body.estTotalCents != null) {
        setPriceChange({ oldCents: quote.estTotalCents ?? 0, newCents: body.estTotalCents });
        setSubmitting(false);
        return;
      }
      /*
       * A thirty-day cookie can expire between loading this page and pressing
       * the button. Reopening the sheet turns that into two taps instead of a
       * dead end with a sentence nobody can act on.
       */
      if (res.status === 401 && reason === 'signInRequired') {
        await session.refresh();
        openSignIn();
        setSubmitting(false);
        return;
      }
      setFailure(
        body.detail?.productName !== undefined
          ? t(locale, 'errors.insufficientStock', { name: body.detail.productName })
          : t(locale, `errors.${reason}`),
      );
    } catch {
      setFailure(t(locale, 'errors.generic'));
    }
    setSubmitting(false);
  }

  if (cart.ready && cart.lines.length === 0) {
    return (
      <div className="mt-10 rounded-md border border-line bg-raised px-6 py-14 text-center">
        <p className="text-lead font-semibold">{t(locale, 'basket.empty')}</p>
        <p className="mx-auto mt-2 max-w-[36ch] text-body text-muted">
          {t(locale, 'basket.emptyBody')}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="mt-8 grid gap-10">
      <TestOrderBanner locale={locale} />

      <Section heading={t(locale, 'checkout.addressHeading')}>
        <AddressCard locale={locale} ready={ready} error={fieldErrors.address} />
        {quote?.serviceable === false && (
          <p role="alert" className="text-meta font-semibold text-danger">
            {t(locale, 'errors.outsideDeliveryAreaGps')}
          </p>
        )}
      </Section>

      <Section heading={t(locale, 'checkout.contactHeading')}>
        {/*
          ⭐ SIGNED IN: THE NUMBER IS SHOWN, NOT ASKED FOR.

          It is the number a code was texted to, so there is nothing to type
          and nothing to get wrong. "Use a different number" signs out and
          reopens the sheet, which is the only honest way to change it —
          editing the field would produce a `phoneMismatch` the customer could
          not diagnose.

          Signed out, the field stays editable so the page reads normally, but
          the button opens the sheet rather than placing anything.
        */}
        {session.phone == null ? (
          <Field
            id="phone"
            label={t(locale, 'checkout.phoneLabel')}
            help={t(locale, 'checkout.phoneHelp')}
            error={fieldErrors.phone}
            value={phone}
            onChange={setPhone}
            type="tel"
            autoComplete="tel"
            required
          />
        ) : (
          <div className="flex items-baseline justify-between gap-4 rounded-sm border border-line bg-soft px-4 py-3">
            <span className="min-w-0">
              <span className="block text-meta text-muted">
                {t(locale, 'checkout.phoneLabel')}
              </span>
              <span className="tnum block truncate text-body font-semibold">{session.phone}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                void session.signOut().then(openSignIn);
              }}
              className="tap shrink-0 text-meta text-muted underline underline-offset-4"
            >
              {t(locale, 'auth.changeNumber')}
            </button>
          </div>
        )}
        <Field
          id="name"
          label={t(locale, 'checkout.nameLabel')}
          value={name}
          onChange={setName}
          autoComplete="name"
        />
        <Field
          id="email"
          label={t(locale, 'checkout.emailLabel')}
          help={t(locale, 'checkout.emailOptional')}
          value={email}
          onChange={setEmail}
          type="email"
          autoComplete="email"
        />
      </Section>

      <Section heading={t(locale, 'checkout.slotHeading')}>
        {hot && (
          <p className="flex items-start gap-2 rounded-sm border border-line bg-soft px-3 py-2 text-body">
            <FlameIcon size={16} weight="fill" aria-hidden className="mt-1 shrink-0 text-hot" />
            <span>{t(locale, 'checkout.hotWarning')}</span>
          </p>
        )}
        {fieldErrors.slotId !== undefined && (
          <p className="text-meta font-semibold text-danger">{fieldErrors.slotId}</p>
        )}
        <div className="grid gap-2">
          {usable.length === 0 && (
            <p className="text-body text-muted">{t(locale, 'errors.slotClosed')}</p>
          )}
          {usable.map((s) => (
            <label
              key={s.id}
              className={`tap-lg flex cursor-pointer items-center gap-3 rounded-sm border px-4 transition-colors ${
                slotId === s.id ? 'border-accent bg-soft' : 'border-line bg-raised'
              } ${s.full ? 'pointer-events-none opacity-50' : ''}`}
            >
              <input
                type="radio"
                name="slot"
                value={s.id}
                disabled={s.full}
                checked={slotId === s.id}
                onChange={() => setSlotId(s.id)}
                className="size-5 accent-[var(--accent)]"
              />
              <span className="tnum text-body font-semibold">{s.label}</span>
              {s.full && (
                <span className="text-meta text-muted">{t(locale, 'checkout.slotFull')}</span>
              )}
              {s.hotEligible && (
                <span className="ml-auto inline-flex items-center gap-1 text-meta text-muted">
                  <FlameIcon size={12} weight="fill" aria-hidden />
                  {t(locale, 'checkout.slotHotOnly')}
                </span>
              )}
            </label>
          ))}
        </div>
      </Section>

      {/*
        ⭐ THE PAYMENT CHOICE, AFTER THE WINDOW AND DIRECTLY ABOVE THE SUMMARY.

        ⚠ IT USED TO SIT ABOVE THE WINDOW, on the reasoning that burying it
        under the slot list put it below the fold. §8 orders the review screen
        address, contact, window, payment, summary, money sentence, action —
        and following it turns out to read better than the old order rather
        than worse, because it makes the whole money story contiguous: how you
        pay, what it comes to, what that number means, place the order. The
        window is a scheduling decision and belongs with the address.

        The whole section disappears when the shop is not taking cash. A single
        disabled radio explaining why is a worse screen than one option
        presented plainly.
      */}
      {codEnabled && (
        <Section heading={t(locale, 'checkout.payHeading')}>
          <div className="grid gap-2">
            {(['PREPAID', 'COD'] as const).map((mode) => (
              <label
                key={mode}
                className={`flex cursor-pointer items-start gap-3 rounded-sm border px-4 py-3 ${
                  payMode === mode ? 'border-accent bg-soft' : 'border-line'
                }`}
              >
                <input
                  type="radio"
                  name="payMode"
                  value={mode}
                  checked={payMode === mode}
                  onChange={() => setPayMode(mode)}
                  className="mt-1 size-5 shrink-0"
                />
                <span className="min-w-0">
                  <span className="block text-body font-semibold">
                    {t(locale, mode === 'PREPAID' ? 'checkout.payNow' : 'checkout.payCash')}
                  </span>
                  <span className="mt-1 block text-meta text-muted">
                    {t(locale, mode === 'PREPAID' ? 'checkout.payNowHelp' : 'checkout.payCashHelp')}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </Section>
      )}

      {/*
        ⭐ "YOUR ITEMS", WITH THE WAY BACK TO THEM. Figma parity, Phase 5:
        `335:2653` puts a `see menu` link on the right of this heading, and the
        equivalent here is the basket — the one surface where a line can still
        be re-weighed or removed. Without it, the only route back to a mistake
        spotted on the review screen is the browser's back button.
      */}
      <Section
        heading={t(locale, 'basket.title')}
        action={
          <button
            type="button"
            onClick={openCart}
            className="tap text-meta font-semibold text-muted underline underline-offset-4 hover:text-ink"
          >
            {t(locale, 'checkout.editBasket')}
          </button>
        }
      >
        <ul className="grid gap-2">
          {cart.lines.map((l) => {
            const q = quote?.lines.find(
              (x) => x.productId === l.productId && x.prepOptionId === l.prepOptionId,
            );
            return (
              <li key={lineKey(l)} className="flex justify-between gap-4 text-body">
                <span className="min-w-0">
                  <span className="font-semibold">{q?.name ?? l.name}</span>{' '}
                  <span className="tnum text-muted">{weight(l.requestedG, locale)}</span>
                  {l.prepLabel !== null && (
                    <span className="block text-meta text-muted">{l.prepLabel}</span>
                  )}
                  {q?.problem != null && (
                    <span className="block text-meta text-danger">
                      {quoteProblemMessage(locale, q.problem, q.name)}
                    </span>
                  )}
                </span>
                <span
                  className={
                    q?.problem == null ? 'tnum shrink-0' : 'tnum shrink-0 text-muted line-through'
                  }
                >
                  {q === undefined ? '' : money(q.amountCents, locale)}
                </span>
              </li>
            );
          })}
        </ul>

        <dl className="grid gap-1 border-t border-line pt-4 text-body">
          <div className="flex justify-between">
            <dt>{t(locale, 'basket.subtotal')}</dt>
            <dd className="tnum">{quote === null ? '' : money(quote.lineSubtotalCents, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{t(locale, 'basket.delivery')}</dt>
            <dd className="tnum">
              {quote?.deliveryFeeCents == null
                ? ''
                : quote.deliveryFeeCents === 0
                  ? t(locale, 'basket.deliveryFree')
                  : money(quote.deliveryFeeCents, locale)}
            </dd>
          </div>
          <div className="flex justify-between text-section font-semibold">
            <dt>{t(locale, 'basket.total')}</dt>
            <dd className="tnum">
              {quote?.estTotalCents == null ? '' : money(quote.estTotalCents, locale)}
            </dd>
          </div>
        </dl>
      </Section>

      {failure !== null && (
        <p
          role="alert"
          className="rounded-sm border border-danger bg-danger-wash px-4 py-3 text-body text-danger"
        >
          {failure}
        </p>
      )}

      {/*
        ⭐ THE ACTION BAR IS STICKY ON A PHONE. Figma parity, Phase 5:
        `335:2653` ends in a full-width action carrying the amount, pinned to
        the bottom of the screen. This screen is longer than the reference's —
        it has a real slot list and a payment choice — so on a 390×844 phone
        the button was two scrolls below the total.

        ⚠ THE MONEY SENTENCE MOVED WITH IT, AND THAT IS NOT OPTIONAL. Nothing
        goes between the money sentence and the button (`04-PLAN` §10.4), and
        pinning the button on its own would have put the whole page between
        them. They travel together or neither travels.

        ⚠ THE TAB BAR IS HIDDEN ON THIS ROUTE so the two do not stack — see
        `bottom-nav.tsx`. Static again from `lg`, where there is no thumb reach
        problem to solve and a floating bar is just chrome.
      */}
      <div
        className="
          sticky bottom-0 z-30 -mx-4 grid gap-4 border-t border-line bg-surface px-4 py-4
          pb-[max(1rem,env(safe-area-inset-bottom))]
          lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pb-0
        "
      >
        {quote?.estTotalCents != null && (
          <MoneySentence estimateCents={quote.estTotalCents} locale={locale} />
        )}
        <button
          type="submit"
          data-parity="place-order"
          disabled={submitting || hasProblem || quote?.estTotalCents == null}
          className="tap-lg inline-flex items-center justify-center rounded-sm bg-accent px-6 text-lead font-semibold text-accent-ink transition-colors duration-(--duration-fast) hover:bg-accent-hover disabled:opacity-60 active:scale-[0.99]"
        >
          {/*
            ⚠ THE LABEL CHANGES BEFORE THE ACTION DOES. A button that says
            "Place order" and opens a sign-in sheet is a button that lied; one
            that says "Sign in to order" sets the expectation the tap then
            meets. `session.loading` keeps the label stable during the first
            fetch rather than flickering from one to the other.
          */}
          {submitting
            ? t(locale, 'checkout.placing')
            : session.phone == null && !session.loading
              ? t(locale, 'auth.required')
              : t(locale, 'checkout.place')}
        </button>
      </div>

      {priceChange !== null && (
        <PriceChangeDialog
          locale={locale}
          oldCents={priceChange.oldCents}
          newCents={priceChange.newCents}
          onAccept={() => {
            // Re-quote from the catalog rather than patching the old quote with
            // the number the 409 carried. The refusal proved this screen's
            // catalog version was stale, and a stale version with one amount
            // corrected is still stale: the line breakdown, the fee and the
            // hot-food flag all come from the same read.
            setQuoteNonce((n) => n + 1);
            setPriceChange(null);
          }}
          onReview={() => {
            setPriceChange(null);
            setQuoteNonce((n) => n + 1);
            openCart();
          }}
        />
      )}
    </form>
  );
}

/**
 * ⭐ THE PRICE-CHANGE DIALOG. Both numbers, side by side, and two ways out.
 *
 * ⚠ IT IS THE ONLY BLOCKING DIALOG IN THE STOREFRONT, and it is blocking for a
 * reason that is not urgency: the customer is about to authorise an amount,
 * and the amount changed. Everything else on this screen can be scrolled past.
 * This cannot, because scrolling past it would mean agreeing to a figure
 * nobody showed them.
 *
 * ⚠ NEITHER BUTTON PLACES THE ORDER. That is P8: "make the customer
 * re-confirm". Accepting re-quotes and returns them to a live Place order
 * button carrying the new total, so the tap that authorises money is always a
 * tap on a number they have read. A single "Confirm and pay" here would be the
 * silent acceptance the rule exists to prevent.
 *
 * ⚠ IT IS NOT AN ERROR AND IS NOT STYLED AS ONE. `--danger` is reserved for
 * things that went wrong; nothing went wrong here. A red box would tell the
 * customer the shop broke, when what happened is that the shop caught a stale
 * price before charging it.
 */
function PriceChangeDialog({
  locale,
  oldCents,
  newCents,
  onAccept,
  onReview,
}: {
  locale: Locale;
  oldCents: number;
  newCents: number;
  onAccept: () => void;
  onReview: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const accept = useRef<HTMLButtonElement>(null);

  /*
   * ⚠ ESCAPE IS WIRED TO "BACK TO MY BASKET", NOT TO A BARE DISMISS. Closing
   * a dialog is normally cancelling, and cancelling here has to mean the
   * cautious branch. Dismissing it into the old, refused quote would leave a
   * Place order button showing a number the server has already rejected.
   */
  useDialog(panel, onReview, accept);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="price-change-title"
      aria-describedby="price-change-body"
    >
      {/*
        ⚠ NOT A BUTTON. Every other overlay in this storefront has a clickable
        scrim, because every other overlay is safe to abandon. This one is a
        decision, so the only ways out are the two labelled controls and
        Escape, all of which say what they do.
      */}
      <div aria-hidden className="absolute inset-0 bg-midnight/60" />

      <div
        ref={panel}
        className="
          relative grid w-full max-w-[26rem] gap-5 rounded-md border border-line bg-surface p-5
          elev-sheet animate-[fade-in_var(--duration-standard)_ease-out]
        "
      >
        <div className="grid gap-2">
          <h2
            id="price-change-title"
            className="!font-sans !text-section !pb-0 !tracking-normal font-semibold"
          >
            {t(locale, 'payment.priceChangedTitle')}
          </h2>
          <p id="price-change-body" className="text-body text-muted">
            {t(locale, 'payment.priceChangedBody')}
          </p>
        </div>

        {/*
          Side by side, in tabular figures, on one baseline. The comparison IS
          the content of this dialog, so the two amounts are the largest thing
          in it and neither is styled to look like the recommended answer.
        */}
        <dl className="grid grid-cols-2 gap-3">
          <div className="grid gap-1 rounded-sm border border-line bg-raised px-3 py-3">
            <dt className="text-meta text-muted">{t(locale, 'payment.priceChangedOld')}</dt>
            <dd className="tnum text-section font-semibold text-muted line-through">
              {money(oldCents, locale)}
            </dd>
          </div>
          <div className="grid gap-1 rounded-sm border border-accent bg-raised px-3 py-3">
            <dt className="text-meta text-muted">{t(locale, 'payment.priceChangedNew')}</dt>
            <dd className="tnum text-section font-semibold text-ink">{money(newCents, locale)}</dd>
          </div>
        </dl>

        <div className="grid gap-2">
          <button
            ref={accept}
            type="button"
            onClick={onAccept}
            className="tap-lg inline-flex items-center justify-center rounded-sm bg-accent px-5 text-body font-semibold text-accent-ink transition-colors duration-(--duration-fast) hover:bg-accent-hover active:scale-[0.99]"
          >
            {t(locale, 'payment.priceChangedAccept')}
          </button>
          <button
            type="button"
            onClick={onReview}
            className="tap-lg inline-flex items-center justify-center rounded-sm border border-line bg-raised px-5 text-body font-semibold text-ink transition-colors duration-(--duration-fast) hover:border-accent"
          >
            {t(locale, 'payment.priceChangedReview')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The address, as a review card rather than eight inputs.
 *
 * ⚠ IT SHOWS THE COORDINATE ALONGSIDE THE LINES, and that is not a debugging
 * leftover. It is the one number the customer can check against their own
 * knowledge of where they are, and getting it wrong is the failure mode that
 * costs the shop a delivery. A pin captured in a car park, on a phone that
 * decided it was 400 m away, looks exactly like a correct one until somebody
 * reads it back.
 */
function AddressCard({
  locale,
  ready,
  error,
}: {
  locale: Locale;
  ready: boolean;
  error?: string | undefined;
}) {
  const { location } = useDeliveryLocation();

  if (!ready) {
    return <div className="h-28 animate-pulse rounded-md bg-soft motion-reduce:animate-none" />;
  }

  const lines = [
    location.line1,
    location.line2,
    [location.city, location.region].filter((x) => x.trim() !== '').join(', '),
    location.postalCode,
  ].filter((x) => x.trim() !== '');

  return (
    <div
      className={`grid gap-3 rounded-md border bg-raised p-4 ${
        error === undefined ? 'border-line' : 'border-danger'
      }`}
    >
      <div className="flex items-start gap-3">
        <MapPinIcon size={18} weight="fill" aria-hidden className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          {lines.length === 0 ? (
            <p className="text-body text-muted">{t(locale, 'checkout.noAddressYet')}</p>
          ) : (
            <address className="grid not-italic">
              {lines.map((line) => (
                <span key={line} className="text-body">
                  {line}
                </span>
              ))}
            </address>
          )}

          {location.lat !== null && location.lng !== null && (
            <p className="tnum mt-2 text-meta text-muted">
              {t(locale, 'location.pinnedAt', {
                lat: location.lat.toFixed(5),
                lng: location.lng.toFixed(5),
              })}
              {location.accuracyM !== null &&
                ` · ${t(locale, 'location.accuracy', { m: location.accuracyM })}`}
            </p>
          )}

          <p className="mt-2 text-meta text-muted">
            {t(locale, `location.dropOff.${location.dropOff}`)}
            {location.notes.trim() !== '' && ` · ${location.notes}`}
          </p>
        </div>

        <button
          type="button"
          onClick={openLocationSheet}
          className="tap inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-line px-3 text-meta font-semibold transition-colors hover:border-accent"
        >
          <PencilSimpleIcon size={14} aria-hidden />
          {t(locale, 'checkout.editAddress')}
        </button>
      </div>

      {error !== undefined && <p className="text-meta font-semibold text-danger">{error}</p>}
    </div>
  );
}

function Section({
  heading,
  action,
  children,
}: {
  heading: string;
  /** The reference's right-hand section link. Optional; most sections have none. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="!font-sans !text-section !pb-0 !tracking-normal font-semibold">{heading}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * One field. Label ABOVE, help below the label, error BELOW the input.
 *
 * Never a placeholder as a label: the placeholder disappears the moment
 * someone types, which is exactly when they most want to check what the field
 * was asking for.
 */
function Field({
  id,
  label,
  help,
  error,
  value,
  onChange,
  type = 'text',
  autoComplete,
  required = false,
}: {
  id: string;
  label: string;
  // `| undefined` explicitly, because `exactOptionalPropertyTypes` is on: an
  // optional prop and a prop that may be undefined are different types here,
  // and every call site below passes a possibly-undefined error.
  help?: string | undefined;
  error?: string | undefined;
  value: string;
  onChange: (v: string) => void;
  type?: string | undefined;
  autoComplete?: string | undefined;
  required?: boolean | undefined;
}) {
  const describedBy = [
    help !== undefined ? `${id}-help` : null,
    error !== undefined ? `${id}-error` : null,
  ]
    .filter((x) => x !== null)
    .join(' ');

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-body font-semibold">
        {label}
      </label>
      {help !== undefined && (
        <p id={`${id}-help`} className="text-meta text-muted">
          {help}
        </p>
      )}
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        // `aria-required` rather than `required`: the form is `noValidate` so
        // that every message is ours and translated, but assistive technology
        // still has to know the field is mandatory.
        aria-required={required}
        className={`tap rounded-sm border bg-raised px-3 text-body text-ink placeholder:text-muted ${
          error === undefined ? 'border-line' : 'border-danger'
        }`}
      />
      {error !== undefined && (
        <p id={`${id}-error`} className="text-meta font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
