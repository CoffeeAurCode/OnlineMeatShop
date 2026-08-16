'use client';

import { useSyncExternalStore } from 'react';

/**
 * Which overlay is open: the basket drawer, or the address sheet.
 *
 * A four-line external store rather than context, for the same reason
 * `src/ui/cart.tsx` is one: the header button and the drawer are in different
 * subtrees under a Server Component layout, and a provider wrapping both would
 * force the whole storefront to become a Client Component.
 *
 * Deliberately NOT merged into `cart.tsx` or `location.ts`. Those stores are
 * persisted to `localStorage` and hold what the customer intends to buy and
 * where they want it; this is ephemeral view state. Putting them together
 * would persist "the drawer was open" across reloads, which nobody wants.
 *
 * ⚠ THE OVERLAYS ARE MUTUALLY EXCLUSIVE, enforced here rather than left to
 * each caller. They are all fixed, all dialogs, and all trap focus; two open
 * at once is two focus traps fighting, and the customer cannot leave either.
 * Opening one closes the others.
 *
 * ⭐ THE SIGN-IN SHEET IS IN THIS SET FOR A REASON THAT ONLY SHOWS UP AT
 * CHECKOUT. Pressing "Place order" while signed out opens it, and it opens
 * OVER a checkout page — so it has to close the cart drawer if that is what
 * the customer came from, and it must not be openable alongside the address
 * sheet, which is the other thing checkout can raise.
 */

type Overlay = 'cart' | 'location' | 'signin' | null;

let overlay: Overlay = null;
const listeners = new Set<() => void>();

function show(next: Overlay): void {
  if (overlay === next) return;
  overlay = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function openCart(): void {
  show('cart');
}

export function closeCart(): void {
  if (overlay === 'cart') show(null);
}

export function openLocationSheet(): void {
  show('location');
}

export function closeLocationSheet(): void {
  if (overlay === 'location') show(null);
}

export function useCartOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => overlay === 'cart',
    // The server never has an open overlay, so the HTML and the hydration pass
    // agree and there is no flash.
    () => false,
  );
}

export function openSignIn(): void {
  show('signin');
}

export function closeSignIn(): void {
  if (overlay === 'signin') show(null);
}

export function useSignInOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => overlay === 'signin',
    () => false,
  );
}

export function useLocationSheetOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => overlay === 'location',
    () => false,
  );
}
