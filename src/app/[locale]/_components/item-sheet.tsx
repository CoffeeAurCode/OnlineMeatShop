'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { CheckIcon, XIcon } from '@phosphor-icons/react/dist/ssr';

import { t, type Locale } from '@/i18n';
import { addLine } from '@/ui/cart';
import { money, pricePerUnit, ratePerKg, weight } from '@/ui/format';

import { useDialog } from './dialog';
import { displayEstimateCents } from './estimate';
import { HandlingLabel, HotPill } from './handling';
import { openCart } from './drawer-state';
import { QtyStepper, WeightStepper } from './steppers';

/**
 * ⭐ THE ITEM SHEET. Uber Eats' customization dialog, which is the single
 * highest-leverage borrowing in this redesign.
 *
 * The old storefront had two ways to add: a one-tap button on the card that
 * silently used the default cut and the minimum weight, and a full product
 * page for anything considered. That is a bad split for THIS shop, because the
 * two things a customer must decide here — how much, and how it is cut — are
 * exactly the two things the quick-add guessed for them. Somebody wanting
 * 1.5 kg filleted had to leave the grid, load a page, and come back.
 *
 * The sheet puts both decisions on top of the grid, with the estimate updating
 * as the weight changes, and never unmounts the page behind it.
 *
 * ⚠ THE PRICE IN HERE IS AN ESTIMATE AND SAYS SO. It is computed client-side
 * from the catalog rate purely to be responsive to the stepper. It is NOT the
 * price: the server recomputes every amount from the catalog when the basket
 * is quoted, and again inside the placement transaction. The arithmetic is
 * duplicated here on purpose and is allowed to be, because nothing downstream
 * reads it — see the note on `estimate` below.
 *
 * ⚠ THE PRODUCT PAGE STILL EXISTS and is not superseded. `/p/[slug]` is the
 * crawlable, linkable, shareable surface with the full description and the
 * structured data, and organic local search is why this app has a server tier
 * at all. The sheet is a shortcut for someone already on the grid.
 */

export interface SheetProduct {
  readonly productId: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly imagePath: string | null;
  readonly handling: string;
  readonly pricingMode: 'pack' | 'perKg';
  /** perKg: rate per kg. pack: the fixed price. */
  readonly unitPriceCents: number;
  readonly minOrderG: number;
  readonly stepG: number;
  readonly availableG: number | null;
  readonly preps: readonly { id: string; label: string }[];
}

