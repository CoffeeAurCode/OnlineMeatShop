import { NextResponse } from 'next/server';
import { z } from 'zod';

import { adjustStock, currentBusinessDay } from '@/db/repositories/availability';
import { grams } from '@/domain/types';

import { declaredSchema, guarded } from '../_guard';

/**
 * Correct today's quantities.
 *
 * ⚠ Each product is its own transaction, deliberately. `adjustStock` refuses a
 * quantity below what is already reserved, and that refusal has to name the
 * product it is about. One big transaction would roll the whole screen back
 * because of one number, and the owner would have to retype nineteen correct
 * ones to fix the twentieth.
 *
 * The consequence is that a partial failure leaves earlier products saved. That
 * is reported rather than hidden: `saved` and `failed` both come back.
 */
const schema = z.object({ declared: declaredSchema });

export async function POST(request: Request) {
  return guarded(request, schema, async ({ declared }) => {
    const day = await currentBusinessDay();
    if (day === null) return NextResponse.json({ reason: 'noOpenDay' }, { status: 409 });

    const failed: { productId: string; reason: string; reservedG?: number }[] = [];
    let saved = 0;

    for (const [productId, g] of Object.entries(declared)) {
      const result = await adjustStock(day.id, productId, grams(g));
      if (result.ok) saved += 1;
      else failed.push({ productId, reason: result.reason, reservedG: result.reservedG });
    }

    return failed.length === 0
      ? NextResponse.json({ ok: true, saved })
      : NextResponse.json({ reason: failed[0]?.reason ?? 'unknown', saved, failed }, { status: 409 });
  });
}
