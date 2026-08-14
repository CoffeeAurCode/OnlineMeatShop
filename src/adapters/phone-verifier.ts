import 'server-only';

/**
 * Phone verification, as a seam.
 *
 * ⚠ NOTHING IS VERIFIED IN THIS PROTOTYPE. `StubPhoneVerifier` accepts a fixed
 * development code. That is only tolerable because of what does NOT hang off
 * it: order TRACKING is gated on `order.public_token`, not on identity, so the
 * one thing this protects is the "my orders" list.
 *
 * ══ WHY THIS INTERFACE EXISTS NOW RATHER THAN LATER ═══════════════════════
 *
 * `TwilioPhoneVerifier` implements the same two methods and that is the whole
 * change. `customer.phone_verified_at` already exists and is already NULL for
 * every row, which is what tells a future reader that no verification
 * happened rather than leaving that fact recorded nowhere.
 *
 * Twilio VERIFY, not raw SMS, when it comes. Verify owns code generation,
 * expiry, retry limits and fraud signals; rolling our own means storing hashed
 * codes with expiry and building rate limiting we would get wrong. Rate limit
 * per phone AND per IP, and cap attempts per code: an unmetered OTP endpoint is
 * an SMS-pumping fraud target that bills you for the attack.
 *
 * ⚠ This reverses D18, which cut SMS at launch. `02-DTM` §4.5.3 needs amending,
 * and A2P/regulatory registration has weeks of lead time.
 */

export interface PhoneVerifier {
  readonly name: string;
  /** Begin verification. Returns false when the number is unusable. */
  start(phoneE164: string): Promise<boolean>;
  check(phoneE164: string, code: string): Promise<boolean>;
}

/**
 * The development stand-in. Accepts one fixed code for every number.
 *
 * The code is read from the environment rather than hardcoded, so that a
 * checked-out repository does not itself contain the value that unlocks order
 * history on somebody's dev box.
 */
export class StubPhoneVerifier implements PhoneVerifier {
  readonly name = 'stub';

  constructor(private readonly code: string) {}

  async start(): Promise<boolean> {
    // Nothing is sent. The UI says so.
    return true;
  }

  async check(_phoneE164: string, code: string): Promise<boolean> {
    // Not timing-safe, and it does not need to be: this comparison only exists
    // in development, and the value it protects is a list of test orders.
    return code.trim() === this.code;
  }
}

/**
 * ⭐ THE STUB MUST BE IMPOSSIBLE TO ENABLE IN PRODUCTION.
 *
 * A development backdoor that survives to production is the single most common
 * way this class of prototype becomes an incident, so this refuses at STARTUP
 * rather than at the first request. Same fail-closed shape as the admin guard
 * and the payment adapter, for the same reason: an application that cannot
 * verify must not boot pretending it can.
 *
 * Note what is NOT offered: there is no `ALLOW_STUB_VERIFIER` escape hatch to
 * match the payments one. A no-money demo deployment is a coherent thing to
 * want; a deployment that hands out other people's order history to anyone who
 * knows the dev code is not.
 */
export function phoneVerifier(): PhoneVerifier {
  const code = process.env.DEV_VERIFICATION_CODE;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'No real phone verifier is configured. StubPhoneVerifier accepts a fixed ' +
        'development code and must never be reachable in production. Configure ' +
        'Twilio Verify before enabling order history.',
    );
  }

  if (code === undefined || code === '') {
    throw new Error('DEV_VERIFICATION_CODE is not set, so order history cannot be unlocked.');
  }

  return new StubPhoneVerifier(code);
}

/** Whether order history is available at all on this deployment. */
export function verificationAvailable(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.DEV_VERIFICATION_CODE !== undefined &&
    process.env.DEV_VERIFICATION_CODE !== ''
  );
}
