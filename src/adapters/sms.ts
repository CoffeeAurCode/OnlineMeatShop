import 'server-only';

import { serverEnv } from '@/server-env';

/**
 * Sending an SMS, as a seam.
 *
 * The one recipient today is a DELIVERY PARTNER, not a customer, and that
 * distinction is what makes this exist at all.
 *
 * ══ THIS REOPENS A WRITTEN DECISION, AND SAYS SO ══════════════════════════
 *
 * ⚠ **D18 CUT SMS AT LAUNCH** (`02-DTM` §4.5.3). The reasoning was that
 * Canadian A2P registration is weeks of carrier paperwork and was the likeliest
 * cause of a launch delay. That reasoning has not changed and is not being
 * overturned.
 *
 * What changed is the RECIPIENT. D18 was about texting CUSTOMERS — an unknown,
 * unbounded set of numbers, which is exactly the traffic carriers police. The
 * traffic here is a handful of known people the owner employs, at 2-6 messages
 * a day. Different volume, different risk, different answer.
 *
 * `CLAUDE.md` §8 requires this be flagged rather than done quietly. It is
 * flagged here, in `DEVLOG.md`, and in `CODEBASE-CONTEXT.md`.
 *
 * ══ WHY THERE IS NO TWILIO SDK ════════════════════════════════════════════
 *
 * ⭐ THIS IS `fetch` AGAINST A FORM-ENCODED REST ENDPOINT, AND THAT IS
 * DELIBERATE.
 *
 * `twilio` the npm package pulls in a large dependency tree for what is one
 * POST with Basic auth. It would also have to be installed, and the local npm
 * on this machine is 11.6.2, which silently corrupts `package-lock.json` in a
 * way that breaks Render's `npm ci` (`CODEBASE-CONTEXT.md` §1.1). Every
 * dependency added here costs a docker round trip to regenerate the lockfile.
 *
 * The API surface being used is three fields. It is not worth it.
 */

export interface SmsResult {
  readonly ok: boolean;
  /** Twilio's message SID, for the outbox row. Null when the send failed. */
  readonly providerId: string | null;
  /** Provider-side error, safe to store. Never rendered to a customer. */
  readonly error: string | null;
}

export interface SmsSender {
  readonly name: string;
  send(toE164: string, body: string): Promise<SmsResult>;
}

/**
 * The no-op. Logs and reports success.
 *
 * ⚠ REPORTS SUCCESS ON PURPOSE, unlike the payment and verifier stubs, which
 * fail closed. The asymmetry is about what the caller does next: a payment
 * stub that lied would let an unpaid order proceed, whereas an SMS that did
 * not send costs one phone call from a driver who did not get a text. Failing
 * closed here would instead block the owner from advancing the order at all,
 * on a development box with no Twilio credentials — trading a small real
 * problem for a large fake one.
 *
 * The outbox row records `provider: 'log'`, so nothing downstream can mistake
 * a logged message for a delivered one.
 */
export class LoggingSmsSender implements SmsSender {
  readonly name = 'log';

  async send(toE164: string, body: string): Promise<SmsResult> {
    console.info('[sms:log] to=%s segments~%d body=%o', toE164, Math.ceil(body.length / 153), body);
    return { ok: true, providerId: null, error: null };
  }
}

/**
 * Twilio's Messages resource.
 *
 * ⚠ TWO WAYS TO NAME THE SENDER AND THEY ARE NOT INTERCHANGEABLE.
 *
 *   - `MessagingServiceSid` (`MG…`) — a POOL of numbers with sticky-sender,
 *     geomatching and A2P campaign registration attached to it.
 *   - `From` (`+1…`) — one specific number.
 *
 * A `MessagingServiceSid` whose pool is EMPTY accepts the request and then
 * fails to deliver, which is the worst of both: a 201 from the API and nothing
 * on the phone. Prefer the explicit `From` for dispatch, where the owner has
 * chosen the number the partner already has in their contacts, and let the
 * messaging service handle OTP (which Supabase sends, not this file).
 */
export class TwilioSmsSender implements SmsSender {
  readonly name = 'twilio';

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
  ) {}

  async send(toE164: string, body: string): Promise<SmsResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Basic ${auth}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: toE164, From: this.from, Body: body }),
        /*
         * ⚠ A TIMEOUT IS NOT OPTIONAL HERE. This runs inside an admin request
         * that the owner is watching on a phone. Without it, a Twilio outage
         * becomes a console that hangs on "Dispatch" with no way to tell
         * whether the message went — and the owner presses it again.
         */
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      return { ok: false, providerId: null, error: describe(error) };
    }

    const text = await response.text();
    if (!response.ok) {
      // Twilio returns `{ code, message }`. Keep it: `30034` (unregistered
      // 10DLC) and `21610` (recipient opted out) are the two an owner will
      // actually hit, and they need completely different answers.
      return { ok: false, providerId: null, error: `${response.status} ${text.slice(0, 300)}` };
    }

    let sid: string | null = null;
    try {
      sid = (JSON.parse(text) as { sid?: string }).sid ?? null;
    } catch {
      sid = null;
    }
    return { ok: true, providerId: sid, error: null };
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'unknown send failure';
}

/**
 * Which sender this deployment gets.
 *
 * ⚠ UNLIKE `paymentAdapter()`, THIS DOES NOT REFUSE IN PRODUCTION WITHOUT
 * CREDENTIALS. See `LoggingSmsSender` for why. What it does instead is make
 * the choice VISIBLE: the console shows which sender is live, and the outbox
 * row records it, so "the driver never got the text" is answerable from data
 * rather than from memory.
 */
export function smsSender(): SmsSender {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (sid === undefined || token === undefined || from === undefined) {
    return new LoggingSmsSender();
  }
  if (sid === '' || token === '' || from === '') return new LoggingSmsSender();

  // Read through `serverEnv` so the value is tainted and cannot be serialised
  // into an RSC payload. The presence check above is on `process.env` because
  // `serverEnv` throws on a missing name by design.
  return new TwilioSmsSender(sid, serverEnv.twilioAuthToken(), from);
}

/** Whether real messages will actually leave this deployment. */
export function smsConfigured(): boolean {
  return smsSender().name === 'twilio';
}
