'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { PayMode } from '@/domain/types';
import { ADMIN_LOCALE, gramsFromKgInput, money } from '@/ui/format';

import { PrimaryBar, PrimaryButton, SecondaryButton } from '../../(admin)/admin/_components/shell';

/**
 * The button that closes a job, and the one that reports a cash problem.
 *
 * ══ THE SHAPE OF THIS SCREEN IS THE WHOLE DESIGN ══════════════════════════
 *
 * ⭐ THE COMMON CASE IS ONE TAP, AND IT NAMES THE AMOUNT.
 *
 * "Collected $46.20 — Delivered" rather than a text field the driver fills in.
 * A field invites typing at a doorstep in the rain and its most likely output
 * is a typo that either closes the order on a wrong figure or refuses to close
 * it on a right one. The exact amount is already known; asking the driver to
 * re-key it adds risk and buys nothing.
 *
 * The second button exists for the case the first one cannot express, and it
 * is deliberately the SMALLER, PLAINER one — an unusual outcome should look
 * unusual, and the driver should have to mean it.
 *
 * ⚠ A MISMATCH IS REPORTED, NOT REFUSED. The food is at the door and the money
 * is in somebody's pocket; the report is the only record that will ever exist.
 * The order stays open, the shop sees it in red, and nobody has to argue with
 * a phone on a driveway. See `reportDelivery` for why the order does not close.
 */
export function DeliverForm({
  orderId,
  payMode,
  dueCents,
  alreadyReportedCents,
}: {
  orderId: string;
  payMode: PayMode;
  dueCents: number | null;
  alreadyReportedCents: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [amount, setAmount] = useState('');

  const isCash = payMode === 'COD';

  /*
   * ⚠ THE ORDER CANNOT BE CLOSED BEFORE THE SHOP HAS WEIGHED IT, and on a cash
   * order that is visible rather than merely refused by the server: there is no
   * amount to collect yet, so there is nothing honest to put on the button.
   */
  if (isCash && dueCents === null) {
    return (
      <PrimaryBar>
        <p className="py-3 text-center text-body text-muted">
          The shop has not finished weighing this order, so there is no amount to collect yet.
        </p>
      </PrimaryBar>
    );
  }

  async function report(collectedCents: number | null) {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/driver/delivered', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId, cashCollectedCents: collectedCents }),
      });
      const body = (await res.json()) as { reason?: string; outcome?: string };

      if (!res.ok) {
        setError(
          body.reason === 'notOut'
            ? 'The shop has not handed this one over yet, or it is already done.'
            : body.reason === 'notFound'
              ? 'This job is not on your list any more.'
              : 'That did not save. Nothing has changed.',
        );
        setBusy(false);
        router.refresh();
        return;
      }

      // Whether it closed or was flagged, the page re-reads the truth from the
      // server rather than this component guessing what changed.
      router.refresh();
      setBusy(false);
      setCorrecting(false);
    } catch {
      setError('That did not save. Check the connection and try again.');
      setBusy(false);
    }
  }

  if (correcting) {
    /*
     * ⚠ `gramsFromKgInput` IS REUSED FOR MONEY ON PURPOSE, and the name is now
     * a lie worth explaining rather than a second parser worth writing. It
     * parses "one decimal quantity typed by a human" — accepting a comma for a
     * decimal mark, which a French-Canadian keyboard produces — and returns
     * thousandths as an integer. Dollars to cents is the same conversion at a
     * different scale, so `⌊thousandths / 10⌋` is the cents.
     *
     * Integer arithmetic throughout. No float ever holds this value.
     */
    const parsed = gramsFromKgInput(amount);
    const cents = parsed === null ? null : Math.trunc(parsed / 10);

    return (
      <PrimaryBar>
        <div className="grid gap-3">
          <label htmlFor="collected" className="text-body font-semibold">
            How much did you actually collect?
          </label>
          <input
            id="collected"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={dueCents === null ? '0.00' : (dueCents / 100).toFixed(2)}
            className="tnum tap-lg rounded-sm border border-line bg-raised px-3 text-lead text-ink"
          />

          {error !== null && (
            <p role="alert" className="rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
              {error}
            </p>
          )}

          <PrimaryButton
            type="button"
            disabled={busy || cents === null}
            onClick={() => cents !== null && report(cents)}
          >
            {busy ? 'Sending' : 'Tell the shop'}
          </PrimaryButton>
          <SecondaryButton type="button" disabled={busy} onClick={() => setCorrecting(false)}>
            Back
          </SecondaryButton>
        </div>
      </PrimaryBar>
    );
  }

  return (
    <PrimaryBar>
      <div className="grid gap-3">
        {error !== null && (
          <p role="alert" className="rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
            {error}
          </p>
        )}

        {alreadyReportedCents !== null && (
          <p className="text-center text-meta text-muted">
            Already reported. Sending again replaces what the shop was told.
          </p>
        )}

        <PrimaryButton
          type="button"
          disabled={busy}
          onClick={() => report(isCash ? dueCents : null)}
        >
          {busy
            ? 'Saving'
            : isCash && dueCents !== null
              ? `Collected ${money(dueCents, ADMIN_LOCALE)} — Delivered`
              : 'Delivered'}
        </PrimaryButton>

        {isCash && (
          <SecondaryButton type="button" disabled={busy} onClick={() => setCorrecting(true)}>
            The amount was different
          </SecondaryButton>
        )}
      </div>
    </PrimaryBar>
  );
}
