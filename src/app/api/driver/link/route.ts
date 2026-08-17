import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hashDriverLinkToken } from '@/auth/driver-link';
import {
  DRIVER_SESSION_COOKIE,
  DRIVER_SESSION_TTL_MS,
  driverCookieOptions,
  driverSessionsConfigured,
  issueDriverSession,
} from '@/auth/driver-session';
import { consumeDriverLink } from '@/db/repositories/driver';
import { activePartnerById } from '@/db/repositories/partners';

/**
 * Spend a dispatch link and sign the driver in.
 *
 * ══ THE ORDER OF OPERATIONS ═══════════════════════════════════════════════
 *
 *   1. spend the link      (ONE conditional UPDATE — this is the single-use rule)
 *   2. re-check the roster (the cookie is about to be minted)
 *   3. sign the cookie
 *
 * ⚠ SPENDING COMES FIRST, AND THE ORDER IS NOT ARBITRARY. Checking the roster
 * first would leave a window in which two requests both pass the check and race
 * for the token; putting the atomic step first means at most one of them ever
 * reaches step 2. The cost is that a link belonging to a just-deactivated
 * driver is burned on refusal — which is the right direction, because that link
 * should never work again anyway.
 *
 * ⚠ POST ONLY. A GET here would be spent by any link-preview bot that fetches
 * the URL out of the SMS, and the driver would find a dead link every time. See
 * `peekDriverLink`.
 */

export const dynamic = 'force-dynamic';

const schema = z.object({
  // base64url of 32 bytes is 43 characters; the bound is loose either side so a
  // future token length is not a schema change.
  token: z.string().trim().min(20).max(200),
});

export async function POST(request: Request) {
  if (!driverSessionsConfigured()) {
    return NextResponse.json({ reason: 'notAvailable' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ reason: 'malformedBody' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ reason: 'invalidBody' }, { status: 400 });

  const link = await consumeDriverLink(hashDriverLinkToken(parsed.data.token), Date.now());
  if (link.state !== 'valid') {
    return NextResponse.json({ reason: link.state }, { status: link.state === 'unknown' ? 404 : 409 });
  }

  // ⭐ The database has the final word on WHETHER, exactly as it does on every
  // other driver request. A link is an identity claim, never a permission.
  const partner = await activePartnerById(link.partnerId);
  if (partner === null) {
    return NextResponse.json({ reason: 'deactivated' }, { status: 403 });
  }

  const token = issueDriverSession(partner.id, partner.phone, Date.now());
  if (token === null) return NextResponse.json({ reason: 'notAvailable' }, { status: 503 });

  /*
   * Land on the job the text was about, when there is one.
   *
   * ⚠ THE SESSION IS NOT SCOPED TO THAT ORDER, and it cannot be. The client
   * asked for a screen showing ALL of a driver's jobs, so the credential
   * identifies the PERSON — which means signing in through a link about one
   * order still reaches every order assigned to them. That is the requirement,
   * not a leak, and it is why the link is single-use and short-lived.
   */
  const to = link.orderId === null ? '/driver' : `/driver/${link.orderId}`;

  const response = NextResponse.json({ ok: true, to, name: partner.name });
  response.cookies.set(
    DRIVER_SESSION_COOKIE,
    token,
    driverCookieOptions(Math.floor(DRIVER_SESSION_TTL_MS / 1000)),
  );
  return response;
}
