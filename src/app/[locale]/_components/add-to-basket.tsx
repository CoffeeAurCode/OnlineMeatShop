'use client';

import { useState } from 'react';
import { CheckIcon, PlusIcon } from '@phosphor-icons/react/dist/ssr';

import type { Locale } from '@/i18n';
import { t } from '@/i18n';
import { addLine } from '@/ui/cart';
import { money } from '@/ui/format';

import { openCart } from './drawer-state';
import { displayEstimateCents } from './estimate';
import { QtyStepper, WeightStepper } from './steppers';

/**
 * Adding to the basket, from the product page.
 *
 * ⚠ THE `variant="card"` BRANCH IS GONE. It was the one-tap control that used
 * to sit on a product card, and it chose the default cut and the minimum
 * weight silently — the two decisions this shop exists to let a customer make.
 * The card has opened the item sheet since the 2026-08-16 rebuild, so the
 * branch had no caller; it is deleted rather than kept "in case", because a
 * second way to add a line is a second definition of what a line IS, and
 * FR-4 keys a line on product AND prep option.
 *
 * The sheet and this control therefore stay deliberately parallel: the same
 * prep chips, the same steppers, and the same estimate on the same button.
 * `estimate.ts` is shared so the two cannot disagree about the amount.
 */

export interface AddableProduct {
  readonly productId: string;
  readonly slug: string;
  readonly name: string;
  readonly pricingMode: 'pack' | 'perKg';
  /** perKg: the rate per kilogram. pack: the fixed price of one pack. */
  readonly unitPriceCents: number;
  /** perKg: the catalog minimum and step. pack: the declared weight. */
  readonly minOrderG: number;
  readonly stepG: number;
  readonly availableG: number | null;
  readonly preps: readonly { id: string; label: string }[];
}

export function AddToBasket({ product, locale }: { product: AddableProduct; locale: Locale }) {
  const [grams, setGrams] = useState(product.minOrderG);
  const [qty, setQty] = useState(1);
  const [weightValid, setWeightValid] = useState(true);
  const [prepId, setPrepId] = useState<string | null>(product.preps[0]?.id ?? null);
  const [justAdded, setJustAdded] = useState(false);

  const prep = product.preps.find((p) => p.id === prepId) ?? null;
  // Display only. See `estimate.ts`; the server prices every basket.
  const estimate = displayEstimateCents(product.pricingMode, product.unitPriceCents, grams, qty);

  // Sold out today. `availableG === null` is NOT this: it means the shop has
  // not declared stock, which the card words differently.
  const soldOut = product.availableG !== null && product.availableG < product.minOrderG;

  function add() {
    if (!weightValid) return;
    addLine({
      productId: product.productId,
      slug: product.slug,
      name: product.name,
      requestedG: product.pricingMode === 'pack' ? product.minOrderG * qty : grams,
      prepOptionId: prepId,
      prepLabel: prep?.label ?? null,
    });
    setJustAdded(true);
    // Adding from the product page IS the end of the flow, so the drawer
    // opens. The grid does not do this: quick-adding down a list of fish is
    // mid-flow, and a panel over the grid on every tap is the single most
    // irritating thing a shop can do — which is why the item sheet opens the
    // drawer only after the customer has committed to a weight.
    openCart();
    window.setTimeout(() => setJustAdded(false), 1600);
  }

  return (
    <div className="grid gap-6">
      {product.preps.length > 0 && (
        <fieldset className="grid gap-3">
          <legend className="text-meta font-semibold uppercase tracking-[0.12em] text-muted">
            {t(locale, 'product.prepHeading')}
          </legend>
          <div className="flex flex-wrap gap-2">
            {product.preps.map((p) => (
              <label
                key={p.id}
                className={`tap inline-flex cursor-pointer items-center rounded-sm border px-4 text-body transition-colors duration-(--duration-fast) ${
                  prepId === p.id
                    ? 'border-accent bg-accent text-accent-ink'
                    : 'border-line bg-raised hover:border-accent'
                }`}
              >
                <input
                  type="radio"
                  name="prep"
                  value={p.id}
                  checked={prepId === p.id}
                  onChange={() => setPrepId(p.id)}
                  className="sr-only"
                />
                {p.label}
              </label>
            ))}
          </div>
          <p className="text-meta text-muted">{t(locale, 'product.prepNote')}</p>
        </fieldset>
      )}

      <div className="grid gap-3">
        <span className="text-meta font-semibold uppercase tracking-[0.12em] text-muted">
          {product.pricingMode === 'perKg' ? t(locale, 'product.chooseWeight') : t(locale, 'product.chooseQuantity')}
        </span>
        {product.pricingMode === 'perKg' ? (
          <WeightStepper
            grams={grams}
            minG={product.minOrderG}
            stepG={product.stepG}
            maxG={product.availableG}
            onChange={setGrams}
            onValidityChange={setWeightValid}
            locale={locale}
          />
        ) : (
          <QtyStepper
            qty={qty}
            max={product.availableG === null ? null : Math.max(1, Math.floor(product.availableG / product.minOrderG))}
            onChange={setQty}
            locale={locale}
          />
        )}
      </div>

      {/*
        ⭐ THE AMOUNT IS ON THE BUTTON, aligned right, exactly as it is in the
        item sheet. The customer commits to a number rather than to a verb, and
        the number sits beside their thumb rather than scrolled off the top.

        ⚠ It is an ESTIMATE and the copy above says so. `product.aboutAmount`
        wraps it in "about" for per-kilogram items, which is the whole point:
        a bare figure on the button would read as the price.
      */}
      <button
        type="button"
        onClick={add}
        disabled={soldOut || !weightValid}
        className="tap-lg flex w-full items-center justify-center gap-3 rounded-sm bg-accent px-6 text-lead font-semibold text-accent-ink transition-[transform,background-color] duration-(--duration-fast) ease-brand hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40 active:scale-[0.99]"
      >
        {justAdded ? (
          <CheckIcon size={20} weight="bold" aria-hidden />
        ) : (
          <PlusIcon size={20} weight="bold" aria-hidden />
        )}
        <span>
          {justAdded
            ? t(locale, 'product.added')
            : soldOut
              ? t(locale, 'shop.soldOut')
              : t(locale, 'product.addToBasket')}
        </span>
        {!soldOut && !justAdded && (
          <span className="tnum ml-auto">
            {product.pricingMode === 'perKg'
              ? t(locale, 'product.aboutAmount', {
                  amount: money(estimate, locale),
                })
              : money(estimate, locale)}
          </span>
        )}
      </button>
    </div>
  );
}
