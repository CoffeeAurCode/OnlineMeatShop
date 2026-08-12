import { NextResponse } from 'next/server';
import { z } from 'zod';

import { currentBusinessDay } from '@/db/repositories/availability';
import { findOrCreateCustomer } from '@/db/repositories/customers';
import { placeOrder } from '@/db/repositories/placement';
import { quoteBasket } from '@/db/repositories/quote';
import { grams } from '@/domain/types';

/**
 * Place the order.
 *
 * 🔴 THERE IS NO PAYMENT HERE, AND THE ORDER IS RECORDED AS PAY-ON-DELIVERY.
 *
 * The designed flow authorises a ceiling on the customer's card BEFORE
 * placement, then captures the exact amount after weighing. That needs the
 * Stripe adapter, which does not exist. Rather than pretend, this route passes
 * `attemptId: null` — a shape `placeOrder` already supports for a placement
 * with no payment stage — and `payMode: 'COD'`.
 *
 * ⚠ THIS CHANGES A COMMITMENT MADE TO THE CLIENT. The hold-then-charge-exact
 * checkout is one of the four promises in `WHATSAPP-architecture-options.md`.
 * The storefront still SHOWS the money sentence, because that is the design
 * and the copy is correct for the flow that is coming, and the checkout screen
 * says plainly that card payment is not connected yet. Flagged in `DEVLOG.md`.
 *
 * Note what passing `attemptId: null` costs: P8, the stale-quote check, does
 * not run, because there is no earlier authorisation to have gone stale. The
 * other seven preconditions all still apply, inside the one transaction.
 */
const schema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.uuid(),
        requestedG: z.number().int().positive().max(1_000_000),
        prepOptionId: z.uuid().nullable(),
      }),
    )
    .min(1)
    .max(100),
  postalCode: z.string().min(3).max(20),

  /**
   * The street address, added by migration 0006. `order` previously stored a
   * postal code and an FSA and nothing else, and you cannot deliver to a
   * forward sortation area.
   */
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).nullable(),
  city: z.string().trim().min(1).max(120),
  province: z.string().trim().min(2).max(80),
  deliveryNotes: z.string().trim().max(500).nullable(),

  slotId: z.uuid(),
  email: z.email().max(200),
  name: z.string().max(120).nullable(),
  phone: z.string().max(40).nullable(),
  /** Echoed back from the quote so a moved catalog is detectable. */
  catalogVersion: z.number().int().positive(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ reason: 'malformedBody' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ reason: 'invalidBody' }, { status: 400 });
  const input = parsed.data;

  const day = await currentBusinessDay();
  if (day === null) return NextResponse.json({ reason: 'shopClosed' }, { status: 409 });

  // Re-quoted here so that a catalog change between the screen and this call
  // is caught before an order is written. With no PaymentIntent to cancel this
  // is cheaper than P8, and it covers the same mistake.
  const quote = await quoteBasket(input.lines, input.postalCode);
  if (quote.catalogVersion !== input.catalogVersion) {
    return NextResponse.json(
      { reason: 'priceChanged', estTotalCents: quote.estTotalCents, catalogVersion: quote.catalogVersion },
      { status: 409 },
    );
  }

  const customerId = await findOrCreateCustomer(input.email, input.name, input.phone);

  const result = await placeOrder({
    attemptId: null,
    customerId,
    postalCode: input.postalCode,
    address: {
      line1: input.addressLine1,
      line2: input.addressLine2,
      city: input.city,
      province: input.province,
      notes: input.deliveryNotes,
    },
    slotId: input.slotId,
    businessDayId: day.id,
    payMode: 'COD',
    lines: input.lines.map((l) => ({
      productId: l.productId,
      requestedG: grams(l.requestedG),
      prepOptionId: l.prepOptionId,
    })),
    nowMs: Date.now(),
  });

  if (!result.ok) {
    return NextResponse.json({ reason: result.reason, orderId: result.orderId }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    orderId: result.orderId,
    publicToken: result.publicToken,
    estTotalCents: result.estTotalCents,
    paymentPending: true,
  });
}
