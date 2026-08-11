'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Pricing } from '@/domain/types';
import { addLine } from '@/ui/cart';
import { money, weight } from '@/ui/format';

/**
 * Choose a quantity and a cut, and put it in the basket.
 *
 * The stepper walks the product's REAL step size, read from the catalog, so an
 * illegal quantity is not reachable by tapping. `invalidQuantity` (P5) can
 * still come back from the server if the catalog moved underneath the page,
 * and it is handled at checkout as presentation class A; this just means the
 * ordinary path never provokes it.
 *
 * The estimate below the stepper is computed here from the rate for
 * responsiveness while tapping, and it is labelled as an estimate. It is not
 * the quote: every amount that matters is recomputed server-side, and the one
 * shown at checkout comes from `/api/quote`.
 */
export function AddToBasket({
  productId,
  slug,
  name,
  pricing,
  preps,
  disabled,
}: {
  productId: string;
  slug: string;
  name: string;
  pricing: Pricing;
  preps: readonly { id: string; label: string }[];
  disabled: boolean;
}) {
  const router = useRouter();

  const step = pricing.mode === 'perKg' ? pricing.step : 1;
  const minimum = pricing.mode === 'perKg' ? pricing.minOrder : 1;

  const [grams, setGrams] = useState(minimum);
  const [prepId, setPrepId] = useState<string | null>(preps[0]?.id ?? null);
  const [added, setAdded] = useState(false);

  const estimate =
    pricing.mode === 'pack'
      ? pricing.price
      : Math.ceil((pricing.ratePerKg * grams) / 1000);

  if (disabled) {
    return (
      <p className="rounded-sm border border-line bg-raised px-4 py-4 text-body text-muted">
        Not available today. Stock goes up each trading morning.
      </p>
    );
  }

  return (
    <div>
      {preps.length > 0 ? (
        <fieldset>
          <legend className="text-body font-semibold">How would you like it cut?</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {preps.map((prep) => (
              <label
                key={prep.id}
                className={`tap flex cursor-pointer items-center rounded-sm border px-4 text-body ${
                  prepId === prep.id ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-raised'
                }`}
              >
                <input
                  type="radio"
                  name="prep"
                  value={prep.id}
                  checked={prepId === prep.id}
                  onChange={() => setPrepId(prep.id)}
                  className="sr-only"
                />
                {prep.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {pricing.mode === 'perKg' ? (
        <div className="mt-6">
          <p className="text-body font-semibold" id="qty-label">
            How much?
          </p>
          <div className="mt-3 flex items-center gap-3" role="group" aria-labelledby="qty-label">
            <button
              type="button"
              onClick={() => setGrams((g) => Math.max(minimum, g - step))}
              disabled={grams <= minimum}
              aria-label={`Less, ${weight(Math.max(minimum, grams - step))}`}
              className="tap w-14 rounded-sm border border-line bg-raised text-lead font-semibold disabled:opacity-40"
            >
              －
            </button>
            <output className="tnum min-w-28 text-center text-lead font-semibold">
              {weight(grams)}
            </output>
            <button
              type="button"
              onClick={() => setGrams((g) => g + step)}
              aria-label={`More, ${weight(grams + step)}`}
              className="tap w-14 rounded-sm border border-line bg-raised text-lead font-semibold"
            >
              ＋
            </button>
          </div>
          <p className="mt-3 text-body text-muted">
            About <span className="tnum font-semibold text-ink">{money(estimate)}</span>. Cut to
            order, so the final weight decides the price.
          </p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          addLine({
            productId,
            slug,
            name,
            requestedG: grams,
            prepOptionId: prepId,
            prepLabel: preps.find((p) => p.id === prepId)?.label ?? null,
          });
          setAdded(true);
          router.refresh();
        }}
        className="tap-lg mt-8 w-full rounded-sm bg-accent px-4 text-lead font-semibold text-accent-ink transition-colors hover:bg-accent-hover active:scale-[0.99]"
      >
        Add to basket
      </button>

      {added ? (
        <p role="status" className="mt-3 text-body text-muted">
          Added. <a href="/basket" className="text-ink underline underline-offset-4">Go to basket</a>
        </p>
      ) : null}
    </div>
  );
}
