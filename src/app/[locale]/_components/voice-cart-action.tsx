'use client';

import { useEffect } from 'react';
import { CheckCircleIcon, InfoIcon, WarningCircleIcon } from '@phosphor-icons/react/dist/ssr';

import { addLine, useCart, type CartLine } from '@/ui/cart';

import { openCart } from './drawer-state';

export type VoiceCartOutcome =
  | {
      readonly kind: 'add';
      readonly line: CartLine;
      readonly message: string;
    }
  | {
      readonly kind: 'message';
      readonly tone: 'info' | 'error';
      readonly message: string;
    };

/**
 * Executes a server-validated voice add exactly once. Waiting for `cart.ready`
 * is essential: adding before localStorage hydrates would replace an existing
 * basket with the spoken line.
 */
export function VoiceCartAction({
  actionId,
  outcome,
}: {
  actionId: string;
  outcome: VoiceCartOutcome;
}) {
  const cart = useCart();

  useEffect(() => {
    if (!cart.ready || outcome.kind !== 'add') return;

    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get('voice') !== actionId) return;

    const storageKey = `voice-cart:${actionId}`;
    const voiceWindow = window as typeof window & { __pendingVoiceCartActions?: Set<string> };
    let pending = voiceWindow.__pendingVoiceCartActions?.delete(actionId) ?? false;
    try {
      pending ||= window.sessionStorage.getItem(storageKey) === 'pending';
      if (!pending) return;
      // Mark first. In React Strict Mode the effect is deliberately replayed,
      // and a cart addition is not an idempotent operation.
      window.sessionStorage.setItem(storageKey, 'done');
    } catch {
      // The in-memory marker remains sufficient during client navigation.
    }
    if (!pending) return;

    addLine(outcome.line);
    openCart();

    currentUrl.searchParams.delete('voice');
    currentUrl.searchParams.delete('voiceQuantity');
    window.history.replaceState(window.history.state, '', currentUrl);
  }, [actionId, cart.ready, outcome]);

  const error = outcome.kind === 'message' && outcome.tone === 'error';
  const Icon = outcome.kind === 'add' ? CheckCircleIcon : error ? WarningCircleIcon : InfoIcon;

  return (
    <div
      role={error ? 'alert' : 'status'}
      aria-live="polite"
      className={`mt-6 flex max-w-[42rem] items-start gap-3 rounded-sm border px-4 py-3 text-body ${
        error
          ? 'border-danger/30 bg-danger/5 text-ink'
          : 'border-line bg-raised text-ink elev-card'
      }`}
    >
      <Icon
        size={20}
        weight={outcome.kind === 'add' ? 'fill' : 'regular'}
        aria-hidden
        className={error ? 'mt-0.5 shrink-0 text-danger' : 'mt-0.5 shrink-0 text-accent'}
      />
      <p>{outcome.message}</p>
    </div>
  );
}
