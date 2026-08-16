import { NextResponse } from 'next/server';
import { z } from 'zod';

import { phoneVerifier, verificationAvailable } from '@/adapters/phone-verifier';
import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_TTL_MS,
  customerCookieOptions,
  customerSessionsConfigured,
  issueCustomerSession,
} from '@/auth/customer-session';
import { findOrCreateCustomerByPhone, markPhoneVerified } from '@/db/repositories/customers';
import { recentOrdersForPhone } from '@/db/repositories/tracking';
import { normalisePhone } from '@/domain/phone';

/**
 * Step two: the code comes back, and the customer is signed in.
 *
 * ══ WHAT THIS REPLACED, AND WHY THE OLD COMMENT WAS RIGHT ═════════════════
 *
 * The endpoint this grew out of returned the order list for ONE request and
 * refused to set a cookie, with a comment that read:
 *
 *     "A cookie would be a durable credential minted from an unverified claim."
 *
 * ⭐ CORRECT REASONING, PREMISE NOW FALSE. A code was texted to the number and
 * typed back. Durability on top of nothing was the objection; durability on
 * top of a proven number is a login, which is what the shop asked for.
 *
 * ══ THE ORDER OF OPERATIONS, AND WHY ══════════════════════════════════════
 *
 *   1. check the code                     (the provider, no database yet)
 *   2. find or create the customer row    (one statement, upsert)
 *   3. stamp `phone_verified_at`
 *   4. sign a cookie
 *
 * ⚠ NOTHING IS WRITTEN BEFORE STEP 1. A wrong code must leave no trace: an
 * endpoint that creates a customer row and then rejects the code lets anybody
 * populate the table by typing numbers, and turns "how many customers does
 * this shop have" into a meaningless figure.
 *
 * ⚠ AND THE CUSTOMER ROW IS CREATED HERE, NOT ONLY AT CHECKOUT. Somebody may
 * sign in to look at an empty history before they ever buy anything. Their row
 * exists with `phone_verified_at` set and no orders, which is a perfectly
 * coherent state and the one thing that makes `/orders` work on a new phone.
 */

export const dynamic = 'force-dynamic';

const schema = z.object({
  phone: z.string().min(5).max(40),
  // Supabase issues six digits; the range is wider so a provider change or a
  // stub code does not need this file edited.
  code: z.string().trim().min(4).max(12),
});

export async function POST(request: Request) {
  if (!verificationAvailable()) {
    return NextResponse.json({ reason: 'notAvailable' }, { status: 503 });
  }
  if (!customerSessionsConfigured()) {
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
  // number shapes the shop accepts.
  if (phoneE164 === null) return NextResponse.json({ reason: 'wrongCode' }, { status: 401 });

  const ok = await phoneVerifier().check(phoneE164, parsed.data.code);
  if (!ok) return NextResponse.json({ reason: 'wrongCode' }, { status: 401 });

  const now = Date.now();
  const customerId = await findOrCreateCustomerByPhone(phoneE164, null, null);
  await markPhoneVerified(phoneE164, now);

  const token = issueCustomerSession(customerId, phoneE164, now);
  if (token === null) return NextResponse.json({ reason: 'notAvailable' }, { status: 503 });

  const orders = await recentOrdersForPhone(phoneE164);

  const response = NextResponse.json({ ok: true, phone: phoneE164, orders });
  response.cookies.set(
    CUSTOMER_SESSION_COOKIE,
    token,
    customerCookieOptions(Math.floor(CUSTOMER_SESSION_TTL_MS / 1000)),
  );
  return response;
}
