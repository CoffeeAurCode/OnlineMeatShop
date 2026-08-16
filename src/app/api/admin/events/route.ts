import { NextResponse } from 'next/server';

import { ordersArrivedSince } from '@/db/repositories/orders';
import { readSettings } from '@/db/repositories/settings';

import { guardedRead } from '../_guard';

/**
 * "Has anything arrived since I last looked?"
 *
 * The console polls this while it is open. It is the entire mechanism behind
 * the new-order alarm.
 *
 * ══ WHY A POLL, WHEN THE ASK WAS "IN REAL TIME" ═══════════════════════════
 *
 * ⭐ A TEN-SECOND POLL *IS* REAL TIME FOR A SHOP THAT TAKES 2-6 ORDERS A DAY.
 * The honest comparison is not "instant vs ten seconds", it is "ten seconds vs
 * a second authorisation system on the table holding customers' home
 * addresses". Supabase Realtime was cut at launch (D18); re-adding it means
 * exposing `order` to the anon key behind RLS policies, and getting one of
 * those policies wrong publishes the shop's order book. This endpoint sits
 * behind the staff cookie that already exists and can leak nothing the console
 * could not already read.
 *
 * ⚠ THE CURSOR COMES FROM THE CLIENT AND THAT IS SAFE HERE. The worst a
 * tampered `since` can do is make the caller's OWN console announce orders it
 * has already seen. It cannot reach an order the staff session could not
 * fetch from the queue screen anyway.
 *
 * ⚠ NO `Cache-Control` MISTAKES. `force-dynamic` plus an explicit no-store: a
 * cached answer here is an alarm that does not ring, and `CLAUDE.md` is
 * explicit that console data is never cached.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return guardedRead(async () => {
    const url = new URL(request.url);
    const raw = url.searchParams.get('since');
    const parsed = raw === null ? Number.NaN : Number(raw);

    /*
     * A missing or unparseable cursor means "starting now", NOT "since the
     * beginning of time". A console that opens and immediately announces every
     * order the shop has ever taken is worse than one that says nothing.
     */
    const now = Date.now();
    const since = Number.isFinite(parsed) && parsed > 0 && parsed <= now ? parsed : now;

    const [orders, settings] = await Promise.all([ordersArrivedSince(since), readSettings()]);

    const response = NextResponse.json({
      /** Echoed back so the client advances its cursor from the SERVER's clock. */
      now,
      orders,
      /**
       * Sent with every poll rather than read once at page load, so changing
       * the alarm in one tab takes effect in the other within ten seconds —
       * without either of them being reloaded.
       */
      sound: settings['console.newOrderSound'],
      message: settings['console.newOrderMessage'],
      pollSeconds: settings['console.pollSeconds'],
      repeatUntilSeen: settings['console.repeatUntilSeen'],
    });

    response.headers.set('cache-control', 'no-store, must-revalidate');
    return response;
  });
}
