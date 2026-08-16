import { NextResponse } from 'next/server';
import { z } from 'zod';

import { phoneVerifier, verificationAvailable, verificationIsReal } from '@/adapters/phone-verifier';
import { normalisePhone } from '@/domain/phone';

/**
 * Step one of signing in: text a code to a number.
 *
 * ══ THE THING THIS ENDPOINT MUST NOT DO ═══════════════════════════════════
 *
 * ⚠ IT MUST NOT REVEAL WHETHER A NUMBER IS KNOWN TO THE SHOP.
 *
 * "Send code" and "Sign up" are the same button on the storefront for exactly
 * this reason (the sheet says "Sign in or sign up"). An endpoint that answers
 * differently for a returning customer than for a new one turns the phone
 * field into a lookup tool: type numbers, learn who shops here. So the success
 * response is identical either way and carries nothing about the account.
 *
 * ══ WHAT STOPS THIS BEING AN SMS PUMP ═════════════════════════════════════
 *
 * ⚠ AN UNMETERED OTP ENDPOINT IS A FRAUD TARGET THAT BILLS THE SHOP FOR THE
 * ATTACK — traffic pumping means driving thousands of texts to numbers on a
 * network that pays the attacker a share.
 *
 * The bound is Supabase's, and it is a real bound rather than a hope: 30 SMS
 * per hour for the whole project, and one per number per five seconds. That
 * caps a flood at roughly 30 messages an hour no matter how the caller behaves,
 * because it is enforced where the money is spent rather than in front of it.
 * A 429 from there is passed through as `tooSoon`, which is a WAIT and not a
 * failure — telling somebody to retry is useless if the screen calls it an
 * error.
 *
 * ⭐ There is deliberately no second throttle in this file. A per-IP counter in
 * process memory is worthless on a host that restarts and forgets it, and a
 * database-backed one would be a second, weaker copy of a limit that already
 * works. If this ever needs tightening, tighten it in the Supabase project.
 */

export const dynamic = 'force-dynamic';

const schema = z.object({
  phone: z.string().min(5).max(40),
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
  if (phoneE164 === null) {
    return NextResponse.json({ reason: 'invalidPhone' }, { status: 400 });
  }

  const result = await phoneVerifier().start(phoneE164);
  if (!result.ok) {
    return NextResponse.json(
      { reason: result.reason },
      // `tooSoon` is a wait, so it gets 429 and the screen counts down.
      // Everything else is 400: the number itself is the problem.
      { status: result.reason === 'tooSoon' ? 429 : 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    /** The normalised form, so the screen can show what was actually texted. */
    phone: phoneE164,
    /**
     * Whether a code was really sent, or whether this deployment is using the
     * fixed development one. Said on the screen, not only in a comment —
     * nobody using this should have to guess whether their phone will buzz.
     */
    real: verificationIsReal(),
  });
}
