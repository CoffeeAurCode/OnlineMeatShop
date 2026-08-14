'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { t, type Locale } from '@/i18n';
import { clearCart, lineKey, useCart } from '@/ui/cart';
import { money, weight } from '@/ui/format';

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
 */

export interface SlotOption {
  id: string;
  label: string;
  hotEligible: boolean;
  full: boolean;
  cutoffPassed: boolean;
}

interface Quote {
  lines: { productId: string; prepOptionId: string | null; name: string; amountCents: number }[];
  lineSubtotalCents: number;
  deliveryFeeCents: number | null;
  estTotalCents: number | null;
  catalogVersion: number;
  hasHotLine: boolean;
  serviceable: boolean | null;
}

const PROVINCES = ['QC', 'ON', 'NB', 'NS', 'PE', 'NL', 'MB', 'SK', 'AB', 'BC', 'YT', 'NT', 'NU'];

export function CheckoutForm({ slots, locale }: { slots: SlotOption[]; locale: Locale }) {
  const router = useRouter();
  const cart = useCart();

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('QC');
  const [postalCode, setPostalCode] = useState('');
  const [notes, setNotes] = useState('');
  const [slotId, setSlotId] = useState('');

  const [fetchedQuote, setQuote] = useState<Quote | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const signature = cart.lines.map((l) => `${lineKey(l)}@${l.requestedG}`).join('|');

  // Re-quoted whenever the basket or the postal code changes, because the
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
        postalCode: postalCode.trim() === '' ? null : postalCode,
        locale,
      }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<Quote>) : Promise.reject(new Error('quote'))))
      .then(setQuote)
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [signature, postalCode, locale, cart.lines]);

  /*
   * ⭐ THE HOT-FOOD SLOT RULE, SHOWN. Hiding the windows that cannot carry hot
   * food is a COURTESY, not the guarantee: precondition P7 refuses the order
   * server-side regardless, because this is a food-safety rule and a filtered
   * dropdown is not an enforcement mechanism. Both exist on purpose.
   */
  /*
   * Derived, not stored. An emptied basket must not keep showing the totals of
   * what used to be in it, and deriving that is both simpler and correct
   * during the render where the basket changed.
   */
  const quote = cart.lines.length === 0 ? null : fetchedQuote;

  const hot = quote?.hasHotLine === true;
  const usable = slots.filter((s) => !s.cutoffPassed && (!hot || s.hotEligible));

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!/^\+?1?[\s\-().]*(\d[\s\-().]*){10}$/.test(phone)) {
      errors.phone = t(locale, 'checkout.phoneInvalid');
    }
    if (line1.trim() === '') errors.line1 = t(locale, 'checkout.required');
    if (city.trim() === '') errors.city = t(locale, 'checkout.required');
    if (postalCode.trim() === '') errors.postalCode = t(locale, 'checkout.required');
    if (slotId === '') errors.slotId = t(locale, 'checkout.required');
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || quote === null) return;
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
          postalCode,
          addressLine1: line1,
          addressLine2: line2.trim() === '' ? null : line2,
          city,
          province,
          deliveryNotes: notes.trim() === '' ? null : notes,
          slotId,
          phone,
          name: name.trim() === '' ? null : name,
          email: email.trim() === '' ? null : email,
          catalogVersion: quote.catalogVersion,
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

      // The nine failure codes each have their own sentence. A generic
      // "something went wrong" on a checkout is what makes a customer try
      // again and place two orders.
      const reason = body.reason ?? 'generic';
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

      <Section heading={t(locale, 'checkout.contactHeading')}>
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

      <Section heading={t(locale, 'checkout.addressHeading')}>
        <Field
          id="line1"
          label={t(locale, 'checkout.line1Label')}
          error={fieldErrors.line1}
          value={line1}
          onChange={setLine1}
          autoComplete="address-line1"
          required
        />
        <Field
          id="line2"
          label={t(locale, 'checkout.line2Label')}
          help={t(locale, 'checkout.line2Optional')}
          value={line2}
          onChange={setLine2}
          autoComplete="address-line2"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="city"
            label={t(locale, 'checkout.cityLabel')}
            error={fieldErrors.city}
            value={city}
            onChange={setCity}
            autoComplete="address-level2"
            required
          />
          <div className="grid gap-2">
            <label htmlFor="province" className="text-body font-semibold">
              {t(locale, 'checkout.provinceLabel')}
            </label>
            <select
              id="province"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              autoComplete="address-level1"
              className="tap rounded-sm border border-line bg-raised px-3 text-body text-ink"
            >
              {PROVINCES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Field
          id="postalCode"
          label={t(locale, 'checkout.postalLabel')}
          help={t(locale, 'checkout.postalHelp')}
          error={
            fieldErrors.postalCode ??
            (quote?.serviceable === false ? t(locale, 'errors.outsideDeliveryArea') : undefined)
          }
          value={postalCode}
          onChange={setPostalCode}
          autoComplete="postal-code"
          required
        />
        <Field
          id="notes"
          label={t(locale, 'checkout.notesLabel')}
          help={t(locale, 'checkout.notesHelp')}
          value={notes}
          onChange={setNotes}
        />
      </Section>

      <Section heading={t(locale, 'checkout.slotHeading')}>
        {hot && (
          <p className="rounded-sm border border-line bg-soft px-3 py-2 text-body">
            {t(locale, 'checkout.hotWarning')}
          </p>
        )}
        {fieldErrors.slotId !== undefined && (
          <p className="text-meta text-danger">{fieldErrors.slotId}</p>
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
              {s.full && <span className="text-meta text-muted">{t(locale, 'checkout.slotFull')}</span>}
              {s.hotEligible && (
                <span className="ml-auto text-meta text-muted">
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
                </span>
                <span className="tnum shrink-0">
                  {q === undefined ? '' : money(q.amountCents, locale)}
                </span>
              </li>
            );
          })}
        </ul>

        <dl className="grid gap-1 border-t border-line pt-4 text-body">
          <div className="flex justify-between">
            <dt>{t(locale, 'basket.subtotal')}</dt>
            <dd className="tnum">
              {quote === null ? '' : money(quote.lineSubtotalCents, locale)}
            </dd>
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
          disabled={submitting || quote?.estTotalCents == null}
          className="tap-lg inline-flex items-center justify-center rounded-sm bg-accent px-6 text-lead font-semibold text-accent-ink transition-colors duration-200 hover:bg-accent-hover disabled:opacity-60 active:scale-[0.99]"
        >
          {submitting ? t(locale, 'checkout.placing') : t(locale, 'checkout.place')}
        </button>
      </div>
    </form>
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
  const describedBy = [help !== undefined ? `${id}-help` : null, error !== undefined ? `${id}-error` : null]
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
