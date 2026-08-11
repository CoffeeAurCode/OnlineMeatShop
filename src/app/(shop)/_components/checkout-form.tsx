'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { clearCart, useCart } from '@/ui/cart';
import { money } from '@/ui/format';

import { MoneySentence } from './money-sentence';

/**
 * Checkout.
 *
 * Every one of the nine failure codes from `03-PLAN` §3.3 is handled, in the
 * five presentation classes `04-PLAN` §10.3 defines. The classes are what stop
 * this becoming nine bespoke error screens:
 *
 *   A — inline field    invalidQuantity, insufficientStock
 *   B — picker re-render slotCutoffPassed, slotFull, hotFoodNotAllowedInSlot
 *   C — basket notice   productUnavailable, outsideDeliveryArea
 *   D — blocking dialog priceChanged
 *   E — silent success  checkoutAttemptNotOpen
 */

export interface SlotOption {
  id: string;
  label: string;
  hotEligible: boolean;
  full: boolean;
  cutoffPassed: boolean;
}

interface Quote {
  lineSubtotalCents: number;
  deliveryFeeCents: number | null;
  estTotalCents: number | null;
  toFreeDeliveryCents: number | null;
  catalogVersion: number;
  hasHotLine: boolean;
  hasEstimate: boolean;
  serviceable: boolean | null;
  problems: string[];
}

