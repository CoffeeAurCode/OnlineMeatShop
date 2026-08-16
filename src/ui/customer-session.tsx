'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Who is signed in, in the browser.
 *
 * ⚠ THIS HOLDS NO CREDENTIAL AND MUST NEVER HOLD ONE.
 *
 * The credential is an `httpOnly` cookie the browser sends automatically and
 * JavaScript cannot read. What lives here is a CACHE of the answer to "am I
 * signed in", refreshed from `/api/session/customer`, so that the header and
 * the checkout button can render without waiting for a round trip on every
 * paint.
 *
 * The consequence worth stating: this state going stale is a cosmetic bug, not
 * a security one. A tampered value here buys nothing, because every endpoint
 * re-reads the signed cookie server-side and none of them trusts the client's
 * opinion of who it is.
 *
 * ⭐ NOT PERSISTED TO `localStorage`, deliberately, unlike the cart and the
 * delivery address. Those are the customer's own drafts; this is a claim about
 * identity, and a claim about identity restored from disk outlives the cookie
 * that justified it. Signing out on one tab would leave another tab saying
 * "signed in" until it happened to reload.
 */

export interface HistoryOrder {
  readonly publicToken: string;
  readonly status: string;
  readonly placedAtMs: number;
  readonly estTotalCents: number;
  readonly finalTotalCents: number | null;
}

interface SessionState {
  /** `null` while the first fetch is in flight — distinct from "signed out". */
  readonly phone: string | null | undefined;
  readonly orders: readonly HistoryOrder[];
  readonly loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Called by the sheet when a verification succeeds. */
  adopt: (phone: string, orders: readonly HistoryOrder[]) => void;
}

const Ctx = createContext<SessionState | null>(null);

interface SessionAnswer {
  signedIn: boolean;
  phone?: string;
  orders?: HistoryOrder[];
}

/** Pure I/O. Returns null when the request could not be made at all. */
async function loadSession(): Promise<SessionAnswer | null> {
  try {
    const res = await fetch('/api/session/customer', { cache: 'no-store' });
    return (await res.json()) as SessionAnswer;
  } catch {
    return null;
  }
}

export function CustomerSessionProvider({ children }: { children: React.ReactNode }) {
  const [phone, setPhone] = useState<string | null | undefined>(undefined);
  const [orders, setOrders] = useState<readonly HistoryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  /*
   * Guards against a refresh landing after the component unmounted, which is
   * the ordinary React warning, and against an in-flight refresh overwriting a
   * fresher `adopt` — the sign-in sheet calls `adopt` the instant verification
   * succeeds, and a slower `GET` started before it must not undo that.
   */
  const generation = useRef(0);

  /*
   * ⭐ THE FETCH AND THE setState ARE SEPARATE FUNCTIONS, AND THAT SPLIT IS
   * FORCED BY A REAL RULE RATHER THAN BY TASTE.
   *
   * `react-hooks/set-state-in-effect` refuses a setState reachable
   * synchronously from an effect body — including through a helper the effect
   * calls. The fix is not to silence it: the rule is pointing at a genuine
   * shape, which is that an effect should either push state OUT to an external
   * system or SUBSCRIBE and set state from a callback. So `loadSession` is
   * pure I/O that returns data, `apply` is the callback that stores it, and
   * the effect wires the two together with `.then`.
   *
   * ⚠ `loading` STARTS TRUE AND IS ONLY EVER TURNED OFF. It exists to
   * distinguish "we have not asked yet" from "signed out" — a question only
   * the first answer resolves. A later refresh flipping it back on would make
   * the header flash to a spinner every time anything called it.
   */
  const apply = useCallback((result: SessionAnswer | null, generationAtStart: number) => {
    if (generationAtStart !== generation.current) return;
    if (result === null) {
      // A network failure is NOT "signed out". Claiming it is would throw the
      // customer back to a sign-in sheet every time a tunnel drops.
      setPhone((current) => (current === undefined ? null : current));
    } else {
      setPhone(result.signedIn ? (result.phone ?? null) : null);
      setOrders(result.orders ?? []);
    }
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    apply(await loadSession(), mine);
  }, [apply]);

  useEffect(() => {
    const mine = ++generation.current;
    void loadSession().then((result) => apply(result, mine));
  }, [apply]);

  const signOut = useCallback(async () => {
    generation.current += 1;
    setPhone(null);
    setOrders([]);
    await fetch('/api/session/customer', { method: 'DELETE' });
  }, []);

  const adopt = useCallback((next: string, nextOrders: readonly HistoryOrder[]) => {
    generation.current += 1;
    setPhone(next);
    setOrders(nextOrders);
    setLoading(false);
  }, []);

  const value = useMemo<SessionState>(
    () => ({ phone, orders, loading, refresh, signOut, adopt }),
    [phone, orders, loading, refresh, signOut, adopt],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCustomerSession(): SessionState {
  const value = useContext(Ctx);
  if (value === null) {
    throw new Error('useCustomerSession outside CustomerSessionProvider');
  }
  return value;
}
