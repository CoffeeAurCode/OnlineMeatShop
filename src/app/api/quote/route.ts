import { NextResponse } from 'next/server';
import { z } from 'zod';

import { quoteBasket } from '@/db/repositories/quote';

/**
 * Price the basket, server-side.
 *
 * The basket page and the checkout page both call this rather than doing
 * arithmetic in the browser. It is the only route on the storefront that the
 * client fetches, and that is deliberate: catalog and availability reads are
 * server-rendered so a crawler sees them (`04-PLAN` §0), while the basket is
 * per-customer, is not indexable and has nothing to gain from being in the
 * HTML.
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
    .max(100),
  postalCode: z.string().max(20).nullable(),
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

  const quote = await quoteBasket(parsed.data.lines, parsed.data.postalCode);
  return NextResponse.json(quote);
}