export function ItemSheet({
  product,
  locale,
  onClose,
}: {
  product: SheetProduct;
  locale: Locale;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  const [grams, setGrams] = useState(product.minOrderG);
  const [qty, setQty] = useState(1);
  const [prepId, setPrepId] = useState<string | null>(product.preps[0]?.id ?? null);

  const perKg = product.pricingMode === 'perKg';
  const prep = product.preps.find((p) => p.id === prepId) ?? null;
  const soldOut = product.availableG !== null && product.availableG < product.minOrderG;

  // Escape, the Tab trap, and — new — putting focus back on the card's add
  // button when the sheet closes. See `dialog.ts` for why the last of those
  // was the half that was missing everywhere.
  useDialog(panel, onClose, closeButton);

  // Display only, and it never leaves this component. `estimate.ts` carries
  // the full reasoning and is shared with the product page, which shows the
  // same amount on the same kind of button.
  const estimate = displayEstimateCents(product.pricingMode, product.unitPriceCents, grams, qty);

  function add() {
    addLine({
      productId: product.productId,
      slug: product.slug,
      name: product.name,
      requestedG: perKg ? grams : product.minOrderG * qty,
      prepOptionId: prepId,
      prepLabel: prep?.label ?? null,
    });
    onClose();
    openCart();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="item-sheet-title"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t(locale, 'nav.close')}
        className="absolute inset-0 animate-[fade-in_var(--duration-standard)_ease-out] bg-midnight/60"
      />

      <div
        ref={panel}
        className="
          relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-md border
          border-line bg-surface elev-sheet
          animate-[slide-up_var(--duration-standard)_var(--ease-brand)]
          sm:max-h-[88dvh] sm:max-w-[32rem] sm:rounded-md
          sm:animate-[fade-in_var(--duration-standard)_ease-out]
        "
      >
        <div className="relative shrink-0">
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-soft">
            {product.imagePath === null ? (
              // The same honest tile the grid uses. A sheet with a blank grey
              // band at the top reads as a photograph that failed to load,
              // which is a different and worse message than "no photograph".
              <div className="fallback-tile absolute inset-0">
                <p className="text-lead font-semibold text-ink">{product.name}</p>
                <p className="text-meta text-muted">
                  {t(locale, `handling.${product.handling}`)}
                </p>
              </div>
            ) : (
              <Image
                src={product.imagePath}
                alt=""
                fill
                sizes="(max-width: 639px) 100vw, 32rem"
                className="object-cover"
              />
            )}
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label={t(locale, 'nav.close')}
            className="
              absolute right-3 top-3 grid size-10 place-items-center rounded-full
              bg-surface text-ink transition-transform duration-(--duration-fast)
              hover:bg-soft active:scale-[0.94]
            "
          >
            <XIcon size={18} weight="bold" aria-hidden />
          </button>
        </div>

        <div className="grid gap-5 overflow-y-auto px-5 py-5">
          <div className="grid gap-2">
            {/*
              ⭐ THE HANDLING CLASS IS THE FIRST THING IN THE SHEET, above the
              name. §8 orders it "name/rate/description, handling/availability"
              and this reads one line earlier than that on purpose: hot food
              constrains the delivery window for the WHOLE ORDER, so a customer
              adding it has to meet that fact before they choose a weight, not
              after. The three non-hot classes cost one quiet line to say the
              same way.
            */}
            {product.handling === 'COOKED_HOT' ? (
              <HotPill locale={locale} />
            ) : (
              <HandlingLabel handling={product.handling} locale={locale} />
            )}
            <h2
              id="item-sheet-title"
              className="!font-sans !text-section !pb-0 !tracking-normal font-semibold"
            >
              {product.name}
            </h2>
            <p className="tnum text-lead font-semibold">
              {perKg
                ? ratePerKg(product.unitPriceCents, locale)
                : pricePerUnit(product.unitPriceCents, t(locale, 'product.unitPack'), locale)}
            </p>
            {product.description !== null && (
              <p className="max-w-[52ch] text-body text-muted">{product.description}</p>
            )}
            <p className="text-meta text-muted">
              {perKg ? t(locale, 'product.estimatedNote') : t(locale, 'product.fixedWeightNote')}
            </p>
          </div>

          {product.preps.length > 0 && (
            <fieldset className="grid gap-3 border-t border-line pt-5">
              <legend className="text-body font-semibold">{t(locale, 'product.prepHeading')}</legend>
              <div className="flex flex-wrap gap-2">
                {product.preps.map((p) => (
                  <label
                    key={p.id}
                    className={`tap inline-flex cursor-pointer items-center rounded-full border px-4 text-meta font-semibold transition-colors duration-(--duration-fast) ${
                      prepId === p.id
                        ? 'border-accent bg-accent text-accent-ink'
                        : 'border-line bg-raised hover:border-accent'
                    }`}
                  >
                    <input
                      type="radio"
                      name="sheet-prep"
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

          <div className="grid gap-3 border-t border-line pt-5">
            <span className="text-body font-semibold">
              {perKg ? t(locale, 'product.chooseWeight') : t(locale, 'product.chooseQuantity')}
            </span>
            {perKg ? (
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
            {product.availableG !== null && !soldOut && (
              <p className="text-meta text-muted">
                {t(locale, 'shop.leftToday', { amount: weight(product.availableG, locale) })}
              </p>
            )}
          </div>
        </div>

        {/*
          ⭐ THE AMOUNT IS ON THE BUTTON. Uber's pattern, and the right one:
          the customer commits to a number rather than to a verb, and the
          number is beside their thumb rather than scrolled off the top.
        */}
        <footer className="shrink-0 border-t border-line bg-raised px-5 py-4">
          <button
            type="button"
            onClick={add}
            disabled={soldOut}
            className="
              tap-lg flex w-full items-center justify-center gap-3 rounded-sm bg-accent px-6
              text-body font-semibold text-accent-ink transition-[transform,background-color]
              duration-(--duration-fast) ease-brand hover:bg-accent-hover active:scale-[0.99]
              disabled:pointer-events-none disabled:opacity-40
            "
          >
            <CheckIcon size={18} weight="bold" aria-hidden />
            <span>{soldOut ? t(locale, 'shop.soldOut') : t(locale, 'product.addToBasket')}</span>
            {!soldOut && (
              <span className="tnum ml-auto">
                {perKg ? t(locale, 'product.aboutAmount', { amount: money(estimate, locale) })
                       : money(estimate, locale)}
              </span>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
