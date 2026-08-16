import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { captureKey, paymentAdapter } from '@/adapters/payments';
import { CUSTOMER_SESSION_COOKIE, readCustomerSession } from '@/auth/customer-session';
import { currentBusinessDay } from '@/db/repositories/availability';
import { findOrCreateCustomerByPhone } from '@/db/repositories/customers';
import { normalisePhone } from '@/domain/phone';
import { cancelOrder, placeOrder } from '@/db/repositories/placement';
import { quoteBasket } from '@/db/repositories/quote';
import { DEFAULT_TOLERANCE } from '@/domain/pricing';
import { grams } from '@/domain/types';

/**
 * Place the order, and put a hold on the money.
 *
 * ⭐ `pay_mode` IS `PREPAID`, NOT `COD`, AND THAT IS THE WHOLE POINT.
 *
 * `pay_mode` does not describe whether real money moved. It SELECTS A CODE
 * PATH. `COD` skips authorisation and skips settlement because there is
 * nothing to capture; `PREPAID` means a processor holds an authorisation that
 * will later be captured. Marking these orders `COD` because the adapter is a
 * stub would route them down the branch with no hold and no capture, and the
 * lifecycle this prototype exists to exercise would never run. The prototype
 * would report success while testing nothing.
 *
 * "No real money moved" is carried by the ADAPTER IDENTITY and by the UI
 * banner. Never by the pay mode.
 *
 * ══ THE ORDER OF OPERATIONS, AND WHY IT IS THIS WAY ═══════════════════════
 *
 * ⚠ NO HTTP INSIDE THE TRANSACTION. A transaction holding row locks across a
 * call to a payment processor has its duration set by someone else's
 * availability. So:
 *
 *   1. re-quote and compare the catalog version   (cheap, outside)
 *   2. place the order                            (ONE transaction, 8 preconditions)
 *   3. authorise the ceiling                      (the adapter, outside)
 *   4. if authorisation fails, CANCEL the order   (returns stock and the slot)
 *
 * Step 4 is the part that is easy to leave out. Without it a declined card
 * leaves an order holding stock and a delivery slot that nobody will ever
 * collect, and the shop finds out when the fish does not sell.
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
  /**
   * ⚠ NULLABLE, AND THAT IS THE POINT OF THIS SHAPE. An order located by GPS
   * has no postal code and does not need one. The refinement below is what
   * insists that SOMETHING locates the order.
   */
  postalCode: z.string().min(3).max(20).nullable().default(null),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),

  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).nullable(),
  city: z.string().trim().min(1).max(120),
  /**
   * Province, state, or whatever the region is called where the customer
   * lives. Free text rather than an enum of the thirteen Canadian codes: the
   * shop delivers inside one radius, but test orders are placed from
   * everywhere, and a dropdown that cannot express the answer is worse than a
   * field that can.
   */
  province: z.string().trim().min(1).max(80),
  deliveryNotes: z.string().trim().max(500).nullable(),
  /**
   * How the parcel should be handed over. Free text is deliberate: it is
   * printed for a human to read and never branched on.
   */
  dropOff: z.string().trim().max(80).nullable().default(null),

  slotId: z.uuid(),

  /**
   * ⭐ VERIFIED SINCE 2026-08-16, AND CROSS-CHECKED AGAINST THE SESSION.
   *
   * This field is still in the body because the screen shows it and the order
   * stores it, but it is no longer TRUSTED: the handler refuses unless it
   * normalises to the same number as the signed customer cookie. Sending
   * somebody else's number now fails; before, it merely mislabelled an order.
   *
   * ⚠ It is not the authority even so — `phoneE164` below is taken from the
   * COOKIE. Comparing and then using the body's copy would make the comparison
   * decorative.
   */
  phone: z.string().min(5).max(40),
  name: z.string().trim().max(120).nullable(),
  email: z.email().max(200).nullable(),

  /** Echoed back from the quote so a moved catalog is detectable. */
  catalogVersion: z.number().int().positive(),
})
  .refine((v) => v.postalCode !== null || (v.lat !== null && v.lng !== null), {
    message: 'a postal code or a coordinate pair is required',
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

  /*
   * ⭐ THE SIGN-IN GATE. An order cannot be placed by an unproven number.
   *
   * ⚠ THE NUMBER USED IS THE COOKIE'S, NOT THE BODY'S. The body's copy is
   * only compared, so that a screen showing one number while placing an order
   * under another is refused rather than silently corrected — that mismatch
   * means the page is stale, and the customer is looking at an address and a
   * basket that may belong to the previous session.
   *
   * Refusing with 401 and `signInRequired` rather than 400: the storefront
   * opens the sign-in sheet on exactly this code, which is what makes an
   * expired thirty-day cookie a two-tap recovery instead of a dead checkout
   * button.
   */
  const jar = await cookies();
  const session = readCustomerSession(jar.get(CUSTOMER_SESSION_COOKIE)?.value, Date.now());
  if (!session.ok) {
    return NextResponse.json({ reason: 'signInRequired' }, { status: 401 });
  }

  const phoneE164 = session.payload.phone;
  if (normalisePhone(input.phone) !== phoneE164) {
    return NextResponse.json({ reason: 'phoneMismatch' }, { status: 409 });
  }

  const day = await currentBusinessDay();
  if (day === null) return NextResponse.json({ reason: 'shopClosed' }, { status: 409 });

  const point = input.lat !== null && input.lng !== null ? { lat: input.lat, lng: input.lng } : null;

  // Re-quoted so a catalog change between the screen and this call is caught
  // before an order is written and before a card is touched.
  const quote = await quoteBasket(input.lines, { point, postalCode: input.postalCode });
  if (quote.catalogVersion !== input.catalogVersion) {
    return NextResponse.json(
      {
        reason: 'priceChanged',
        estTotalCents: quote.estTotalCents,
        catalogVersion: quote.catalogVersion,
      },
      { status: 409 },
    );
  }
  if (quote.estTotalCents === null) {
    return NextResponse.json({ reason: 'outsideDeliveryArea' }, { status: 409 });
  }

  const customerId = await findOrCreateCustomerByPhone(phoneE164, input.name, input.email);

  const result = await placeOrder({
    attemptId: null,
    customerId,
    postalCode: input.postalCode,
    point,
    address: {
      line1: input.addressLine1,
      line2: input.addressLine2,
      city: input.city,
      province: input.province,
      /*
       * The drop-off choice rides in the notes rather than in a column of its
       * own. It is one short phrase, it is only ever read by the person
       * carrying the box, and nothing branches on it — so a column would buy a
       * migration and an enum to express a sentence.
       */
      notes: [input.dropOff, input.deliveryNotes].filter((x) => x !== null && x !== '').join(' · ')
        || null,
    },
    slotId: input.slotId,
    businessDayId: day.id,
    // See the header. This is the branch with a hold and a capture in it.
    payMode: 'PREPAID',
    lines: input.lines.map((l) => ({
      productId: l.productId,
      requestedG: grams(l.requestedG),
      prepOptionId: l.prepOptionId,
    })),
    nowMs: Date.now(),
  });

  if (!result.ok) {
    return NextResponse.json(
      { reason: result.reason, orderId: result.orderId, detail: 'detail' in result ? result.detail : undefined },
      { status: 409 },
    );
  }

  /*
   * ⭐ AUTHORISE THE CEILING, NOT THE ESTIMATE.
   *
   * `estTotal × (1 + tolerance)`. Holding the estimate itself would fail the
   * capture every time a cut came in heavy, which is the normal case here, not
   * an edge case. `cappedTotal` at settlement is what guarantees the customer
   * is never charged more than this.
   */
  const ceilingCents = Math.ceil(result.estTotalCents * (1 + DEFAULT_TOLERANCE));

  try {
    const adapter = paymentAdapter();
    await adapter.authoriseCeiling({
      orderId: result.orderId,
      ceilingCents,
      idempotencyKey: captureKey(result.orderId, ceilingCents),
    });
  } catch {
    /*
     * ⚠ THE PART THAT IS EASY TO FORGET. A failed authorisation must return
     * the stock and the slot, or the shop holds fish for an order that will
     * never be paid for and only finds out when it does not sell.
     */
    await cancelOrder(result.orderId);
    return NextResponse.json({ reason: 'paymentFailed' }, { status: 402 });
  }

  return NextResponse.json({
    ok: true,
    orderId: result.orderId,
    publicToken: result.publicToken,
    estTotalCents: result.estTotalCents,
    ceilingCents,
    /** The UI banner keys off this, not off the pay mode. */
    testOrder: true,
  });
}
