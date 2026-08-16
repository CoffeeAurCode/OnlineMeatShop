import { NextResponse } from 'next/server';
import { z } from 'zod';

import { smsSender } from '@/adapters/sms';
import {
  claimDispatch,
  dispatchDedupeKey,
  markDispatchFailed,
  markDispatchSent,
  reopenDispatch,
} from '@/db/repositories/dispatch';
import { markDispatched, orderForDispatch } from '@/db/repositories/orders';
import { buildDispatchMessage, forbiddenFieldIn, type DispatchLine } from '@/domain/dispatch';
import { shopName } from '@/ui/shop-config';

import { guarded } from '../_guard';

/**
 * Send the delivery partner their job.
 *
 * ══ THE ORDER OF OPERATIONS, AND WHY IT IS THIS WAY ═══════════════════════
 *
 *   1. read the order snapshot            (must already be assigned)
 *   2. build the message                  (pure, `src/domain/dispatch.ts`)
 *   3. refuse if it carries money or an email
 *   4. claim the outbox row               (PENDING)
 *   5. send                               (HTTP, outside any transaction)
 *   6. mark the row SENT and stamp `dispatched_at`
 *
 * ⚠ NO HTTP INSIDE A TRANSACTION (`CLAUDE.md` §7). Nothing here opens one that
 * spans step 5, and nothing should: a transaction holding row locks across a
 * call to Twilio has its duration set by somebody else's availability.
 *
 * ⚠ STEP 3 IS NOT PARANOIA. `forbiddenFieldIn` re-reads the finished message
 * looking for a dollar amount or an email address. The leak it guards against
 * does not come from the template — it comes from a future field on
 * `DispatchSnapshot` that somebody interpolates without asking whether a
 * driver should see it. The check costs one regex and refuses to send rather
 * than sending something that cannot be un-sent.
 *
 * ══ THE FAILURE MODE THAT MATTERS ═════════════════════════════════════════
 *
 * ⭐ A SECOND CALL IS A REPLAY, NOT AN ERROR. Same rule as the payment
 * capture, for the same reason: a double-tap on a phone with a slow connection
 * is the normal case, and reporting it as a failure invites the owner to press
 * the button a third time. `alreadySent` comes back as a SUCCESS carrying when
 * it went, so the screen can say "sent at 14:02" rather than "error".
 */

const schema = z.object({
  orderId: z.uuid(),
  /**
   * The driver deleted the text. Re-sends an assignment already marked sent,
   * keeping the same outbox row because it is still the same assignment.
   */
  resend: z.boolean().default(false),
});

export async function POST(request: Request) {
  return guarded(request, schema, async ({ orderId, resend }) => {
    const snapshot = await orderForDispatch(orderId);
    if (snapshot === null) {
      // Either no such order, or nobody is assigned to it. Deliberately one
      // code: the console never offers this button on an unassigned order, so
      // both mean the screen is stale and the answer is the same — reload.
      return NextResponse.json({ reason: 'notAssigned' }, { status: 409 });
    }
    if (snapshot.customerPhone === null) {
      return NextResponse.json({ reason: 'noCustomerPhone' }, { status: 409 });
    }

    const lines: DispatchLine[] = snapshot.lines.map((l) => ({
      name: l.name,
      quantityLabel:
        l.pricingMode === 'perKg'
          ? `${(l.requestedG / 1000).toFixed(l.requestedG % 1000 === 0 ? 0 : 2)} kg`
          : `${Math.max(1, Math.round(l.requestedG / 1000))} x`,
      hot: l.hot,
    }));

    const message = buildDispatchMessage({
      reference: snapshot.reference,
      shopName: shopName(),
      slotLabel: slotLabel(snapshot.slotStartsAt, snapshot.slotEndsAt),
      lines,
      addressLine1: snapshot.addressLine1,
      addressLine2: snapshot.addressLine2,
      city: snapshot.city,
      province: snapshot.province,
      postalCode: snapshot.postalCode,
      deliveryNotes: snapshot.deliveryNotes,
      dropOff: null,
      customerPhone: snapshot.customerPhone,
      customerName: snapshot.customerName,
      lat: snapshot.lat,
      lng: snapshot.lng,
    });

    const forbidden = forbiddenFieldIn(message.text);
    if (forbidden !== null) {
      return NextResponse.json({ reason: 'forbiddenContent', field: forbidden }, { status: 500 });
    }

    if (resend) {
      await reopenDispatch(
        dispatchDedupeKey(orderId, snapshot.partnerId, snapshot.assignedAtMs),
      );
    }

    const claim = await claimDispatch({
      orderId,
      partnerId: snapshot.partnerId,
      assignedAtMs: snapshot.assignedAtMs,
      recipient: snapshot.partnerPhone,
      payload: { text: message.text, segments: message.segments },
    });

    if (claim.state === 'alreadySent') {
      return NextResponse.json({
        ok: true,
        replay: true,
        sentAtMs: claim.sentAtMs,
        segments: message.segments,
      });
    }

    const sender = smsSender();
    const result = await sender.send(snapshot.partnerPhone, message.text);

    if (!result.ok) {
      await markDispatchFailed(claim.dedupeKey, result.error ?? 'unknown');
      return NextResponse.json(
        { reason: 'sendFailed', detail: result.error, provider: sender.name },
        { status: 502 },
      );
    }

    await markDispatchSent(claim.dedupeKey, result.providerId);
    await markDispatched(orderId, Date.now());

    return NextResponse.json({
      ok: true,
      replay: false,
      provider: sender.name,
      segments: message.segments,
      /**
       * Returned so the console can show what actually went out. The owner is
       * the only person who ever sees both this and the driver's phone, and
       * they are the only one who can tell us the address line was wrong.
       */
      preview: message.text,
    });
  });
}

/**
 * "Today 14:00-16:00", in the SHOP's timezone.
 *
 * ⚠ `SHOP_TIMEZONE`, NOT THE SERVER'S CLOCK. Render runs in US-East and the
 * shop is in Montreal; for most of the year they agree, which is precisely why
 * a bug here would survive testing and surface on one specific week. The slot
 * itself is `timestamptz`, so this is purely a rendering choice.
 */
function slotLabel(startsAt: Date, endsAt: Date): string {
  const timeZone = process.env.SHOP_TIMEZONE ?? 'America/Toronto';
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(startsAt);
  const time = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${day} ${time.format(startsAt)}-${time.format(endsAt)}`;
}
