import 'server-only';

import { cookies } from 'next/headers';

import {
  DRIVER_SESSION_COOKIE,
  driverSessionsConfigured,
  readDriverSession,
} from '@/auth/driver-session';
import { activePartnerById } from '@/db/repositories/partners';

/**
 * ⭐ THE DRIVER PORTAL'S ONLY DOOR. It fails closed, exactly like the console's.
 *
 * ══ THE RULE THAT IS NOT NEGOTIABLE, RESTATED ═════════════════════════════
 *
 * ⚠ THE COOKIE SAYS WHO, THE DATABASE SAYS WHETHER.
 *
 * `activePartnerById` runs on EVERY call and its result is not cached. A
 * signed cookie describes what was true when it was signed; a driver who left
 * on Friday must be locked out on Friday, not thirty days later when their
 * token expires. That is the whole revocation story for this surface, and it
 * is why the roster's `active` flag is load-bearing rather than cosmetic.
 *
 * ⚠ Do not put the driver's name in the cookie and read it from there. It is
 * read from the row, for the same reason the staff role is.
 */

export type DriverRefusalReason =
  | 'notConfigured'
  | 'noSession'
  | 'badSession'
  | 'expired'
  | 'unknownPartner'
  | 'deactivated';

export interface DriverContext {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
}

export async function checkDriver(): Promise<
  | { readonly ok: true; readonly driver: DriverContext }
  | { readonly ok: false; readonly reason: DriverRefusalReason }
> {
  // Checked first, so a deployment with no secret refuses everything rather
  // than refusing further down for a subtler reason that reads like a bug.
  if (!driverSessionsConfigured()) return { ok: false, reason: 'notConfigured' };

  const jar = await cookies();
  const token = jar.get(DRIVER_SESSION_COOKIE)?.value;

  const session = readDriverSession(token, Date.now());
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

  /*
   * ⭐ The database has the final word.
   *
   * `activePartnerById` returns null for BOTH an unknown id and a deactivated
   * one, which is deliberate: the two are the same answer to the only question
   * being asked, and distinguishing them here would mean a second query to
   * produce a distinction the screen must not show anyway.
   */
  const row = await activePartnerById(session.payload.sub);
  if (row === null) return { ok: false, reason: 'deactivated' };

  return { ok: true, driver: { id: row.id, name: row.name, phone: row.phone } };
}

/** Throwing form, for route handlers. Every driver mutation calls this first. */
export async function requireDriver(): Promise<DriverContext> {
  const result = await checkDriver();
  if (!result.ok) throw new DriverRefused(result.reason);
  return result.driver;
}

export class DriverRefused extends Error {
  constructor(readonly reason: DriverRefusalReason) {
    super(`driver refused: ${reason}`);
    this.name = 'DriverRefused';
  }
}
