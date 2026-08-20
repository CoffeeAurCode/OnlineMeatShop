'use client';

import { useId, useState } from 'react';
import { MinusIcon, PlusIcon } from '@phosphor-icons/react/dist/ssr';

import type { Locale } from '@/i18n';
import { t } from '@/i18n';
import { weightFromEntry } from '@/ui/weight-entry';

/**
 * The two steppers.
 *
 * ⚠ THEY DO NOT DECIDE ANYTHING. A stepper changes a number of grams or a
 * count; the server prices it. Nothing here multiplies a rate by a weight,
 * because the moment a component does that there are two implementations of
 * the price and they diverge on the day one of them is edited.
 *
 * `type="button"` on both, always. Inside a form, the default `submit` turns
 * "add 250 g" into "place the order", and it does it silently.
 */

function StepButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      // 44px minimum on both axes. This is a wet-handed, one-thumbed control
      // and the WCAG target-size floor is not a suggestion here.
      className="grid size-11 shrink-0 place-items-center rounded-sm border border-line bg-raised text-ink transition-[transform,background-color,border-color] duration-(--duration-fast) ease-brand hover:border-accent disabled:pointer-events-none disabled:opacity-40 active:scale-[0.94]"
    >
      {children}
    </button>
  );
}

/**
 * Grams, for a per-kg product. Clamped to the product's own minimum and step,
 * which come from the catalog and are the same values `isLegalQuantity`
 * enforces server-side.
 */
export function WeightStepper({
  grams,
  minG,
  stepG,
  maxG,
  onChange,
  onValidityChange,
  locale,
}: {
  grams: number;
  minG: number;
  stepG: number;
  maxG: number | null;
  onChange: (g: number) => void;
  onValidityChange?: (valid: boolean) => void;
  locale: Locale;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [draft, setDraft] = useState(String(grams));
  const [valid, setValid] = useState(true);

  // A null ceiling means the shop has not declared stock today, which is not
  // the same as zero. The stepper stays usable; placement is what refuses.
  const atMax = maxG !== null && grams + stepG > maxG;

  function commit(next: number): void {
    setDraft(String(next));
    setValid(true);
    onValidityChange?.(true);
    onChange(next);
  }

  function typeWeight(raw: string): void {
    setDraft(raw);
    const next = weightFromEntry(raw, minG, stepG, maxG);
    const nextValid = next !== null;
    setValid(nextValid);
    onValidityChange?.(nextValid);
    if (next !== null) onChange(next);
  }

  return (
    <div className="grid justify-items-center gap-1.5">
      <div className="flex items-center gap-3">
        <StepButton
          onClick={() => commit(Math.max(minG, grams - stepG))}
          disabled={grams <= minG}
          label={t(locale, 'product.decrease')}
        >
          <MinusIcon size={18} weight="bold" aria-hidden />
        </StepButton>

        <label htmlFor={inputId} className="relative flex min-w-[6.5rem] items-center">
          <span className="sr-only">{t(locale, 'product.weightInput')}</span>
          <input
            id={inputId}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={draft}
            onChange={(event) => typeWeight(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            aria-invalid={!valid}
            aria-describedby={!valid ? errorId : undefined}
            className={`tap tnum w-full rounded-sm border bg-raised px-3 pr-7 text-center text-lead font-semibold text-ink ${
              valid ? 'border-line' : 'border-danger'
            }`}
          />
          <span aria-hidden className="pointer-events-none absolute right-3 text-meta text-muted">
            g
          </span>
        </label>

        <StepButton onClick={() => commit(grams + stepG)} disabled={atMax} label={t(locale, 'product.increase')}>
          <PlusIcon size={18} weight="bold" aria-hidden />
        </StepButton>
      </div>

      {!valid && (
        <p id={errorId} role="alert" className="max-w-[24rem] text-center text-meta text-danger">
          {maxG === null
            ? t(locale, 'product.weightEntryRuleNoMax', {
                min: minG,
                step: stepG,
              })
            : t(locale, 'product.weightEntryRule', {
                min: minG,
                max: maxG,
                step: stepG,
              })}
        </p>
      )}
    </div>
  );
}

/**
 * Whole units, for a pack product.
 *
 * A pack basket line is still stored in GRAMS, because that is the unit the
 * domain and the stock table speak. The count is presentational and is
 * converted at the edge, which keeps a single quantity unit in the system
 * rather than two that have to agree.
 */
export function QtyStepper({
  qty,
  max,
  onChange,
  locale,
}: {
  qty: number;
  max: number | null;
  onChange: (n: number) => void;
  locale: Locale;
}) {
  return (
    <div className="flex items-center gap-3">
      <StepButton
        onClick={() => onChange(Math.max(1, qty - 1))}
        disabled={qty <= 1}
        label={t(locale, 'product.decrease')}
      >
        <MinusIcon size={18} weight="bold" aria-hidden />
      </StepButton>
      <output className="tnum min-w-[3rem] text-center text-lead font-semibold">{qty}</output>
      <StepButton
        onClick={() => onChange(qty + 1)}
        disabled={max !== null && qty >= max}
        label={t(locale, 'product.increase')}
      >
        <PlusIcon size={18} weight="bold" aria-hidden />
      </StepButton>
    </div>
  );
}
