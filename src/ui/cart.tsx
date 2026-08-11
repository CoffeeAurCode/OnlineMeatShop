'use client';

import { useSyncExternalStore } from 'react';

/**
 * The basket.
 *
 * ⭐ IT HOLDS INTENT, NOT PRICES. A line is a product, a weight and a cut
 * preference, and nothing else. Every amount the customer ever sees is
 * computed by the server from the catalog, because a price that round-trips
 * through the browser is a price the browser can edit.
 *
 * That is less about a hostile user than about the only arrangement in which
 * the number on the screen and the number in the order cannot drift: the
 * catalog moves, and a basket carrying a stale copy of it would quietly show
 * yesterday's price until checkout corrected it.
 *
 * FR-4 is why lines are keyed by product AND prep option rather than product
 * alone: "1 kg curry cut" and "1 kg biryani cut" are one product on two lines,
 * and merging them would be wrong at the counter even though the stock
 * arithmetic aggregates them.
 *
 * ── WHY THIS IS AN EXTERNAL STORE AND NOT `useState` + `useEffect` ─────────
 *
 * `localStorage` is exactly what `useSyncExternalStore` is for: a value that
 * lives outside React, is unavailable during the server render, and must not
 * differ between the server's HTML and the client's first render. Reading it
 * in an effect and calling `setState` is the obvious shape, and React 19's
 * lint rejects it for good reason: it renders once with an empty basket and
 * then again with the real one, which is a visible flash on the page where a
 * customer is least willing to see their order disappear.
 *
 * `getServerSnapshot` returns the empty basket, so the HTML and the hydration
 * pass agree; the real value arrives in the commit that follows.
 */

export interface CartLine {
  readonly productId: string;
  readonly slug: string;
  readonly name: string;
  readonly requestedG: number;
  readonly prepOptionId: string | null;
  readonly prepLabel: string | null;
}

export interface CartSnapshot {
  readonly lines: readonly CartLine[];
  /**
   * False until storage has been read. It distinguishes "the basket is empty"
   * from "we do not know yet", and every screen words those differently.
   */
  readonly ready: boolean;
}

const STORAGE_KEY = 'basket.v1';

export function lineKey(l: { productId: string; prepOptionId: string | null }): string {
  return `${l.productId}:${l.prepOptionId ?? ''}`;
}

// The server, and the client's hydration pass, both see this exact object.
// It must be a stable reference or `useSyncExternalStore` loops.
const EMPTY: CartSnapshot = { lines: [], ready: false };

let snapshot: CartSnapshot = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;

  let lines: readonly CartLine[] = [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== null) lines = parse(raw);
  } catch {
    // Private browsing, or a corrupt value. An empty basket is the right
    // failure: recoverable by the customer, and a throw here would take the
    // whole page down.
  }
  snapshot = { lines, ready: true };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // First subscription happens after mount, which is the earliest point
  // `window` is guaranteed. React re-reads the snapshot after subscribing, so
  // the value loaded here is picked up without an extra notification.
  hydrate();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): CartSnapshot {
  return snapshot;
}

function getServerSnapshot(): CartSnapshot {
  return EMPTY;
}

function commit(lines: readonly CartLine[]): void {
  snapshot = { lines, ready: true };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Out of quota or blocked. The basket still works for this page view.
  }
  emit();
}

export function addLine(line: CartLine): void {
  const key = lineKey(line);
  const existing = snapshot.lines.find((l) => lineKey(l) === key);
  commit(
    existing === undefined
      ? [...snapshot.lines, line]
      : snapshot.lines.map((l) =>
          lineKey(l) === key ? { ...l, requestedG: l.requestedG + line.requestedG } : l,
        ),
  );
}

export function setLineWeight(key: string, requestedG: number): void {
  commit(snapshot.lines.map((l) => (lineKey(l) === key ? { ...l, requestedG } : l)));
}

export function removeLine(key: string): void {
  commit(snapshot.lines.filter((l) => lineKey(l) !== key));
}

export function clearCart(): void {
  commit([]);
}

export function useCart(): CartSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Parse stored JSON defensively.
 *
 * The value comes from a previous version of this application, running in a
 * browser that may not have been reloaded for weeks. Anything unrecognised is
 * dropped rather than trusted, and one bad line does not discard the rest.
 */
function parse(raw: string): readonly CartLine[] {
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) return [];

  return data.flatMap((entry): CartLine[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const e = entry as Record<string, unknown>;
    if (
      typeof e.productId !== 'string' ||
      typeof e.slug !== 'string' ||
      typeof e.name !== 'string' ||
      typeof e.requestedG !== 'number' ||
      !Number.isSafeInteger(e.requestedG) ||
      e.requestedG <= 0
    ) {
      return [];
    }
    return [
      {
        productId: e.productId,
        slug: e.slug,
        name: e.name,
        requestedG: e.requestedG,
        prepOptionId: typeof e.prepOptionId === 'string' ? e.prepOptionId : null,
        prepLabel: typeof e.prepLabel === 'string' ? e.prepLabel : null,
      },
    ];
  });
}
