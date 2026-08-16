import { NextResponse } from 'next/server';
import { z } from 'zod';

import { updateProduct } from '@/db/repositories/admin';

import { guarded } from '../_guard';

/**
 * Edit a product: its name, its description, its price, whether it is sold.
 *
 * ⭐ EVERY WRITE HERE BUMPS `catalog_version`, INSIDE THE SAME TRANSACTION.
 * That is what makes P8 fire: a customer who loaded the shop before the change
 * gets `priceChanged` at checkout and is asked to confirm, rather than being
 * charged the new price silently. Editing a price without the bump is not a
 * missing nicety — it is the failure P8 exists to prevent.
 *
 * ⚠ `pricingMode` AND `handling` ARE ABSENT FROM THIS SCHEMA ON PURPOSE.
 * Flipping a pack to per-kg changes which of six columns must be NULL
 * (inv-C1/C2 are CHECK constraints), and flipping `handling` to `COOKED_HOT`
 * retroactively changes which delivery slots whole ORDERS may use — a
 * food-safety rule. Both are "deactivate this and create a new one", not a
 * dropdown. See `updateProduct` for the longer version.
 *
 * ⚠ MONEY IS INTEGER CENTS AT THIS BOUNDARY AND EVERY OTHER ONE. The console
 * sends cents; it never sends `12.99`. `z.number().int()` is what enforces it,
 * and it is the last place a float could get in.
 */

const schema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(200).optional(),
    nameFr: z.string().trim().max(200).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    descriptionFr: z.string().trim().max(2000).nullable().optional(),
    categoryId: z.uuid().nullable().optional(),
    active: z.boolean().optional(),

    packPriceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
    wMinG: z.number().int().min(0).max(1_000_000).nullable().optional(),
    wMaxG: z.number().int().min(0).max(1_000_000).nullable().optional(),

    ratePerKgCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
    minOrderG: z.number().int().min(0).max(1_000_000).nullable().optional(),
    stepG: z.number().int().min(1).max(1_000_000).nullable().optional(),
  })
  .refine((v) => v.wMinG == null || v.wMaxG == null || v.wMinG <= v.wMaxG, {
    message: 'wMinG must not exceed wMaxG',
  });

export async function PATCH(request: Request) {
  return guarded(request, schema, async ({ id, ...patch }) => {
    const ok = await updateProduct(id, patch);
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ reason: 'notFound' }, { status: 404 });
  });
}
