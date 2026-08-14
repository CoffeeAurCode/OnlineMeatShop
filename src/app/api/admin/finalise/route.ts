import { NextResponse } from 'next/server';
import { z } from 'zod';

import { paymentAdapter } from '@/adapters/payments';
import { authIdForOrder, finaliseOrder } from '@/db/repositories/payments';

import { guarded } from '../_guard';

/**
 * Work out the exact total, then take exactly that much.
 *
 * ⭐ THE CAPTURE HAPPENS AFTER THE TRANSACTION COMMITS, NEVER INSIDE IT.
 *
 * `finaliseOrder` computes the final amount, marks the order WEIGHED and
 * returns the idempotency key, all in ONE transaction. The processor call is
 * strictly after that, for a reason that costs real money if it is got wrong:
 * you get exactly ONE capture per authorisation, and a capture that succeeded
 * inside a transaction which then rolled back is money taken for an order that
 * does not exist in that state. There is no way to un-take it.
 *
 * The consequence, stated because it is the honest half: a crash BETWEEN the
 * commit and the capture leaves a WEIGHED order with an uncaptured
 * authorisation. That is the recoverable direction, and it is recoverable
 * precisely because `captureExact` is idempotent on the authorisation, so
 * re-running this route finishes the job rather than charging twice.
 */
const schema = z.object({ orderId: z.uuid() });

export async function POST(request: Request) {
  return guarded(request, schema, async ({ orderId }) => {
    const result = await finaliseOrder(orderId);

    if (!result.ok) {
      return NextResponse.json(
        { reason: result.reason, unweighed: result.unweighed },
        { status: 409 },
      );
    }

    /*
     * Nothing to capture, and WHICH nothing matters.
     *
     * `cod` is correct and final: the order settles at the door and there was
     * never a hold. `noAuthorisation` is a PREPAID order with no hold to draw
     * on, which is a state somebody has to look at. The order is priced
     * correctly either way, so neither is an error status.
     */
    if (result.captureCents === null) {
      return NextResponse.json({
        ok: true,
        finalTotalCents: result.finalTotalCents,
        captured: false,
        reason: result.noCaptureReason,
      });
    }

    const authId = await authIdForOrder(orderId);
    if (authId === null) {
      // Belt and braces: `finaliseOrder` already established that a hold
      // exists, so reaching here means it vanished between the two reads.
      return NextResponse.json({
        ok: true,
        finalTotalCents: result.finalTotalCents,
        captured: false,
        reason: 'noAuthorisation',
      });
    }

    const capture = await paymentAdapter().captureExact({
      authId,
      amountCents: result.captureCents,
      // ⚠ THE KEY CHANGES WITH THE AMOUNT. A key that ignored it would make a
      // processor replay the original response and quietly capture the old
      // number.
      idempotencyKey: result.captureKey,
    });

    if (!capture.ok) {
      /*
       * ⚠ `alreadyCaptured` IS NOT AN ERROR HERE. It is what a retry after a
       * crash between the commit and the capture looks like, and the right
       * answer is the amount that was actually taken. Treating it as a failure
       * would invite an operator to press the button again.
       */
      if (capture.reason === 'alreadyCaptured') {
        return NextResponse.json({
          ok: true,
          finalTotalCents: result.finalTotalCents,
          captured: true,
          capturedCents: capture.capturedCents,
          replay: true,
        });
      }

      return NextResponse.json(
        { reason: 'captureFailed', detail: capture.reason, finalTotalCents: result.finalTotalCents },
        { status: 402 },
      );
    }

    return NextResponse.json({
      ok: true,
      finalTotalCents: result.finalTotalCents,
      captured: true,
      capturedCents: capture.capturedCents,
    });
  });
}
