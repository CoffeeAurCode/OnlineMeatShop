import { NextResponse } from 'next/server';
import { z } from 'zod';

import { saveActualWeight } from '@/db/repositories/orders';
import { grams } from '@/domain/types';

import { gramsSchema, guarded } from '../_guard';

/**
 * Record one actual weight.
 *
 * `approveVariance` is the customer's yes, relayed by the owner after actually
 * asking them. It is NOT a retry flag, and the console must never set it
 * automatically on a second attempt: that would turn "the customer agreed to
 * buy 30% more meat" into "the button was pressed twice".
 */
const schema = z.object({
  orderId: z.uuid(),
  lineId: z.uuid(),
  weighedG: gramsSchema,
  approveVariance: z.boolean(),
});

export async function POST(request: Request) {
  return guarded(request, schema, async ({ orderId, lineId, weighedG, approveVariance }) => {
    const result = await saveActualWeight(orderId, lineId, grams(weighedG), approveVariance);

    return result.ok
      ? NextResponse.json({
          ok: true,
          actWeightG: result.actWeightG,
          actAmountCents: result.actAmountCents,
        })
      : NextResponse.json({ reason: result.reason, detail: result.detail }, { status: 409 });
  });
}