export function CheckoutForm({ slots }: { slots: readonly SlotOption[] }) {
  const { lines, ready } = useCart();

  const [postalCode, setPostalCode] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [slotId, setSlotId] = useState<string | null>(null);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [slotProblem, setSlotProblem] = useState<string | null>(null);
  const [basketProblem, setBasketProblem] = useState<string | null>(null);
  const [fieldProblem, setFieldProblem] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ orderId: string; estTotalCents: number } | null>(null);
  const [repriced, setRepriced] = useState<{ was: number; now: number; version: number } | null>(null);

  const dialog = useRef<HTMLDialogElement>(null);

  // Re-quote whenever the basket or the address changes. The delivery fee
  // depends on both, and the free-delivery threshold depends on the subtotal,
  // so neither can be worked out until the postcode is known.
  useEffect(() => {
    if (!ready || lines.length === 0) return;
    let cancelled = false;

    void (async () => {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lines: lines.map((l) => ({
            productId: l.productId,
            requestedG: l.requestedG,
            prepOptionId: l.prepOptionId,
          })),
          postalCode: postalCode.trim() === '' ? null : postalCode,
        }),
      });
      if (cancelled || !res.ok) return;
      setQuote((await res.json()) as Quote);
    })();

    return () => {
      cancelled = true;
    };
  }, [lines, ready, postalCode]);

  // Class B: hot food narrows the picker, and the reason is stated. A slot
  // that is merely disabled with no explanation reads as a broken website.
  const hot = quote?.hasHotLine === true;
  const selectable = slots.filter((s) => !s.cutoffPassed && !s.full && (!hot || s.hotEligible));

  // If the chosen slot stops being selectable — hot food was added, its
  // cut-off passed — it is simply not chosen any more. Derived rather than
  // reset in an effect, which would render once with an impossible selection
  // and once without.
  const chosenSlotId = slotId !== null && selectable.some((s) => s.id === slotId) ? slotId : null;

  if (ready && lines.length === 0 && placed === null) {
    return (
      <div className="mt-8 rounded-md border border-line bg-raised px-4 py-10">
        <p className="text-section font-semibold tracking-tight">Your basket is empty</p>
        <Link href="/shop" className="mt-4 inline-block text-body underline underline-offset-4">
          See what we have today
        </Link>
      </div>
    );
  }

  // Class E: a double submit is NOT an error. The customer sees their order.
  if (placed !== null) {
    return (
      <div className="mt-8">
        <p className="text-section font-semibold tracking-tight">Order placed</p>
        <p className="mt-3 max-w-[60ch] text-body text-muted">
          We have your order and the shop can see it. Anything cut to order is weighed before it
          goes out, and the amount you pay is the weight you actually get.
        </p>
        <p className="tnum mt-6 text-lead">
          Estimated total <span className="font-semibold">{money(placed.estTotalCents)}</span>
        </p>
        <p className="mt-6 rounded-sm bg-hot-wash px-3 py-3 text-body text-hot">
          Card payment is not connected yet, so this order is marked pay on delivery.
        </p>
      </div>
    );
  }

  async function submit() {
    setBusy(true);
    setSlotProblem(null);
    setBasketProblem(null);
    setFieldProblem(null);

    if (chosenSlotId === null) {
      setSlotProblem('Choose a delivery time.');
      setBusy(false);
      return;
    }

    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lines: lines.map((l) => ({
          productId: l.productId,
          requestedG: l.requestedG,
          prepOptionId: l.prepOptionId,
        })),
        postalCode,
        slotId: chosenSlotId,
        email,
        name: name.trim() === '' ? null : name,
        phone: phone.trim() === '' ? null : phone,
        catalogVersion: quote?.catalogVersion ?? 0,
      }),
    });

    const body = (await res.json()) as {
      ok?: boolean;
      orderId?: string;
      estTotalCents?: number;
      reason?: string;
      catalogVersion?: number;
    };

    if (res.ok && body.ok === true) {
      setPlaced({ orderId: body.orderId ?? '', estTotalCents: body.estTotalCents ?? 0 });
      clearCart();
      setBusy(false);
      return;
    }

    switch (body.reason) {
      // Class E — silent success. The first submit already made the order.
      case 'checkoutAttemptNotOpen':
        setPlaced({ orderId: body.orderId ?? '', estTotalCents: quote?.estTotalCents ?? 0 });
        clearCart();
        break;

      // Class D — blocking re-confirm. Never accepted automatically.
      case 'priceChanged':
        setRepriced({
          was: quote?.estTotalCents ?? 0,
          now: body.estTotalCents ?? 0,
          version: body.catalogVersion ?? 0,
        });
        dialog.current?.showModal();
        break;

      // Class B — the picker re-renders with the reason above it.
      case 'slotCutoffPassed':
        setSlotId(null);
        setSlotProblem('That time closed while you were ordering. Pick another.');
        break;
      case 'slotFull':
        setSlotId(null);
        setSlotProblem('That time filled up. The rest of your basket is untouched.');
        break;
      case 'hotFoodNotAllowedInSlot':
        setSlotId(null);
        setSlotProblem(
          'Your basket has hot food, so we can only deliver it in a slot we can get it to you hot in. That is a food-safety rule.',
        );
        break;

      // Class C — basket-level notice naming the thing, one action.
      case 'outsideDeliveryArea':
        setBasketProblem('We do not deliver to that postal code. We only cover a small local radius.');
        break;
      case 'productUnavailable':
        setBasketProblem('Something in your basket has just come off the shop. Go back and remove it.');
        break;

      // Class A — inline, next to the field it is about.
      case 'invalidQuantity':
        setFieldProblem('One of your quantities is not one we can cut. Adjust it in the basket.');
        break;
      case 'insufficientStock':
        setFieldProblem('Someone got there first. Check the basket for what is left.');
        break;

      case 'shopClosed':
        setBasketProblem('The shop stopped taking orders while you were checking out.');
        break;
      default:
        setBasketProblem('That did not go through, and nothing has been charged.');
    }
    setBusy(false);
  }

  const total = quote?.estTotalCents;

  return (
    <>
      {basketProblem !== null ? (
        <p role="alert" className="mt-6 rounded-sm bg-danger-wash px-3 py-3 text-body text-danger">
          {basketProblem}{' '}
          <Link href="/basket" className="underline underline-offset-4">
            Go to basket
          </Link>
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-section font-semibold tracking-tight">Where to</h2>
        <div className="mt-4 grid gap-4">
          <Field
            id="postal"
            label="Postal code"
            value={postalCode}
            onChange={setPostalCode}
            autoComplete="postal-code"
            placeholder="A1A 1A1"
            error={quote?.serviceable === false ? 'We do not deliver to that postal code yet.' : null}
          />
          <Field id="email" label="Email" value={email} onChange={setEmail} autoComplete="email" type="email" />
          <Field id="name" label="Name" value={name} onChange={setName} autoComplete="name" />
          <Field
            id="phone"
            label="Phone"
            value={phone}
            onChange={setPhone}
            autoComplete="tel"
            type="tel"
            help="We only call if a cut comes out heavier or lighter than you asked for."
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-section font-semibold tracking-tight">When</h2>

        {hot ? (
          <p className="mt-3 rounded-sm bg-hot-wash px-3 py-3 text-body text-hot">
            Your basket has hot food, so only the times we can get it to you hot in are shown.
          </p>
        ) : null}

        {slotProblem !== null ? (
          <p role="alert" className="mt-3 rounded-sm bg-danger-wash px-3 py-3 text-body text-danger">
            {slotProblem}
          </p>
        ) : null}

        {selectable.length === 0 ? (
          <p className="mt-4 rounded-md border border-line bg-raised px-4 py-6 text-body text-muted">
            {hot
              ? 'There are no delivery times left today that can carry hot food. Removing the hot items will open up more.'
              : 'There are no delivery times left today.'}
          </p>
        ) : (
          <fieldset className="mt-4">
            <legend className="sr-only">Delivery time</legend>
            <div className="grid gap-2">
              {selectable.map((slot) => (
                <label
                  key={slot.id}
                  className={`tap-lg flex cursor-pointer items-center justify-between rounded-sm border px-4 text-body ${
                    chosenSlotId === slot.id ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-raised'
                  }`}
                >
                  <span className="tnum">{slot.label}</span>
                  <input
                    type="radio"
                    name="slot"
                    value={slot.id}
                    checked={chosenSlotId === slot.id}
                    onChange={() => {
                      setSlotId(slot.id);
                      setSlotProblem(null);
                    }}
                    className="sr-only"
                  />
                  {slot.hotEligible ? <span className="text-meta">Can carry hot food</span> : null}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-section font-semibold tracking-tight">Total</h2>
        <div className="mt-4 border-b border-line pb-3">
          <Row label="Items" value={quote === null ? null : quote.lineSubtotalCents} />
          <Row
            label="Delivery"
            value={quote?.deliveryFeeCents ?? null}
            hint={quote?.deliveryFeeCents === null ? 'Enter a postal code' : undefined}
          />
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-4">
          <span className="text-lead font-semibold">Estimated total</span>
          <span className="tnum text-lead font-semibold">
            {total === null || total === undefined ? '· · ·' : money(total)}
          </span>
        </div>

        {quote?.toFreeDeliveryCents != null ? (
          <p className="mt-2 text-body text-muted">
            {money(quote.toFreeDeliveryCents)} more for free delivery.
          </p>
        ) : null}

        {fieldProblem !== null ? (
          <p role="alert" className="mt-4 rounded-sm bg-danger-wash px-3 py-3 text-body text-danger">
            {fieldProblem}{' '}
            <Link href="/basket" className="underline underline-offset-4">
              Go to basket
            </Link>
          </p>
        ) : null}

        <p className="mt-6 rounded-sm border border-line bg-raised px-3 py-3 text-body text-muted">
          Card payment is not connected yet. Orders placed now are marked pay on delivery.
        </p>

        {/*
          §10.4: the money sentence sits DIRECTLY above the button, with
          nothing between them, at full size. Do not insert anything here.
        */}
        {total !== null && total !== undefined ? (
          <div className="mt-6">
            <MoneySentence holdCents={total} />
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || total === null || total === undefined || quote?.serviceable !== true}
          className="tap-lg mt-4 flex w-full items-center justify-center rounded-sm bg-accent px-4 text-lead font-semibold text-accent-ink transition-colors hover:bg-accent-hover active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? 'Placing your order' : 'Place order'}
        </button>
      </section>

      {/* Class D — native dialog. No default button, no auto-dismiss. */}
      <dialog
        ref={dialog}
        className="w-[min(28rem,92vw)] rounded-md border border-line bg-raised p-6 text-ink backdrop:bg-black/40"
      >
        <h2 className="text-section font-semibold tracking-tight">The price changed</h2>
        <p className="mt-3 max-w-[50ch] text-body text-muted">
          Our prices moved while you were checking out. Nothing has been charged. Have a look before
          you carry on.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-4">
          <div>
            <p className="text-meta text-muted">You were quoted</p>
            <p className="tnum text-lead font-semibold">{money(repriced?.was ?? 0)}</p>
          </div>
          <div>
            <p className="text-meta text-muted">It is now</p>
            <p className="tnum text-lead font-semibold">{money(repriced?.now ?? 0)}</p>
          </div>
        </div>
        <div className="mt-6 grid gap-2">
          <button
            type="button"
            onClick={() => {
              setQuote((q) => (q === null ? q : { ...q, catalogVersion: repriced?.version ?? q.catalogVersion }));
              dialog.current?.close();
            }}
            className="tap-lg w-full rounded-sm bg-accent px-4 text-lead font-semibold text-accent-ink"
          >
            Accept the new price
          </button>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="tap-lg w-full rounded-sm border border-line bg-raised px-4 text-lead font-semibold"
          >
            Go back
          </button>
        </div>
      </dialog>
    </>
  );
}

function Row({ label, value, hint }: { label: string; value: number | null; hint?: string | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-body">{label}</span>
      <span className="tnum text-body">
        {value === null ? <span className="text-muted">{hint ?? '· · ·'}</span> : money(value)}
      </span>
    </div>
  );
}

/** Label ABOVE the input, help under it, error under that. Never a placeholder as a label. */
function Field({
  id,
  label,
  value,
  onChange,
  error,
  help,
  ...rest
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  help?: string;
  // `onChange` is deliberately replaced by a value-taking callback, so the
  // native handler has to be omitted or the two collide.
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'id' | 'value'>) {
  return (
    <div>
      <label htmlFor={id} className="block text-body font-semibold">
        {label}
      </label>
      <input
        {...rest}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error != null}
        aria-describedby={error != null ? `${id}-error` : help !== undefined ? `${id}-help` : undefined}
        className={`tap mt-2 w-full rounded-sm border bg-raised px-3 text-body ${
          error != null ? 'border-danger' : 'border-line'
        }`}
      />
      {help !== undefined && error == null ? (
        <p id={`${id}-help`} className="mt-1 text-meta text-muted">
          {help}
        </p>
      ) : null}
      {error != null ? (
        <p id={`${id}-error`} className="mt-1 text-meta text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
