import { NextResponse } from 'next/server';
import { z } from 'zod';

import { openBusinessDay } from '@/db/repositories/availability';
import { grams } from '@/domain/types';

import { declaredSchema, guarded } from '../_guard';

/**
 * Open the trading day.
 *
 * The whole declaration is one call, and `openBusinessDay` makes it one
 * transaction: close the current day, open the new one, write its stock. A
 * half-open day is a shop selling against a stock table it does not have.
 */
const schema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  declared: declaredSchema,
});

export async function POST(request: Request) {
  return guarded(request, schema, async ({ businessDate, declared }) => {
    const map = new Map(Object.entries(declared).map(([id, g]) => [id, grams(g)]));
    const result = await openBusinessDay(businessDate, map);

    return result.ok
      ? NextResponse.json({ ok: true, businessDayId: result.businessDayId })
      : NextResponse.json({ reason: result.reason }, { status: 409 });
  });
}
