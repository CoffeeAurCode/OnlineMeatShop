'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { OrderStatus } from '@/domain/types';
import { weight } from '@/ui/format';

import { PrimaryBar, PrimaryButton, SecondaryButton } from './shell';

/**
 * ⭐ Record one weight.
 *
 * The rules this screen exists to honour, all from `04-PLAN` §4 and §11:
 *
 * - The entered weight is the largest thing on the screen. It is read at arm's
 *   length, at a scale, in a cold room.
 * - The tolerance band is a PLAIN SENTENCE, live, before the weight is
 *   committed. Not a filled progress track: a bar with a coloured fill invites
 *   the reading "somewhere in the green is fine", and the band is not a
 *   rounding allowance, it is the boundary between the cut they ordered and a
 *   different purchase.
 * - Out-of-band approval is a SECOND FULL-WIDTH BUTTON THAT APPEARS IN PLACE.
 *   Never a dialog. §4 forbids anything needing two hands, and a modal with a
 *   small confirm in its corner needs two hands.
 * - Nothing is clamped. An out-of-band weight is refused until a human says
 *   yes, because the butcher cannot unilaterally decide the customer is buying
 *   thirty percent more meat.
 */
export function WeighForm({
  orderId,
  lineId,
  requestedG,
  band,
  alreadyWeighedG,
  orderStatus,
}: {
  orderId: string;
  lineId: string;
  requestedG: number;
  band: { lowerG: number; upperG: number };
  alreadyWeighedG: number | null;
  orderStatus: OrderStatus;
}) {
  const router = useRouter();
  const [raw, setRaw] = useState(alreadyWeighedG === null ? '' : String(alreadyWeighedG));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsApproval, setNeedsApproval] = useState(false);

  // GRAMS, not kilograms, and integers only.
  //
  // The scale in the shop reads grams, and asking someone to convert what is
  // displayed in front of them into another unit before typing it is how a
  // 1200 g cut gets entered as 1200 kg. Whole grams also mean there is no
  // decimal separator to get wrong on a French Canadian keyboard.
  const enteredG = /^\d{1,6}$/.test(raw.trim()) ? Number(raw.trim()) : null;

  const outOfBand =
    enteredG !== null && (enteredG < band.lowerG || enteredG > band.upperG);

  async function submit(approveVariance: boolean) {
    if (enteredG === null) {
      setError('Enter the weight in grams.');
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/weigh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId, lineId, weighedG: enteredG, approveVariance }),
      });
      const body: unknown = await res.json();

      if (!res.ok) {
        const reason =
          typeof body === 'object' && body !== null && 'reason' in body
            ? String((body as { reason: unknown }).reason)
            : '';

        if (reason === 'varianceApprovalRequired') {
          // The refusal is the design, not a failure. Surface the approval
          // in place and let the owner go and ask the customer.
          setNeedsApproval(true);
          setBusy(false);
          return;
        }
        setError(messageFor(reason));
        setBusy(false);
        return;
      }

      router.push(`/admin/orders/${orderId}`);
      router.refresh();
    } catch {
      setError('That did not save. Check the connection and try again.');
      setBusy(false);
    }
  }

  if (orderStatus !== 'PREPARING') {
    return (
      <p className="mt-8 rounded-md border border-line bg-raised px-4 py-8 text-body text-muted">
        This order is {orderStatus.toLowerCase()}, so weights can no longer be recorded against it.
        Weighing is only possible while an order is being prepared.
      </p>
    );
  }

  return (
    <>
      <p className="mt-2 text-body text-muted">Ordered {weight(requestedG)}</p>

      <label htmlFor="weighed" className="mt-8 block text-body font-semibold">
        Weight on the scale
      </label>
      <div className="mt-2 flex items-center gap-3">
        <input
          id="weighed"
          inputMode="decimal"
          type="text"
          autoComplete="off"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setNeedsApproval(false);
            setError(null);
          }}
          aria-describedby="band"
          className="tap-lg w-full rounded-sm border border-line bg-raised px-4 text-right font-mono text-scale leading-none"
        />
        <span className="text-section text-muted">g</span>
      </div>

      <p id="band" className="mt-3 text-body text-muted">
        Anything from <span className="tnum">{band.lowerG}</span> g to{' '}
        <span className="tnum">{band.upperG}</span> g is the cut they ordered.
      </p>

      {outOfBand ? (
        <p className="mt-3 rounded-sm bg-hot-wash px-3 py-3 text-body text-hot">
          {weight(enteredG ?? 0)} is outside that. The customer has to agree before this can be
          charged.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-sm bg-danger-wash px-3 py-3 text-body text-danger">
          {error}
        </p>
      ) : null}

      <PrimaryBar>
        {needsApproval ? (
          <div className="grid gap-2">
            <p className="text-meta text-muted">
              Call the customer and get their yes before you tap this.
            </p>
            <PrimaryButton onClick={() => void submit(true)} disabled={busy}>
              {busy ? 'Saving' : 'They agreed, record it'}
            </PrimaryButton>
            <SecondaryButton onClick={() => setNeedsApproval(false)} disabled={busy}>
              Change the weight
            </SecondaryButton>
          </div>
        ) : (
          <PrimaryButton onClick={() => void submit(false)} disabled={busy || enteredG === null}>
            {busy ? 'Saving' : 'Record weight'}
          </PrimaryButton>
        )}
      </PrimaryBar>
    </>
  );
}

function messageFor(reason: string): string {
  switch (reason) {
    case 'orderNotInPreparation':
      return 'This order is no longer being prepared, so a weight cannot be recorded against it.';
    case 'packLineNotWeighable':
      return 'This is a fixed-price pack. Its price does not change with weight, so there is nothing to weigh.';
    case 'lineNotFound':
      return 'That item is no longer on this order. Go back and reload.';
    default:
      return 'That did not save. Nothing has changed.';
  }
}
