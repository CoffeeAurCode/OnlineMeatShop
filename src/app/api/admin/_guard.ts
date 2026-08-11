import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireStaff, StaffRefused } from '@/app/admin-guard';

/**
 * The shared boundary for every admin mutation.
 *
 * Two jobs, and both of them are the kind that get skipped on the fifth route
 * handler if they are not in one place:
 *
 * 1. **The staff check runs first, always**, before the body is even parsed.
 *    An unauthenticated caller must not be able to tell a valid payload from
 *    an invalid one.
 * 2. **The body is validated with Zod**, and a failure returns a code rather
 *    than an exception. `CLAUDE.md` requires this at every route-handler
 *    boundary because these handlers write stock and money.
 *
 * Failures come back as `{ reason }` with no detail beyond the code. The
 * frontend maps codes to sentences; a raw error never reaches a screen.
 */
export async function guarded<T>(
  request: Request,
  schema: z.ZodType<T>,
  handler: (input: T) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    await requireStaff();
  } catch (error) {
    if (error instanceof StaffRefused) {
      // 404, not 403. A console that answers "forbidden" confirms it exists.
      return NextResponse.json({ reason: 'notFound' }, { status: 404 });
    }
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ reason: 'malformedBody' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ reason: 'invalidBody' }, { status: 400 });
  }

  return handler(parsed.data);
}

/** Grams as they arrive from a client: a non-negative integer, and nothing else. */
export const gramsSchema = z.number().int().nonnegative().max(1_000_000);

/**
 * A declared-stock map.
 *
 * Keyed by product UUID, so a malformed key is refused before it reaches a
 * query. Capped at 500 entries: the shop has tens of products, and an
 * unbounded map is an unbounded transaction.
 */
export const declaredSchema = z.record(z.uuid(), gramsSchema).refine(
  (d) => Object.keys(d).length <= 500,
  { message: 'too many products' },
);
