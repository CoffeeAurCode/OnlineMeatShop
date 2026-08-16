import 'server-only';

/**
 * Phone verification, as a seam — and it is now REAL.
 *
 * ══ WHAT CHANGED, AND WHY IT MATTERED MORE THAN IT LOOKED ═════════════════
 *
 * This file used to say "NOTHING IS VERIFIED IN THIS PROTOTYPE", and the one
 * thing it protected was the "my orders" list. `phoneVerifier()` threw in
 * production, so `verificationAvailable()` was false, so `/orders` rendered
 * "Something went wrong. Try again." to every customer who had ever placed an
 * order — including the owner, looking at their own two test orders and
 * reasonably concluding the site was broken.
 *
 * ⭐ IT WAS NOT BROKEN. IT WAS CORRECT AND USELESS, which is a worse place to
 * be than broken, because nothing alerts on it.
 *
 * ══ SUPABASE AUTH, NOT TWILIO VERIFY ══════════════════════════════════════
 *
 * The old comment here specified Twilio Verify. The implementation is Supabase
 * Auth's phone provider, which is Twilio underneath — the project's provider is
 * configured as Twilio with a messaging service. The reasoning that pointed at
 * Verify still applies and is satisfied: SOMEBODY ELSE owns code generation,
 * expiry, retry limits and rate limiting, rather than this codebase storing
 * hashed codes and building throttling it would get wrong.
 *
 * ⚠ AN UNMETERED OTP ENDPOINT IS AN SMS-PUMPING FRAUD TARGET THAT BILLS YOU
 * FOR THE ATTACK. The limits that bound it are set on the Supabase project,
 * not here: 30 SMS/hour and one per number per 5 seconds. That caps a flood at
 * roughly 30 messages an hour whatever the caller does, which is the property
 * that matters. **If you raise those limits, you are raising the ceiling on
 * someone else's attack, not on your customers' convenience.**
 *
 * ══ WHY NO `@supabase/supabase-js` ════════════════════════════════════════
 *
 * ⭐ THIS IS TWO `fetch` CALLS AGAINST GOTRUE'S REST API, AND THE TOKEN NEVER
 * REACHES THE BROWSER.
 *
 * The SDK's shape is browser-first: it puts a Supabase session in
 * `localStorage` and hands the page a JWT. That would create a SECOND identity
 * system next to the staff cookie, with its own refresh rules, its own storage
 * and its own expiry, for an app whose only use of it is "is this number
 * theirs, yes or no".
 *
 * So the exchange happens server-side and the answer is converted immediately
 * into this application's OWN signed cookie (`src/auth/customer-session.ts`).
 * Supabase is an OTP oracle, not a session store. It also means no dependency,
 * which on this machine costs a docker round trip to regenerate the lockfile.
 */

export interface PhoneVerifier {
  readonly name: string;
  /** Begin verification. Returns false when the number is unusable. */
  start(phoneE164: string): Promise<StartResult>;
  check(phoneE164: string, code: string): Promise<boolean>;
}

export type StartResult =
  | { readonly ok: true }
  /** Supabase's own throttle: one code per number per few seconds. */
  | { readonly ok: false; readonly reason: 'tooSoon' | 'unusableNumber' | 'providerDown' };

/**
 * Supabase Auth's phone provider.
 *
 * Uses the ANON key, which is public by definition and already in the client
 * bundle — sending the OTP from the server rather than the browser is not
 * about hiding the key, it is about where the resulting session lives.
 */
export class SupabasePhoneVerifier implements PhoneVerifier {
  readonly name = 'supabase';

  constructor(
    private readonly url: string,
    private readonly anonKey: string,
  ) {}

  async start(phoneE164: string): Promise<StartResult> {
    const response = await this.post('/auth/v1/otp', {
      phone: phoneE164,
      /*
       * ⚠ `create_user: true` IS REQUIRED AND IS NOT A SIGN-UP DECISION.
       *
       * With it false, GoTrue refuses to text a number it has never seen, so
       * every first-time customer gets "signups not allowed" — which is the
       * exact opposite of what a shop wants from a first-time customer. The
       * Supabase user it creates is a verification receipt, not an account:
       * nothing in this application reads it, and the customer row that
       * matters is created by `findOrCreateCustomerByPhone`.
       */
      create_user: true,
    });

    if (response === null) return { ok: false, reason: 'providerDown' };
    if (response.status === 200) return { ok: true };
    // GoTrue answers 429 for its own frequency limit, which is a "wait", not a
    // "no". Telling the customer to retry is useless if we call it a failure.
    if (response.status === 429) return { ok: false, reason: 'tooSoon' };
    return { ok: false, reason: 'unusableNumber' };
  }

  async check(phoneE164: string, code: string): Promise<boolean> {
    const response = await this.post('/auth/v1/verify', {
      type: 'sms',
      phone: phoneE164,
      token: code.trim(),
    });

    return response !== null && response.status === 200;
  }

  private async post(path: string, body: unknown): Promise<Response | null> {
    try {
      return await fetch(`${this.url}${path}`, {
        method: 'POST',
        headers: { apikey: this.anonKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        // The owner's customer is standing at a checkout screen. A hung auth
        // provider must become a refusal they can retry, not a spinner.
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return null;
    }
  }
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

  async start(): Promise<StartResult> {
    // Nothing is sent. The UI says so.
    return { ok: true };
  }

  async check(_phoneE164: string, code: string): Promise<boolean> {
    // Not timing-safe, and it does not need to be: this comparison only exists
    // in development, and the value it protects is a list of test orders.
    return code.trim() === this.code;
  }
}

/**
 * ⭐ THE STUB MUST BE IMPOSSIBLE TO ENABLE IN PRODUCTION, AND STILL IS.
 *
 * A development backdoor that survives to production is the single most common
 * way this class of prototype becomes an incident. What changed is only that
 * production now has a REAL verifier to fall through to, so refusing the stub
 * no longer means refusing the feature.
 *
 * The order of the checks is the whole design: Supabase first, so a correctly
 * configured deployment never even considers the stub; `NODE_ENV` second, so a
 * misconfigured production deployment throws rather than quietly falling back.
 *
 * Note what is still NOT offered: there is no `ALLOW_STUB_VERIFIER` to match
 * the payments one. A no-money demo deployment is a coherent thing to want; a
 * deployment that hands out other people's order history to anyone who knows
 * the dev code is not.
 */
export function phoneVerifier(): PhoneVerifier {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url !== undefined && url !== '' && anon !== undefined && anon !== '') {
    return new SupabasePhoneVerifier(url.replace(/\/+$/, ''), anon);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'No real phone verifier is configured. StubPhoneVerifier accepts a fixed ' +
        'development code and must never be reachable in production. Set ' +
        'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  const code = process.env.DEV_VERIFICATION_CODE;
  if (code === undefined || code === '') {
    throw new Error('DEV_VERIFICATION_CODE is not set, so order history cannot be unlocked.');
  }

  return new StubPhoneVerifier(code);
}

/** Whether phone verification is available at all on this deployment. */
export function verificationAvailable(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url !== undefined && url !== '' && anon !== undefined && anon !== '') return true;

  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.DEV_VERIFICATION_CODE !== undefined &&
    process.env.DEV_VERIFICATION_CODE !== ''
  );
}

/** Whether a real code is actually texted, as opposed to the fixed dev one. */
export function verificationIsReal(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url !== undefined && url !== '' && anon !== undefined && anon !== '';
}
