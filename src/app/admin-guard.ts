import 'server-only';

import { cookies } from 'next/headers';

/**
 * 🔴 THE CONSOLE'S ONLY DOOR — AND IT IS NOT THE REAL ONE YET.
 *
 * The designed authorisation model is Supabase Auth plus a `staff(user_id,
 * role, active)` table, with the role re-checked server-side against that
 * table on every admin mutation — never from a JWT claim, because a claim can
 * outlive the staff member it describes.
 *
 * NONE OF THAT EXISTS YET. There is no `staff` table, no session, and no login
 * route, and the table cannot be added right now because the migration journal
 * carries a defect that makes the next migration silently no-op.
 *
 * So this guard is a placeholder with one property that matters: **it fails
 * closed in production.** With no `ADMIN_PREVIEW_TOKEN` set, or with
 * `NODE_ENV=production`, every admin route and every admin mutation is refused.
 * The console is reachable only in development and test, against a token the
 * operator sets themselves.
 *
 * ⚠ DO NOT relax this into "check a cookie and trust it" and call it done. The
 * replacement is: read the Supabase session, look the user up in `staff`,
 * require `active`, and cache nothing. Until then an unauthenticated console is
 * a worse outcome than an unavailable one — it edits stock and money.
 */

export type StaffRefusal = 'notConfigured' | 'productionDisabled' | 'noToken' | 'badToken';

export const ADMIN_COOKIE = 'admin_preview';

export interface StaffContext {
  /** Always `operator` today. Becomes the real role once `staff` exists. */
  readonly role: 'operator' | 'admin';
  /** True while this guard is the placeholder rather than the designed one. */
  readonly provisional: true;
}

/**
 * Non-throwing form, for layouts that want to render an explanation rather
 * than a stack trace.
 */
export async function checkStaff(): Promise<
  { readonly ok: true; readonly staff: StaffContext } | { readonly ok: false; readonly reason: StaffRefusal }
> {
  // Production is refused before anything else is even read, so that a
  // mis-set environment variable cannot open the console by accident.
  if (process.env.NODE_ENV === 'production') {
    return { ok: false, reason: 'productionDisabled' };
  }

  const expected = process.env.ADMIN_PREVIEW_TOKEN;
  if (expected === undefined || expected === '') {
    return { ok: false, reason: 'notConfigured' };
  }

  const jar = await cookies();
  const presented = jar.get(ADMIN_COOKIE)?.value;
  if (presented === undefined || presented === '') return { ok: false, reason: 'noToken' };
  if (!timingSafeEqual(presented, expected)) return { ok: false, reason: 'badToken' };

  return { ok: true, staff: { role: 'operator', provisional: true } };
}

/** Throwing form, for route handlers. Every admin mutation calls this first. */
export async function requireStaff(): Promise<StaffContext> {
  const result = await checkStaff();
  if (!result.ok) throw new StaffRefused(result.reason);
  return result.staff;
}

export class StaffRefused extends Error {
  constructor(readonly reason: StaffRefusal) {
    super(`admin refused: ${reason}`);
    this.name = 'StaffRefused';
  }
}

/**
 * Length-independent comparison.
 *
 * `node:crypto`'s `timingSafeEqual` throws on a length mismatch, which leaks
 * the length through the error path. Comparing every byte of the longer of the
 * two and folding the length difference in avoids both problems without
 * needing the import.
 */
function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
