import { NextResponse } from 'next/server';
import { z } from 'zod';

import { phoneVerifier, verificationAvailable } from '@/adapters/phone-verifier';
import {
  DRIVER_SESSION_COOKIE,
  DRIVER_SESSION_TTL_MS,
  driverCookieOptions,
  driverSessionsConfigured,
  issueDriverSession,
} from '@/auth/driver-session';
import { activePartnerByPhone } from '@/db/repositories/partners';
import { normalisePhone } from '@/domain/phone';

/**
 * Step two: the code comes back and the driver is signed in.
 *
 * ══ THE ORDER OF OPERATIONS ═══════════════════════════════════════════════
 *
 *   1. check the code        (the provider — no database, nothing written)
 *   2. look the number up on the ACTIVE roster
 *   3. sign a cookie carrying the partner id
 *
 * ⚠ THE ROSTER IS CHECKED AGAIN HERE, AFTER `/api/driver/otp` ALREADY DID.
 * That is not redundant. The two calls are separated by however long somebody
 * takes to read a text message, and a driver deactivated in that window must
 * not receive a thirty-day session. Checking only at the point a credential is
 * MINTED is the check that matters; the earlier one exists to save an SMS.
 *
 * ⚠ NOTHING IS WRITTEN, EVER. Unlike the customer's verify endpoint, this one
 * creates no row: a driver exists because the owner added them to the roster,
 * and a sign-in that could create one would let anybody who can receive a text
 * put themselves on it.
 */

export const dynamic = 'force-dynamic';

const schema = z.object({
  phone: z.string().min(5).max(40),
  code: z.string().trim().min(4).max(12),
});

export async function POST(request: Request) {
  if (!verificationAvailable()) {
    return NextResponse.json({ reason: 'notAvailable' }, { status: 503 });
  }
  if (!driverSessionsConfigured()) {
    // No signing secret means no session can be minted. Refusing is the only
    // safe answer; signing with a fallback key would be signing with none.
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

  const phoneE164 = normalisePhone(parsed.data.phone);
  // The same answer as a wrong code, so this cannot be used to probe which
  // number shapes are accepted.
  if (phoneE164 === null) return NextResponse.json({ reason: 'wrongCode' }, { status: 401 });

  const ok = await phoneVerifier().check(phoneE164, parsed.data.code);
  if (!ok) return NextResponse.json({ reason: 'wrongCode' }, { status: 401 });

  // ⭐ Re-checked at the moment the credential is minted. See the header.
  const partner = await activePartnerByPhone(phoneE164);
  if (partner === null) return NextResponse.json({ reason: 'notOnRoster' }, { status: 403 });

  const token = issueDriverSession(partner.id, phoneE164, Date.now());
  if (token === null) return NextResponse.json({ reason: 'notAvailable' }, { status: 503 });

  const response = NextResponse.json({ ok: true, name: partner.name });
  response.cookies.set(
    DRIVER_SESSION_COOKIE,
    token,
    driverCookieOptions(Math.floor(DRIVER_SESSION_TTL_MS / 1000)),
  );
  return response;
}
