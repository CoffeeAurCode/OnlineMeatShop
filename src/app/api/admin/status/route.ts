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
});

export async function POST(request: Request) {
  return guarded(request, schema, async ({ orderId, from, to }) => {
    const result = await advanceOrder(orderId, from, to);
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ reason: result.reason }, { status: 409 });
  });
}
