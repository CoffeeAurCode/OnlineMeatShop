'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { OrderStatus } from '@/domain/types';

import { PrimaryBar, PrimaryButton } from './shell';

/**
 * The order's single next action.
 *
 * One button, never a menu of statuses. The lifecycle is linear and the owner
 * is holding a bag of meat: presenting six statuses and asking them to pick
 * the right one is offering a chance to get it wrong for no benefit.
 *
 * `Finalise` is the exception that gets its own label, because it is the step
 * that computes the exact amount and is the last point at which a wrong weight
 * is still cheap to fix.
 */
export function AdvanceButton({
  orderId,
  status,
  readyToFinalise,
}: {
  orderId: string;
  status: OrderStatus;
  readyToFinalise: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = nextAction(status, readyToFinalise);
  if (next === null) return null;

  async function run() {
    if (next === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(next.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId, from: status, to: next.to }),
      });
      const body: unknown = await res.json();
      if (!res.ok) {
        const reason =
          typeof body === 'object' && body !== null && 'reason' in body
            ? String((body as { reason: unknown }).reason)
            : '';
        setError(
          reason === 'staleStatus'
            ? 'This order already moved on. Refreshing.'
            : reason === 'weighingIncomplete'
              ? 'Something on this order still has no weight.'
              : 'That did not save. Nothing has changed.',
        );
        setBusy(false);
        router.refresh();
        return;
      }
      router.refresh();
      setBusy(false);
    } catch {
      setError('That did not save. Check the connection and try again.');
      setBusy(false);
    }
  }

  return (
    <>
      {error ? (
        <p role="alert" className="mt-4 rounded-sm bg-danger-wash px-3 py-3 text-body text-danger">
          {error}
        </p>
      ) : null}
      <PrimaryBar>
        <PrimaryButton onClick={() => void run()} disabled={busy}>
          {busy ? 'Saving' : next.label}
        </PrimaryButton>
      </PrimaryBar>
    </>
  );
}

function nextAction(
  status: OrderStatus,
  readyToFinalise: boolean,
): { label: string; to: OrderStatus; endpoint: string } | null {
  switch (status) {
    case 'PLACED':
      return { label: 'Start preparing', to: 'PREPARING', endpoint: '/api/admin/status' };
    case 'PREPARING':
      return readyToFinalise
        ? { label: 'Work out the exact total', to: 'WEIGHED', endpoint: '/api/admin/finalise' }
        : null;
    case 'WEIGHED':
      return { label: 'Ready for delivery', to: 'READY', endpoint: '/api/admin/status' };
    case 'READY':
      return { label: 'Out for delivery', to: 'OUT', endpoint: '/api/admin/status' };
    case 'OUT':
      return { label: 'Delivered', to: 'DELIVERED', endpoint: '/api/admin/status' };
    default:
      return null;
  }
}
