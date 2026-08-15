'use client';

import { useSyncExternalStore } from 'react';

/**
 * Saved products.
 *
 * The heart on a store card is the one piece of delivery-app furniture that is
 * usually decoration, and here it is not: this shop's catalog changes every
 * trading morning, and a regular who buys the same two fish every week is the
 * shop's actual business. `/[locale]/shop?saved=1` is a one-tap route back to
 * them.
 *
 * ⚠ NO ACCOUNT, AND NO SERVER. A set of product ids in `localStorage`. There
 * is no customer login on this storefront — order tracking is a token in a
 * URL, deliberately — so a server-side favourites list would need one built to
 * carry it, which is a login for a heart icon. It stays on the device, and it
 * costs nothing if the device is lost.
 *
 * Same external-store shape as `cart.tsx` and `location.ts`, for the same
 * hydration reason: the server cannot know this value, so it must render the
 * empty one and let the real one arrive in the commit after mount.
 */

const STORAGE_KEY = 'favourites.v1';

const EMPTY: ReadonlySet<string> = new Set();

let snapshot: ReadonlySet<string> = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return;
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return;
    snapshot = new Set(data.filter((x): x is string => typeof x === 'string'));
  } catch {
    // Private browsing or a corrupt value. An empty set is harmless.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  hydrate();
  return () => {
    listeners.delete(listener);
  };
}

export function useFavourites(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
}

export function isFavourite(set: ReadonlySet<string>, productId: string): boolean {
  return set.has(productId);
}

export function toggleFavourite(productId: string): void {
  const next = new Set(snapshot);
  if (!next.delete(productId)) next.add(productId);
  snapshot = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // Quota or blocked. It still works for this page view.
  }
  for (const l of listeners) l();
}
