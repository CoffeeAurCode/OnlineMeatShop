import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  CUSTOMER_SESSION_COOKIE,
  customerCookieOptions,
  readCustomerSession,
} from '@/auth/customer-session';
import { recentOrdersForPhone } from '@/db/repositories/tracking';

/**
 * Who is signed in, and what have they ordered.
 *
 * ⚠ THE PHONE NUMBER COMES FROM THE SIGNED COOKIE, NEVER FROM THE REQUEST.
 *
 * This is the whole security property of the endpoint and it is one line
 * (`session.payload.phone`). The previous version took a phone number and a
 * code in the body and looked up whatever number it was handed; it was safe
 * only because the verifier refused to exist in production, which meant the
 * feature did not exist either. Reading the number out of a token this server
 * signed is what lets the feature exist and stay safe at the same time.
 *
 * ⚠ NO PARAMETER SELECTS WHOSE ORDERS TO RETURN, and none may ever be added.
 * The moment this accepts `?phone=`, it is an order-history lookup for anybody
 * who knows a number.
 *
 * GET, not POST, because it changes nothing. The one exception is the expired
 * case below, which clears a cookie that is already useless.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const jar = await cookies();
  const token = jar.get(CUSTOMER_SESSION_COOKIE)?.value;

  const session = readCustomerSession(token, Date.now());
  if (!session.ok) {
    const response = NextResponse.json({ signedIn: false, reason: session.reason }, { status: 200 });
    /*
     * A stale or tampered cookie is cleared rather than left to be re-sent on
     * every request for the next thirty days. `maxAge: 0` with the same
     * attributes is the only reliable way to delete it — a `Set-Cookie` whose
     * path or `secure` flag differs from the original creates a SECOND cookie
     * and leaves the first exactly where it was.
     */
    if (session.reason !== 'notConfigured') {
      response.cookies.set(CUSTOMER_SESSION_COOKIE, '', customerCookieOptions(0));
    }
    return response;
  }

  const orders = await recentOrdersForPhone(session.payload.phone);

  return NextResponse.json({
    signedIn: true,
    phone: session.payload.phone,
    orders,
  });
}

/** Sign out. Clears the cookie and nothing else — no server-side state exists. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(CUSTOMER_SESSION_COOKIE, '', customerCookieOptions(0));
  return response;
}
