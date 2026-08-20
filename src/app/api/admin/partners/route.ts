import { NextResponse } from 'next/server';
import { z } from 'zod';

import { addPartner, deletePartner, updatePartner } from '@/db/repositories/partners';
import { normalisePhone } from '@/domain/phone';

import { guarded } from '../_guard';

/**
 * The delivery partner roster: add, edit, deactivate.
 *
 * ⚠ THE NUMBER IS NORMALISED HERE, AT THE BOUNDARY, AND NOWHERE ELSE.
 *
 * The repository does not normalise and neither does the database — the
 * database REFUSES, via `partner_phone_e164`. That split is deliberate: this
 * is the only layer holding what the owner actually typed, so it is the only
 * layer that can say "that is not a phone number" instead of surfacing a
 * constraint violation as a 500 on a screen in a shop at 6am.
 *
 * The CHECK is not redundant with this. It is what makes the rule true for
 * rows written by a script, a migration or a psql session, none of which come
 * through here.
 *
 * Deactivation removes somebody from today's picker immediately. Permanent
 * deletion is a separate, guarded action for an inactive entry with no live
 * jobs; historical orders keep their snapshotted name and number.
 */

const addSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(5).max(40),
  notes: z.string().trim().max(500).nullable().default(null),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

const patchSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(5).max(40).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

const deleteSchema = z.object({ id: z.uuid() });

export async function POST(request: Request) {
  return guarded(request, addSchema, async (input) => {
    const phone = normalisePhone(input.phone);
    if (phone === null) return NextResponse.json({ reason: 'invalidPhone' }, { status: 400 });

    const result = await addPartner({
      name: input.name,
      phone,
      notes: input.notes,
      sortOrder: input.sortOrder,
    });

    return result.ok
      ? NextResponse.json({ ok: true, id: result.id })
      : NextResponse.json({ reason: result.reason }, { status: 409 });
  });
}

export async function PATCH(request: Request) {
  return guarded(request, patchSchema, async ({ id, phone, ...rest }) => {
    let normalised: string | undefined;
    if (phone !== undefined) {
      const value = normalisePhone(phone);
      if (value === null) return NextResponse.json({ reason: 'invalidPhone' }, { status: 400 });
      normalised = value;
    }

    const result = await updatePartner(id, {
      ...rest,
      ...(normalised && { phone: normalised }),
    });

    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ reason: result.reason }, { status: result.reason === 'notFound' ? 404 : 409 });
  });
}

export async function DELETE(request: Request) {
  return guarded(request, deleteSchema, async ({ id }) => {
    const result = await deletePartner(id);
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ reason: result.reason }, { status: result.reason === 'notFound' ? 404 : 409 });
  });
}
