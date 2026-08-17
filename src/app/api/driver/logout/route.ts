import { NextResponse } from 'next/server';

import { DRIVER_SESSION_COOKIE, driverCookieOptions } from '@/auth/driver-session';

/**
 * Sign the driver out.
 *
 * POST rather than GET, so a prefetch, a crawler or an `<img>` tag on another
 * site cannot sign somebody out mid-round. It is a state change.
 *
 * Deliberately unguarded: signing out must work even when the session is
 * already invalid, and refusing to clear a cookie because the cookie is bad is
 * the wrong way round.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(DRIVER_SESSION_COOKIE, '', driverCookieOptions(0));
  return response;
}
