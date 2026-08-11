import { NextResponse } from 'next/server';
import { z } from 'zod';

import { zoneFeesByFsa } from '@/db/repositories/fulfilment';
import { checkServiceability, formatPostalCode, normalisePostalCode } from '@/domain/serviceability';

/**
 * "Do you deliver to me?"
 *
 * This answers the hero's postcode check (`04-PLAN` §10.1). The shop is
 * delivery-only inside a radius, so it is the first question every visitor
 * has, and asking it in the hero moves an `outsideDeliveryArea` rejection from
 * the end of the funnel to the start.
 *
 * The fee is returned but the zone id is not: which internal zone someone
 * falls in is not the customer's business, and enumerating this endpoint
 * should not map out the shop's pricing geography any more than it has to.
 */
const schema = z.object({ postalCode: z.string().min(3).max(20) });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ reason: 'malformedBody' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ reason: 'invalidBody' }, { status: 400 });

  const normalised = normalisePostalCode(parsed.data.postalCode);
  const zones = await zoneFeesByFsa();
  const result = checkServiceability(normalised, zones);

  return NextResponse.json(
    result.ok
      ? {
          served: true,
          postalCode: formatPostalCode(normalised),
          feeCents: result.zone.feeCents,
          freeAboveCents: result.zone.freeAboveCents,
        }
      : { served: false, postalCode: formatPostalCode(normalised) },
  );
}
