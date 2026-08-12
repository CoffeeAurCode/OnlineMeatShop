'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ADMIN_LOCALE, gramsFromKgInput, kgInputFromGrams, weight } from '@/ui/format';

import { PrimaryBar, PrimaryButton } from './shell';

export interface StockLine {
  readonly productId: string;
  readonly name: string;
  readonly stockedG: number | null;
  readonly reservedG: number | null;
}

/**
 * ⭐ THE 6AM SCREEN.
 *
 * The owner works down a list of products entering what is physically on the
 * counter, one-handed, in a cold room, before the shop opens. Everything here
 * follows from that:
 *
 * - `inputmode="decimal"` on a TEXT input, never `type="number"`. Number
 *   inputs render spinner arrows that are unhittable at speed, silently change
 *   value when a stray scroll passes over them, and reject a comma decimal
 *   separator that a French Canadian keyboard produces by default.
 * - Kilograms in, grams stored, converted without ever creating a float.
 * - One submit for the whole list. Twenty separate saves is twenty chances to
 *   be interrupted halfway.
 * - No autofocus. Focusing the first field raises the keyboard over the list
 *   before the owner has seen what is on it.
 */
export function StockForm({
  lines,
  endpoint,
  submitLabel,
  businessDate,
}: {
  lines: readonly StockLine[];
  endpoint: string;
  submitLabel: string;
  businessDate?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lines.map((l) => [l.productId, l.stockedG === null ? '' : kgInputFromGrams(l.stockedG)]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit() {
    setBusy(true);
    setError(null);

    const declared: Record<string, number> = {};
    const bad: Record<string, string> = {};

    for (const line of lines) {
      const raw = values[line.productId] ?? '';
      if (raw.trim() === '') continue; // Not declared is not the same as zero.
      const g = gramsFromKgInput(raw);
      if (g === null) {
        bad[line.productId] = 'Enter kilograms, like 12 or 12.5';
        continue;
      }
      declared[line.productId] = g;
    }

    if (Object.keys(bad).length > 0) {
      setFieldErrors(bad);
      setBusy(false);
      return;
    }
    setFieldErrors({});

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessDate, declared }),
      });
      const body: unknown = await res.json();
      if (!res.ok) {
        setError(messageFor(body));
        setBusy(false);
        return;
      }
      router.push('/admin');
      router.refresh();
    } catch {
      // Reached when the request never left the phone. The offline bar is
      // already saying why; this says what it means for what they just typed.
      setError('That did not save. Check the connection and try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <ul className="mt-6">
        {lines.map((line) => {
          const fieldError = fieldErrors[line.productId];
          const inputId = `stock-${line.productId}`;
          return (
            <li key={line.productId} className="border-b border-line py-3">
              <div className="flex items-center justify-between gap-4">
                <label htmlFor={inputId} className="text-body">
                  {line.name}
                  {line.reservedG !== null && line.reservedG > 0 ? (
                    <span className="mt-0.5 block text-meta text-muted">
                      {weight(line.reservedG, ADMIN_LOCALE)} already promised to orders
                    </span>
                  ) : null}
                </label>
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    id={inputId}
                    inputMode="decimal"
                    type="text"
                    autoComplete="off"
                    value={values[line.productId] ?? ''}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [line.productId]: e.target.value }))
                    }
                    aria-invalid={fieldError !== undefined}
                    aria-describedby={fieldError ? `${inputId}-error` : undefined}
                    className={`tap w-24 rounded-sm border bg-raised px-3 text-right font-mono text-lead ${
                      fieldError ? 'border-danger' : 'border-line'
                    }`}
                  />
                  <span className="w-6 text-body text-muted">kg</span>
                </div>
              </div>
              {fieldError ? (
                <p id={`${inputId}-error`} className="mt-2 text-meta text-danger">
                  {fieldError}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {error ? (
        <p role="alert" className="mt-4 rounded-sm bg-danger-wash px-3 py-3 text-body text-danger">
          {error}
        </p>
      ) : null}

      <PrimaryBar>
        <PrimaryButton onClick={submit} disabled={busy}>
          {busy ? 'Saving' : submitLabel}
        </PrimaryButton>
      </PrimaryBar>
    </>
  );
}

/** Failure codes are mapped to sentences here; a raw error never reaches the owner. */
function messageFor(body: unknown): string {
  const reason =
    typeof body === 'object' && body !== null && 'reason' in body
      ? String((body as { reason: unknown }).reason)
      : '';

  switch (reason) {
    case 'belowReserved':
      return 'That is less than you have already promised to customers today. Raise it, or cancel an order first.';
    case 'dayNotAfterCurrent':
      return 'A later day is already open. Close it before opening this one.';
    case 'unknownProduct':
      return 'One of those products no longer exists. Reload and try again.';
    case 'invalidDate':
      return 'That date is not valid.';
    case 'negativeQuantity':
      return 'A quantity cannot be negative.';
    case 'noOpenDay':
      return 'No day is open yet. Open the day first.';
    default:
      return 'That did not save. Nothing has changed.';
  }
}
