import 'server-only';

import { cookies } from 'next/headers';

import { activeStaffById } from '@/db/repositories/staff';
import { SESSION_COOKIE, readSession, sessionsConfigured } from '@/auth/session';

/**
 * ⭐ THE CONSOLE'S ONLY DOOR, and it is now the real one.
 *
 * This replaced a placeholder that compared a preview token and refused
 * outright in production. The property that mattered about the placeholder is
 * kept exactly: IT FAILS CLOSED. A missing signing secret, an unknown staff
 * id, a deactivated account, a bad signature or an expired token all refuse.
 * Nothing here has a fallback that lets somebody in.
 *
 * ══ THE RULE THAT IS NOT NEGOTIABLE ═══════════════════════════════════════
 *
 * ⚠ THE COOKIE SAYS WHO, THE DATABASE SAYS WHETHER.
 *
 * `activeStaffById` runs on EVERY call, and its result is not cached. A signed
 * cookie describes what was true when it was signed; deactivating a staff
 * member has to take effect now, not when a twelve hour token expires. Caching
 * this "for performance" would reintroduce exactly the gap the check exists to
 * close, and the cost is one indexed primary-key lookup.
 *
 * ⚠ Do not add a `role` field to the cookie and read it from there. The role
 * is read from the row, for the same reason.
 */

export type StaffRefusal =
  | 'notConfigured'
  | 'noSession'
  | 'badSession'
  | 'expired'
  | 'unknownStaff'
  | 'deactivated';

export interface StaffContext {
  readonly id: string;
  readonly username: string;
  readonly role: 'OWNER' | 'STAFF';
}

/**
 * Non-throwing form, for layouts that want to render an explanation or a login
 * form rather than a stack trace.
 */
export async function checkStaff(): Promise<
  { readonly ok: true; readonly staff: StaffContext } | { readonly ok: false; readonly reason: StaffRefusal }
> {
  // Checked first so a deployment with no secret refuses everything, rather
  // than refusing for some subtler reason further down that reads like a bug.
  if (!sessionsConfigured()) return { ok: false, reason: 'notConfigured' };

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const session = readSession(token, Date.now());
  if (!session.ok) {
    return {
      ok: false,
      reason:
        session.reason === 'expired'
          ? 'expired'
          : session.reason === 'notConfigured'
            ? 'notConfigured'
            : token === undefined || token === ''
              ? 'noSession'
              : 'badSession',
    };
  }

  // ⭐ The database has the final word. See the header.
  const row = await activeStaffById(session.payload.sub);
  if (row === null) return { ok: false, reason: 'unknownStaff' };

  return { ok: true, staff: { id: row.id, username: row.username, role: row.role } };
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
