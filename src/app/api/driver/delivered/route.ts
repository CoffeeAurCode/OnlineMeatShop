import { NextResponse } from 'next/server';
import { z } from 'zod';

import { DriverRefused, requireDriver } from '@/app/driver-guard';
import { reportDelivery } from '@/db/repositories/driver';

/**
 * The driver closes a job at the door.
 *
 * ⚠ THE PARTNER ID COMES FROM THE SESSION, NEVER FROM THE BODY. It is passed
 * straight into `reportDelivery`, where it forms half the lookup key — so a
 * driver cannot close somebody else's order even by guessing its UUID.
 *
 * ══ WHY A MISMATCHED CASH AMOUNT RETURNS 200 ══════════════════════════════
 *
 * ⭐ IT IS NOT AN ERROR. The food is already at the door and the money is
 * already in somebody's pocket; the report is the only record that will ever
 * exist of what actually happened. A 4xx would make the driver's screen show a
 * failure, and the natural response to a failure on a doorstep is to try again
 * with a number that "works" — which is precisely how a shortfall gets typed
 * away.
 *
 * So a short or over payment is a SUCCESS carrying `outcome` and a status that
 * is still `OUT`. The driver's screen says the shop has been told; the console
 * shows it in red. See `reportDelivery` for why the order deliberately does
 * not close.
 */

export const dynamic = 'force-dynamic';

const schema = z.object({
  orderId: z.uuid(),
  /**
   * Cents. Null on a prepaid order — and `null` rather than absent so that a
   * client which simply forgot the field is refused by the schema rather than
   * silently treated as "collected nothing".
   */
  cashCollectedCents: z.number().int().min(0).max(100_000_00).nullable(),
});

export async function POST(request: Request) {
  let driverId: string;
  try {
    driverId = (await requireDriver()).id;
  } catch (error) {
    if (error instanceof DriverRefused) {
      return NextResponse.json({ reason: error.reason }, { status: 401 });
    }
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ reason: 'malformedBody' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ reason: 'invalidBody' }, { status: 400 });

  const result = await reportDelivery(
    driverId,
    parsed.data.orderId,
    parsed.data.cashCollectedCents,
    Date.now(),
  );

  if (!result.ok) {
    return NextResponse.json(
      { reason: result.reason },
      // `notFound` covers both "no such order" and "not yours", which is the
      // same answer to the only question being asked.
      { status: result.reason === 'notFound' ? 404 : 409 },
    );
  }

  return NextResponse.json({ ok: true, outcome: result.outcome, status: result.status });
}
