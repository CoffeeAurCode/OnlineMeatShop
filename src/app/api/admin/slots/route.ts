import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSlots, updateSlot } from '@/db/repositories/admin';
import { wallClockToInstant } from '@/domain/slots';

import { guarded } from '../_guard';

/**
 * Delivery windows: create a day of them, or change one.
 *
 * ⭐ THIS IS THE SCREEN THAT PREVENTS A SCHEDULED OUTAGE. Until it existed the
 * ONLY way a slot came into being was `scripts/seed-fulfilment.mjs`. When the
 * seeded windows ran out, checkout would offer nothing, the storefront would
 * look broken while being technically correct, and no alarm anywhere would
 * fire. `07-PLAN` §6.2 puts this first for that reason.
 *
 * ══ THE TIMEZONE, WHICH IS THE ONLY HARD PART ═════════════════════════════
 *
 * ⚠ THE OWNER TYPES A WALL CLOCK. "Tuesday, 14:00 to 16:00" is not an instant
 * — it is a local time, and turning it into one has to go through the shop's
 * IANA zone, not the server's. Render runs in US-East and the shop is in
 * Montreal; they agree for most of the year, which is exactly why getting this
 * wrong survives testing and surfaces on one week in March.
 *
 * `wallClockToInstant` is the domain function that already handles it,
 * including the two DST cases: the spring-forward hour that does not exist,
 * and the autumn hour that happens twice. It is used here rather than
 * `new Date(...)` for that reason and no other.
 */

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const createSchema = z.object({
  /** ISO date, the shop's local calendar day. */
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  windows: z
    .array(
      z.object({
        startsAt: z.string().regex(HHMM),
        endsAt: z.string().regex(HHMM),
        /**
         * Local wall clock again. Usually earlier the same morning, but it may
         * legitimately be the PREVIOUS day for an early window, which is why
         * it carries its own date rather than being derived.
         */
        cutoffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        cutoffAt: z.string().regex(HHMM),
        capacity: z.number().int().min(1).max(200),
        hotEligible: z.boolean(),
      }),
    )
    .min(1)
    .max(12),
});

const patchSchema = z.object({
  id: z.uuid(),
  capacity: z.number().int().min(0).max(200).optional(),
  hotEligible: z.boolean().optional(),
  active: z.boolean().optional(),
});

export async function POST(request: Request) {
  return guarded(request, createSchema, async ({ serviceDate, windows }) => {
    const timeZone = process.env.SHOP_TIMEZONE ?? 'America/Toronto';

    const rows = windows.map((w) => ({
      serviceDate,
      startsAt: new Date(wallClockToInstant(serviceDate, w.startsAt, timeZone)),
      endsAt: new Date(wallClockToInstant(serviceDate, w.endsAt, timeZone)),
      cutoffAt: new Date(wallClockToInstant(w.cutoffDate, w.cutoffAt, timeZone)),
      capacity: w.capacity,
      hotEligible: w.hotEligible,
    }));

    /*
     * Checked here rather than left to the CHECK constraint, because the
     * constraint's message ("slot_window_ordered") is not something to show
     * somebody standing in a shop, and because a whole day is rejected
     * together — a partial insert would leave half a Tuesday.
     */
    for (const r of rows) {
      if (r.endsAt <= r.startsAt) {
        return NextResponse.json({ reason: 'endBeforeStart' }, { status: 400 });
      }
      if (r.cutoffAt > r.startsAt) {
        return NextResponse.json({ reason: 'cutoffAfterStart' }, { status: 400 });
      }
    }

    const created = await createSlots(rows);
    return NextResponse.json({ ok: true, created });
  });
}

export async function PATCH(request: Request) {
  return guarded(request, patchSchema, async ({ id, ...patch }) => {
    const result = await updateSlot(id, patch);
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ reason: result.reason }, { status: result.reason === 'notFound' ? 404 : 409 });
  });
}
