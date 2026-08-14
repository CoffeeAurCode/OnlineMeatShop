import { NextResponse } from 'next/server';
import { z } from 'zod';

import { phoneVerifier, verificationAvailable } from '@/adapters/phone-verifier';
import { normalisePhone } from '@/db/repositories/customers';
import { recentOrdersForPhone } from '@/db/repositories/tracking';

/**
 * Unlock "my orders" for a phone number.
 *
 * ⚠ THIS IS THE UNVERIFIED SEAM, and it is the reason `/orders` needs a code
 * while `/orders/[token]` does not. Tracking is gated on an unguessable token
 * that only the person who placed the order has; this endpoint is gated on
 * knowing a phone number, which is not a secret.
 *
 * ⭐ IT RETURNS THE ORDERS DIRECTLY RATHER THAN SETTING A SESSION COOKIE.
 * A cookie would be a durable credential minted from an unverified claim, and
 * it would outlive the page. Returning the list once, for this request only,
 * keeps the blast radius of the stub exactly as small as it can be: no
 * persistent identity is ever created from an unproven number.
 *
 * `verificationAvailable()` is checked FIRST, so a deployment without a
 * verifier answers "not available" rather than reaching a stub that would
 * throw. The stub itself refuses to construct in production regardless.
 */
const schema = z.object({
  phone: z.string().min(7).max(40),
  code: z.string().min(1).max(12),
});

export async function POST(request: Request) {
  if (!verificationAvailable()) {
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

  const orders = await recentOrdersForPhone(phoneE164);
  return NextResponse.json({ ok: true, orders });
}
