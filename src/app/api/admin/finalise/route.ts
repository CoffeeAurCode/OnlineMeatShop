import { NextResponse } from 'next/server';
import { z } from 'zod';

import { finaliseOrder } from '@/db/repositories/payments';

import { guarded } from '../_guard';

/**
 * Work out the exact total.
 *
 * 🔴 THE CAPTURE IS NOT DONE HERE, AND NOT ONLY BECAUSE STRIPE IS NOT WIRED UP
 * YET. `finaliseOrder` computes the final amount, marks the order WEIGHED and
 * returns the idempotency key the capture must use, all inside one
 * transaction. The Stripe call belongs strictly after that transaction
 * commits: you get exactly ONE capture per authorisation, and a capture that
 * succeeded inside a transaction which then rolled back is money taken for an
 * order that does not exist in that state.
 *
 * Until the payments adapter exists this route stops at the amount and reports
 * `capturePending`. The order is correct; the money has not moved.
 */
const schema = z.object({ orderId: z.uuid() });

export async function POST(request: Request) {
  return guarded(request, schema, async ({ orderId }) => {
    const result = await finaliseOrder(orderId);

    if (!result.ok) {
      return NextResponse.json({ reason: result.reason, unweighed: result.unweighed }, { status: 409 });
    }

    return NextResponse.json({
      ok: true,
      finalTotalCents: result.finalTotalCents,
      captureCents: result.captureCents,
      capturePending: true,
    });
  });
}
