'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FlameIcon, MapPinIcon, PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr';

import { quoteProblemMessage, t, type Locale } from '@/i18n';
import { clearCart, lineKey, useCart } from '@/ui/cart';
import { useCustomerSession } from '@/ui/customer-session';
import { money, weight } from '@/ui/format';
import { isDeliverable, useDeliveryLocation } from '@/ui/location';

import { openLocationSheet, openSignIn } from './drawer-state';
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

  const signature = cart.lines.map((l) => `${lineKey(l)}@${l.requestedG}`).join('|');
  const destinationKey =
    location.lat !== null && location.lng !== null
      ? `${location.lat},${location.lng}`
      : location.postalCode.trim().toUpperCase();

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
      body: JSON.stringify({
        lines: cart.lines.map((l) => ({
          productId: l.productId,
          requestedG: l.requestedG,
          prepOptionId: l.prepOptionId,
        })),
        lat: location.lat,
        lng: location.lng,
        postalCode: location.postalCode.trim() === '' ? null : location.postalCode,
        locale,
      }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<Quote>) : Promise.reject(new Error('quote'))))
      .then(setQuote)
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [signature, destinationKey, locale, cart.lines, location]);

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

      {/*
        ⭐ THE PAYMENT CHOICE, AFTER THE ADDRESS AND BEFORE THE WINDOW.

        Placed here because it is the last thing that changes the TOTAL story —
        a cash customer needs to know the driver arrives with an exact figure —
        and because burying it under the slot list would put it below the fold
        on a phone, where the customer's thumb is already on the place button.

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

      <Section heading={t(locale, 'basket.title')}>
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
        ⚠ NOTHING GOES BETWEEN THE MONEY SENTENCE AND THE BUTTON. Not a
        checkbox, not a promo field, not a reassurance. `04-PLAN` §10.4.
      */}
      <div className="grid gap-4">
        {quote?.estTotalCents != null && (
          <MoneySentence estimateCents={quote.estTotalCents} locale={locale} />
        )}
        <button
          type="submit"
          disabled={submitting || hasProblem || quote?.estTotalCents == null}
          className="tap-lg inline-flex items-center justify-center rounded-sm bg-accent px-6 text-lead font-semibold text-accent-ink transition-colors duration-200 hover:bg-accent-hover disabled:opacity-60 active:scale-[0.99]"
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
    </form>
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

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4">
      <h2 className="!font-sans !text-section !pb-0 !tracking-normal font-semibold">{heading}</h2>
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
