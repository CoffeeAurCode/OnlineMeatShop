'use client';

import { useState } from 'react';
import { CheckIcon, PlusIcon } from '@phosphor-icons/react/dist/ssr';

import type { Locale } from '@/i18n';
import { t } from '@/i18n';
import { addLine, lineKey, useCart } from '@/ui/cart';

import { openCart } from './drawer-state';
import { QtyStepper, WeightStepper } from './steppers';

/**
 * Adding to the basket, in the two places it happens.
 *
 * `variant="card"` is the one-tap control that sits on a product card in the
 * grid. `variant="page"` is the fuller control on the product page, with the
 * stepper and the cut preference.
 *
 * They are one component because they must agree about what a line IS: the
 * grid's quick-add and the product page's considered add have to produce the
 * same basket line, or a customer who used both ends up with two lines for one
 * fish. FR-4 keys a line on product AND prep option, so the quick-add on the
 * card deliberately adds the DEFAULT prep, never a null one that would later
 * merge with a chosen one.
 */

export interface AddableProduct {
  readonly productId: string;
  readonly slug: string;
  readonly name: string;
  readonly pricingMode: 'pack' | 'perKg';
  /** perKg: the catalog minimum and step. pack: the declared weight. */
  readonly minOrderG: number;
  readonly stepG: number;
  readonly availableG: number | null;
  readonly preps: readonly { id: string; label: string }[];
}

export function AddToBasket({
  product,
  locale,
  variant,
}: {
  product: AddableProduct;
  locale: Locale;
  variant: 'card' | 'page';
}) {
  const cart = useCart();
  const [grams, setGrams] = useState(product.minOrderG);
  const [qty, setQty] = useState(1);
  const [prepId, setPrepId] = useState<string | null>(product.preps[0]?.id ?? null);
  const [justAdded, setJustAdded] = useState(false);

  const prep = product.preps.find((p) => p.id === prepId) ?? null;
  const alreadyIn = cart.lines.some(
    (l) => lineKey(l) === lineKey({ productId: product.productId, prepOptionId: prepId }),
  );

  // Sold out today. `availableG === null` is NOT this: it means the shop has
  // not declared stock, which the card words differently.
  const soldOut = product.availableG !== null && product.availableG < product.minOrderG;

  function add() {
    addLine({
      productId: product.productId,
      slug: product.slug,
      name: product.name,
      requestedG: product.pricingMode === 'pack' ? product.minOrderG * qty : grams,
      prepOptionId: prepId,
      prepLabel: prep?.label ?? null,
    });
    setJustAdded(true);
    // The card variant does not steal focus into the drawer: a customer
    // quick-adding down a grid is mid-flow, and opening a panel over the grid
    // on every tap is the single most irritating thing a shop can do. The page
    // variant does open it, because adding there IS the end of the flow.
    if (variant === 'page') openCart();
    window.setTimeout(() => setJustAdded(false), 1600);
  }

  if (variant === 'card') {
    return (
      <button
        type="button"
        onClick={add}
        disabled={soldOut}
        aria-label={`${t(locale, 'product.addToBasket')}: ${product.name}`}
        className="tap inline-flex w-full items-center justify-center gap-2 rounded-sm bg-accent px-3 text-meta font-semibold text-accent-ink transition-[transform,background-color] duration-200 ease-brand hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98]"
      >
        {justAdded ? (
          <CheckIcon size={16} weight="bold" aria-hidden />
        ) : (
          <PlusIcon size={16} weight="bold" aria-hidden />
        )}
        <span>
          {justAdded
            ? t(locale, 'product.added')
            : soldOut
              ? t(locale, 'shop.soldOut')
              : alreadyIn
                ? t(locale, 'product.addMore')
                : t(locale, 'product.addToBasket')}
        </span>
      </button>
    );
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
                className={`tap inline-flex cursor-pointer items-center rounded-sm border px-4 text-body transition-colors duration-200 ${
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
          {product.pricingMode === 'perKg'
            ? t(locale, 'product.chooseWeight')
            : t(locale, 'product.chooseQuantity')}
        </span>
        {product.pricingMode === 'perKg' ? (
          <WeightStepper
            grams={grams}
            minG={product.minOrderG}
            stepG={product.stepG}
            maxG={product.availableG}
            onChange={setGrams}
            locale={locale}
          />
        ) : (
          <QtyStepper
            qty={qty}
            max={
              product.availableG === null
                ? null
                : Math.max(1, Math.floor(product.availableG / product.minOrderG))
            }
            onChange={setQty}
            locale={locale}
          />
        )}
      </div>

      <button
        type="button"
        onClick={add}
        disabled={soldOut}
        className="tap-lg inline-flex items-center justify-center gap-2 rounded-sm bg-accent px-6 text-lead font-semibold text-accent-ink transition-[transform,background-color] duration-200 ease-brand hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40 active:scale-[0.99]"
      >
        {justAdded ? (
          <CheckIcon size={20} weight="bold" aria-hidden />
        ) : (
          <PlusIcon size={20} weight="bold" aria-hidden />
        )}
        {justAdded
          ? t(locale, 'product.added')
          : soldOut
            ? t(locale, 'shop.soldOut')
            : t(locale, 'product.addToBasket')}
      </button>
    </div>
  );
}
