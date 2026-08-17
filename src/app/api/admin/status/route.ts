import { NextResponse } from 'next/server';
import { z } from 'zod';

import { advanceOrder } from '@/db/repositories/orders';

import { guarded } from '../_guard';

/**
 * Move an order one step along its lifecycle.
 *
 * `from` is required and is not decoration: the transition names the status it
 * expects to be moving out of, so a stale screen or a double tap is a no-op
 * rather than an order walked backwards. The client sends what it last saw.
 */
const STATUSES = [
  'PLACED',
  'PREPARING',
  'WEIGHED',
  'READY',
  'OUT',
  'DELIVERED',
  'CANCELLED',
] as const;

const schema = z.object({
  orderId: z.uuid(),
  from: z.enum(STATUSES),
  to: z.enum(STATUSES),
  /**
   * Cash the shop is recording on the driver's behalf, in cents.
   *
   * ⚠ ONLY ON A `COD` ORDER MOVING TO `DELIVERED`, and optional even then:
   * absent means "whatever the driver already reported through the portal",
   * which is the normal case. The owner should never re-key a figure that is
   * already recorded.
   */
  cashCollectedCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
});

export async function POST(request: Request) {
  return guarded(request, schema, async ({ orderId, from, to, cashCollectedCents }) => {
    const result = await advanceOrder(orderId, from, to, {
      // Spread rather than passing `undefined`: `exactOptionalPropertyTypes`
      // is on, and "not supplied" is a different statement from "supplied as
      // nothing" — the first means "use what the driver reported".
      ...(cashCollectedCents === undefined ? {} : { cashCollectedCents }),
    });
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ reason: result.reason }, { status: 409 });
  });
}
