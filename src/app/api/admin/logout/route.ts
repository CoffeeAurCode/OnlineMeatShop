import { NextResponse } from 'next/server';

import { SESSION_COOKIE, sessionCookieOptions } from '@/auth/session';

/**
 * Sign out.
 *
 * POST rather than GET, so that a prefetch, a crawler, or an `<img>` tag on
 * some other site cannot sign the operator out. It is a state change.
 *
 * Deliberately unguarded: signing out must work even when the session is
 * already invalid, and refusing to clear a cookie because the cookie is bad is
 * the wrong way round.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
  return response;
}
