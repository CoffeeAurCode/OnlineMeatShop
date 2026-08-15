import { NextResponse } from 'next/server';
import { z } from 'zod';

import { geoZones, zoneFeesByFsa } from '@/db/repositories/fulfilment';
import {
  checkServiceabilityAt,
  checkServiceability,
  formatPostalCode,
  normalisePostalCode,
} from '@/domain/serviceability';

/**
 * "Do you deliver to me?"
 *
 * The first question every visitor has, asked in the header rather than at the
 * end of the funnel, so an `outsideDeliveryArea` refusal costs somebody a tap
 * instead of a filled-in checkout form.
 *
 * ⭐ TWO WAYS TO ASK, AND THE COORDINATE IS THE GOOD ONE. A phone knows where
 * it is; a postal code is a string somebody typed, and one character of it
 * being wrong is indistinguishable from living somewhere else. Both are
 * supported because the permission can be declined, and a desktop visitor
 * often has nothing better than the postal code.
 *
 * The fee comes back but the zone id does not. Which internal zone somebody
 * falls in is not the customer's business, and enumerating this endpoint
 * should not map out the shop's pricing geography.
 */
const schema = z
  .object({
    postalCode: z.string().min(3).max(20).nullable().default(null),
    lat: z.number().min(-90).max(90).nullable().default(null),
    lng: z.number().min(-180).max(180).nullable().default(null),
  })
  // A request that names no destination is a client bug, and answering
  // `served: false` to it would be a lie about a question nobody asked.
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
  const { lat, lng, postalCode } = parsed.data;

  if (lat !== null && lng !== null) {
    const zones = await geoZones();
    const result = checkServiceabilityAt({ lat, lng }, zones);

    return NextResponse.json(
      result.ok
        ? {
            served: true,
            by: 'coordinates',
            feeCents: result.zone.feeCents,
            freeAboveCents: result.zone.freeAboveCents,
            /*
             * Returned because the customer benefits from knowing they are
             * near the edge, and because it is the number that makes an
             * unexpected refusal explicable. It says nothing about where the
             * shop is that its own address does not already say.
             */
            distanceM: result.distanceM,
          }
        : { served: false, by: 'coordinates' },
    );
  }

  const normalised = normalisePostalCode(postalCode ?? '');
  const zones = await zoneFeesByFsa();
  const result = checkServiceability(normalised, zones);

  return NextResponse.json(
    result.ok
      ? {
          served: true,
          by: 'postalCode',
          postalCode: formatPostalCode(normalised),
          feeCents: result.zone.feeCents,
          freeAboveCents: result.zone.freeAboveCents,
        }
      : { served: false, by: 'postalCode', postalCode: formatPostalCode(normalised) },
  );
}
