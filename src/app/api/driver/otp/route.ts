import { NextResponse } from 'next/server';
import { z } from 'zod';

import { phoneVerifier, verificationAvailable, verificationIsReal } from '@/adapters/phone-verifier';
import { activePartnerByPhone } from '@/db/repositories/partners';
import { normalisePhone } from '@/domain/phone';

/**
 * Step one of a driver signing in: text a code to a number on the roster.
 *
 * ══ WHY THIS CHECKS THE ROSTER FIRST, WHEN `/api/auth/otp` DELIBERATELY
 *    DOES NOT CHECK ANYTHING ═══════════════════════════════════════════════
 *
 * The customer endpoint must NOT reveal whether a number is known to the shop
 * — an endpoint that answers differently for a returning customer turns the
 * phone field into a lookup tool: type numbers, learn who shops here.
 *
 * ⭐ THIS ONE MAKES THE OPPOSITE TRADE, ON PURPOSE, AND THE REASONING IS NOT
 * TRANSFERABLE BETWEEN THEM.
 *
 * What leaks here is roster membership for a shop with a handful of drivers,
 * which is close to public — they wear the shop's name to somebody's door. What
 * is spent by NOT checking is the shop's SMS budget: Supabase caps the whole
 * project at 30 messages an hour, so an unmetered driver endpoint lets anybody
 * exhaust the same bucket the CUSTOMER sign-in draws from. The cost of the leak
 * is negligible; the cost of the flood is that no customer can sign in.
 *
 * ⚠ SO THE ASYMMETRY IS DELIBERATE AND MUST NOT BE "MADE CONSISTENT" LATER.
 * Making this endpoint silent would re-open the flood; making the customer
 * endpoint talkative would re-open the enumeration.
 */

export const dynamic = 'force-dynamic';

const schema = z.object({ phone: z.string().min(5).max(40) });

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
  if (phoneE164 === null) {
    return NextResponse.json({ reason: 'invalidPhone' }, { status: 400 });
  }

  // ⭐ Before any SMS is spent. See the header for why this is the one OTP
  // endpoint in the application that looks the number up first.
  const partner = await activePartnerByPhone(phoneE164);
  if (partner === null) {
    return NextResponse.json({ reason: 'notOnRoster' }, { status: 403 });
  }

  const result = await phoneVerifier().start(phoneE164);
  if (!result.ok) {
    return NextResponse.json(
      { reason: result.reason },
      { status: result.reason === 'tooSoon' ? 429 : 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    phone: phoneE164,
    /** Whether a code was really sent, or this deployment uses a fixed one. */
    real: verificationIsReal(),
  });
}
