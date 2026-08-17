import { NextResponse } from 'next/server';

import { hashDriverLinkToken } from '@/auth/driver-link';
import {
  DRIVER_SESSION_COOKIE,
  DRIVER_SESSION_TTL_MS,
  driverCookieOptions,
  driverSessionsConfigured,
  issueDriverSession,
} from '@/auth/driver-session';
import { resolveDriverLink } from '@/db/repositories/driver';
import { activePartnerById } from '@/db/repositories/partners';

/**
 * The link in the dispatch SMS. Tap it, and you are in.
 *
 * ══ A ROUTE HANDLER, NOT A PAGE, AND THAT IS FORCED ═══════════════════════
 *
 * ⚠ A SERVER COMPONENT CANNOT SET A COOKIE DURING RENDER. Next only allows it
 * from a Route Handler or a Server Action, and this has to set the driver's
 * session cookie — so the whole thing is a `GET` handler that redirects.
 *
 * An earlier version was a page with an "Open my deliveries" button, because
 * the link was single-use and a link-preview bot fetching the URL would have
 * burned it. ⭐ THE CLIENT REMOVED SINGLE USE ON 2026-08-17, so the reason for
 * that extra tap went with it — a preview fetch now costs nothing, the link
 * stays valid, and the driver gets the one tap they were promised.
 *
 * ══ IT LIVES OUTSIDE `/driver`, AND IT HAS TO ═════════════════════════════
 *
 * Everything under `/driver` is behind a layout that renders a sign-in form
 * when there is no session, and a link whose entire purpose is to CREATE that
 * session cannot sit behind it. `/d/` is also nine characters shorter than
 * `/driver/link/`, which is billed — the dispatch message is already several
 * SMS segments.
 *
 * ══ WHAT BOUNDS THIS LINK ═════════════════════════════════════════════════
 *
 * ⚠ TIME, AND THE ROSTER. Twelve hours, and `delivery_partner.active` checked
 * here and again on every request afterwards. It is deliberately NOT single
 * use: a driver who reopens their own text must not be locked out. A forwarded
 * text therefore works until it expires, which is an accepted trade rather
 * than an oversight.
 */

export const dynamic = 'force-dynamic';

/**
 * Redirect to a path on this same site.
 *
 * ══ WHY THIS DOES NOT USE `NextResponse.redirect(new URL(path, request.url))`
 *
 * 🔴 THAT IS WHAT IT DID, AND IT WAS BROKEN IN PRODUCTION AND ONLY IN
 * PRODUCTION. Behind Render's proxy the app sees its own bound address, not
 * the public one, so `request.url` is `http://localhost:10000/...` and every
 * redirect went to `https://localhost:10000/d/expired`. Measured against the
 * deployed site, which is the only place it shows:
 *
 *     /d/<token>  ->  303  Location: https://localhost:10000/d/expired
 *
 * Locally, and in every test, `request.url` is the real origin and the bug is
 * invisible. **The link feature was therefore completely dead on the deployed
 * site while passing everything.**
 *
 * ⭐ A RELATIVE `Location` IS THE FIX, and it is better than the alternatives
 * rather than merely shorter. Reconstructing the origin from
 * `x-forwarded-host` means trusting a header a client can send; reading it
 * from `NEXT_PUBLIC_SITE_ORIGIN` means a redirect that breaks when an
 * environment variable is unset. A relative Location has been legal since
 * RFC 7231 §7.1.2, is resolved by the browser against the address bar, and
 * cannot be wrong about the host because it never states one.
 *
 * ⚠ `NextResponse.redirect()` REQUIRES AN ABSOLUTE URL and will throw on a
 * relative one, which is why this constructs the response by hand.
 */
function back(path: string): NextResponse {
  return new NextResponse(null, {
    /*
     * ⚠ 303, NOT THE DEFAULT 307. A 307 preserves the method and invites a
     * browser or a scanner to treat the redirect as repeatable against the
     * original URL. 303 says plainly: the answer is somewhere else, go and
     * GET it.
     */
    status: 303,
    headers: { Location: path },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!driverSessionsConfigured()) return back('/d/expired');

  const link = await resolveDriverLink(hashDriverLinkToken(token));
  /*
   * ⚠ EXPIRED AND UNKNOWN GO TO THE SAME PLACE. Unlike the failure states on a
   * sign-in form, there is nothing useful to distinguish here: both mean "this
   * link will not work, sign in with your number", and that page says so.
   */
  if (link.state !== 'valid') return back('/d/expired');

  // ⭐ The database has the final word on WHETHER. A link minted on Tuesday for
  // somebody taken off the roster on Wednesday must not work.
  const partner = await activePartnerById(link.partnerId);
  if (partner === null) return back('/d/expired');

  const session = issueDriverSession(partner.id, partner.phone, Date.now());
  if (session === null) return back('/d/expired');

  /*
   * Land on the job the text was about.
   *
   * ⚠ THE SESSION IS NOT SCOPED TO THAT ORDER, and it cannot be. The client
   * asked for a screen showing ALL of a driver's jobs, so the credential
   * identifies the PERSON — which means arriving through a link about one order
   * still reaches every order assigned to them. That is the requirement, not a
   * leak.
   */
  const response = back(link.orderId === null ? '/driver' : `/driver/${link.orderId}`);
  response.cookies.set(
    DRIVER_SESSION_COOKIE,
    session,
    driverCookieOptions(Math.floor(DRIVER_SESSION_TTL_MS / 1000)),
  );
  return response;
}
