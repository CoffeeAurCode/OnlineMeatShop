import { NextResponse } from 'next/server';
import { z } from 'zod';

import { assignPartner, unassignPartner } from '@/db/repositories/orders';
import { partnerById } from '@/db/repositories/partners';

import { guarded } from '../_guard';

/**
 * Give an order to a delivery partner, or take it back.
 *
 * ⭐ THE NAME AND NUMBER ARE READ FROM THE ROSTER HERE, NOT SENT BY THE
 * CLIENT.
 *
 * The request carries a partner ID and nothing else. Accepting a name and a
 * phone from the browser would let a compromised or simply stale console
 * write an arbitrary number onto an order — and that number is what a dispatch
 * message is then sent to. The snapshot has to be taken from the row, inside
 * the server, at the moment of assignment.
 *
 * ⚠ AN INACTIVE PARTNER IS REFUSED. The picker does not offer them, so
 * reaching this means either a stale screen or a hand-made request; both
 * should fail. Somebody who has left the roster must not be sent a customer's
 * home address.
 */

const schema = z.object({
  orderId: z.uuid(),
  /** Null unassigns. One route, because the console shows one control. */
  partnerId: z.uuid().nullable(),
});

export async function POST(request: Request) {
  return guarded(request, schema, async ({ orderId, partnerId }) => {
    const now = Date.now();

    if (partnerId === null) {
      const ok = await unassignPartner(orderId, now);
      return ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ reason: 'finished' }, { status: 409 });
    }

    const partner = await partnerById(partnerId);
    if (partner === null) return NextResponse.json({ reason: 'notFound' }, { status: 404 });
    if (!partner.active) return NextResponse.json({ reason: 'inactivePartner' }, { status: 409 });

    const result = await assignPartner(
      orderId,
      { id: partner.id, name: partner.name, phone: partner.phone },
      now,
    );

    return result.ok
      ? NextResponse.json({ ok: true, partnerName: partner.name })
      : NextResponse.json({ reason: result.reason }, { status: result.reason === 'notFound' ? 404 : 409 });
  });
}
