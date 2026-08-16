import { NextResponse } from 'next/server';
import { z } from 'zod';

import { cancelOrder } from '@/db/repositories/placement';

import { guarded } from '../_guard';

/**
 * Cancel an order from the console.
 *
 * ⭐ THE DOMAIN OPERATION ALREADY EXISTED AND WAS REACHABLE FROM NO SCREEN.
 * `cancelOrder` has been in `placement.ts` since increment 4, used only by the
 * checkout route when an authorisation fails. So the shop could cancel an
 * order it never took, and could not cancel one it had.
 *
 * ⚠ THIS IS NOT A STATUS CHANGE AND MUST NOT BECOME ONE. Cancelling RETURNS
 * STOCK AND UNBOOKS THE SLOT, inside one transaction, aggregated across lines.
 * Routing it through `/api/admin/status` with `to: 'CANCELLED'` would move the
 * status and leave the fish reserved against a day nobody is buying it on —
 * and the shop would find out when it did not sell.
 *
 * Refused after PLACED, by the domain (spec §5.7): once the butcher starts
 * cutting, the meat is committed. The route surfaces that as
 * `alreadyInPreparation` rather than swallowing it, because the owner's next
 * move is a phone call, not another tap.
 */

const schema = z.object({
  orderId: z.uuid(),
});

export async function POST(request: Request) {
  return guarded(request, schema, async ({ orderId }) => {
    const result = await cancelOrder(orderId);
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ reason: result.reason }, { status: result.reason === 'notFound' ? 404 : 409 });
  });
}
