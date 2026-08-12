'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether the basket drawer is open.
 *
 * A four-line external store rather than context, for the same reason
 * `src/ui/cart.tsx` is one: the header button and the drawer are in different
 * subtrees under a Server Component layout, and a provider wrapping both would
 * force the whole storefront to become a Client Component.
 *
 * Deliberately NOT merged into `cart.tsx`. That store is persisted to
 * `localStorage` and holds what the customer intends to buy; this is ephemeral
 * view state. Putting them together would persist "the drawer was open" across
 * reloads, which nobody wants.
 */

let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function openCart(): void {
  if (open) return;
  open = true;
  emit();
}

export function closeCart(): void {
  if (!open) return;
  open = false;
  emit();
}

export function useCartOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
    // The server never has an open drawer, so the HTML and the hydration pass
    // agree and there is no flash.
    () => false,
  );
}
