import { NextResponse } from 'next/server';
import { z } from 'zod';

import { clearServiceableFsas, updateZone } from '@/db/repositories/admin';

import { guarded } from '../_guard';

/**
 * The delivery area: fee, free-delivery threshold, and the circle.
 *
 * ══ THE TRAP THIS SCREEN EXISTS TO DEFUSE ═════════════════════════════════
 *
 * ⚠ THERE ARE TWO SERVICEABILITY MECHANISMS AND NARROWING ONE DOES NOT NARROW
 * THE OTHER.
 *
 *   1. The zone's CIRCLE, which a customer's GPS coordinate is tested against.
 *   2. `serviceable_fsa`, which a typed POSTAL CODE is tested against — and
 *      which currently holds every FSA Canada Post issues, all pointing at the
 *      one placeholder zone.
 *
 * Set a fifteen-kilometre radius and a customer who declines the location
 * permission is still served in Vancouver, through the postal path, and the
 * van finds out later. `CODEBASE-CONTEXT.md` §1.5 says the two must be closed
 * in the same sitting; this route is what makes that possible without a SQL
 * client, and the console warns while both are open.
 *
 * ⚠ `radiusM` IS BOUNDED AT 20 038 000 m — half the Earth's circumference,
 * which is the current seeded value and contains every point on the planet. It
 * is allowed because test orders are placed from India, and it is capped
 * because a larger number is not a delivery area, it is a typo.
 */

const schema = z.object({
  zoneId: z.uuid(),
  feeCents: z.number().int().min(0).max(100_000).optional(),
  /** Null means "no free delivery at any basket size", which is a real choice. */
  freeAboveCents: z.number().int().min(0).max(1_000_000).nullable().optional(),
  circle: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      radiusM: z.number().int().min(100).max(20_038_000),
    })
    .nullable()
    .optional(),
  /**
   * Delete the FSA scaffolding for this zone.
   *
   * Explicitly opt-in and never implied by setting a radius: it destroys 4680
   * rows, and a destructive step that happens as a side effect of a different
   * one is how somebody loses data they did not know they had.
   */
  clearPostalCodes: z.boolean().default(false),
});

export async function POST(request: Request) {
  return guarded(request, schema, async ({ zoneId, clearPostalCodes, ...patch }) => {
    const ok = await updateZone(zoneId, patch);
    if (!ok) return NextResponse.json({ reason: 'notFound' }, { status: 404 });

    const cleared = clearPostalCodes ? await clearServiceableFsas(zoneId) : 0;
    return NextResponse.json({ ok: true, clearedFsas: cleared });
  });
}
