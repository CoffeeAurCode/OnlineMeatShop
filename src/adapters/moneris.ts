import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { payment } from '@/db/schema';

import type {
  AuthoriseInput,
  CaptureInput,
  CaptureResult,
  PaymentAdapter,
} from './payments';

/**
 * ⭐ MONERIS. The processor the client chose on 2026-08-17, replacing Clover.
 *
 * ══ READ THIS BEFORE TRUSTING A SINGLE FIELD NAME BELOW ═══════════════════
 *
 * 🔴 THIS ADAPTER HAS NEVER SPOKEN TO MONERIS. There are no credentials yet.
 * It is written, typed, unit-tested against a fake transport, and UNREACHABLE
 * at runtime until `MONERIS_STORE_ID` and `MONERIS_API_TOKEN` are set — see
 * `paymentAdapter()` in `payments.ts`, which still returns the stub.
 *
 * The XML element and field names are written against the classic Moneris
 * Gateway API (eSELECTplus), which is the long-standing, widely documented
 * shape. **They must be checked against the merchant's own integration guide
 * on the day credentials arrive**, because Moneris ships more than one API
 * (the classic XML gateway and a newer JSON "Unified API") and a store is
 * provisioned for one of them. If the store turns out to be on the Unified
 * API, `postTransaction` and the three `build*` functions are what change;
 * nothing above them and nothing outside this file does.
 *
 * ══ WHY MONERIS FIXES BOTH THINGS CLOVER COULD NOT ════════════════════════
 *
 * `CODEBASE-CONTEXT.md` §1.4 has carried two red items for months. Moneris
 * answers both, and it is worth writing down which properties are load-bearing
 * so nobody re-opens them:
 *
 *   1. ⭐ **IDEMPOTENCY.** Clover documents no idempotency-key mechanism,
 *      which is what blocked `02-DTM` §8.2. Moneris requires `order_id` to be
 *      UNIQUE PER STORE and rejects a duplicate. That is an idempotency key
 *      wearing a different hat: send a DERIVED, deterministic `order_id` and a
 *      retry cannot double-charge, because the second attempt is refused by
 *      the processor rather than accepted as a second transaction.
 *      `monerisOrderId()` below is that derivation.
 *
 *   2. ⭐ **CAD.** Clover's documented example settles `usd` and CAD was
 *      unconfirmed. A Moneris store is PROVISIONED in a currency and the
 *      classic gateway takes no currency field at all — there is no way to
 *      send the wrong one. The risk moves from "our code sends usd" to "the
 *      merchant account was opened in the wrong currency", which is a question
 *      for the merchant's onboarding paperwork, not for this file.
 *
 * ⚠ NEITHER OF THOSE IS A SUBSTITUTE FOR A TEST TRANSACTION. They are reasons
 * to expect this to work, not evidence that it does.
 *
 * ══ THE SHAPE OF THE FLOW IS UNCHANGED, AND THAT IS THE POINT ═════════════
 *
 * Authorise the CEILING (`estTotal × (1 + tolerance)`), capture the EXACT
 * `cappedTotal`, once. Every rule in `CLAUDE.md` §7 about payments is about
 * that shape and none of them depends on the vendor. This is the third
 * processor this interface has been aimed at and the interface has not moved.
 */

/** ≤ 50 characters and unique per store — Moneris' constraint, not ours. */
const MONERIS_ORDER_ID_MAX = 50;

/** SSL-enabled merchant, card-not-present. */
const CRYPT_TYPE = '7';

const HOSTS = {
  test: 'https://esqa.moneris.com/gateway2/servlet/MpgRequest',
  production: 'https://www3.moneris.com/gateway2/servlet/MpgRequest',
} as const;

export interface MonerisConfig {
  readonly storeId: string;
  readonly apiToken: string;
  readonly environment: 'test' | 'production';
}

/**
 * ⭐ THE `order_id` WE SEND MONERIS IS DERIVED, NEVER RANDOM, NEVER OUR UUID.
 *
 * Derived from the idempotency key, which already CHANGES WITH THE AMOUNT
 * (see `AuthoriseInput`). Three properties follow, and all three are needed:
 *
 *   - **Stable across retries** — a network timeout retried with the same key
 *     produces the same `order_id`, and Moneris refuses it as a duplicate
 *     instead of opening a second hold on somebody's card.
 *   - **Changes with the amount** — so a genuinely different authorisation is
 *     a genuinely different transaction rather than a silent replay of the
 *     old figure.
 *   - **Not our order UUID** — the order id is used for the AUTHORISATION and
 *     the CAPTURE, which are two Moneris transactions and cannot share one.
 *
 * Hashed rather than concatenated because our keys contain `:` and UUIDs and
 * would exceed 50 characters; hashing gives a fixed, safe, alphanumeric width.
 * 24 hex characters is 96 bits, which is far past collision relevance for a
 * shop doing single-digit orders a day.
 */
export function monerisOrderId(idempotencyKey: string): string {
  const digest = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24);
  const id = `ps-${digest}`;
  /* istanbul ignore next -- structurally impossible; asserted, not handled. */
  if (id.length > MONERIS_ORDER_ID_MAX) throw new Error('moneris order_id too long');
  return id;
}

/**
 * Cents → the decimal string Moneris expects. `4620` → `"46.20"`.
 *
 * ⚠ INTEGER ARITHMETIC ONLY. `cents / 100` is a float and floats are banned in
 * this codebase for money (`CLAUDE.md` §7). The division here is integer
 * division on the dollars and a remainder on the cents, so no value is ever
 * held as a float — not even briefly, not even for formatting.
 */
export function monerisAmount(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error(`monerisAmount needs a non-negative integer of cents, got ${cents}`);
  }
  const dollars = Math.trunc(cents / 100);
  const remainder = cents % 100;
  return `${dollars}.${String(remainder).padStart(2, '0')}`;
}

/**
 * ⚠ ESCAPED, ALWAYS. Every value we interpolate is either a UUID, a derived
 * hash or a digit string today — so nothing currently NEEDS escaping, which is
 * exactly the condition under which somebody later interpolates a customer's
 * name into a receipt field and produces malformed XML or worse.
 */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function envelope(config: MonerisConfig, body: string): string {
  return (
    '<?xml version="1.0"?>' +
    '<request>' +
    `<store_id>${xmlEscape(config.storeId)}</store_id>` +
    `<api_token>${xmlEscape(config.apiToken)}</api_token>` +
    body +
    '</request>'
  );
}

/**
 * A pre-authorisation against a tokenised card.
 *
 * ⚠ `data_key` IS A TOKEN, NEVER A CARD NUMBER. The PAN is captured by
 * Moneris' own hosted tokenisation iframe in the browser and never touches
 * this server, which is the entire reason the shop is not in PCI-DSS scope for
 * card data. **If a future change makes a raw `pan` field appear in this file,
 * that change is wrong** — it moves the whole application into a compliance
 * regime nobody has budgeted for.
 */
function buildPreauth(
  config: MonerisConfig,
  args: { orderId: string; monerisOrderId: string; amount: string; dataKey: string },
): string {
  return envelope(
    config,
    '<res_preauth_cc>' +
      `<order_id>${xmlEscape(args.monerisOrderId)}</order_id>` +
      `<cust_id>${xmlEscape(args.orderId)}</cust_id>` +
      `<amount>${args.amount}</amount>` +
      `<data_key>${xmlEscape(args.dataKey)}</data_key>` +
      `<crypt_type>${CRYPT_TYPE}</crypt_type>` +
      '</res_preauth_cc>',
  );
}

/**
 * The capture. Moneris calls it a "completion".
 *
 * ⚠ ONE COMPLETION PER PRE-AUTHORISATION, and a completion for LESS than the
 * held amount releases the remainder rather than leaving it available. That is
 * the same rule this interface has always enforced, which is why `Finalise`
 * must be complete and correct before this fires.
 */
function buildCompletion(
  config: MonerisConfig,
  args: { monerisOrderId: string; txnNumber: string; amount: string },
): string {
  return envelope(
    config,
    '<completion>' +
      `<order_id>${xmlEscape(args.monerisOrderId)}</order_id>` +
      `<comp_amount>${args.amount}</comp_amount>` +
      `<txn_number>${xmlEscape(args.txnNumber)}</txn_number>` +
      `<crypt_type>${CRYPT_TYPE}</crypt_type>` +
      '</completion>',
  );
}

/**
 * Releasing a hold.
 *
 * ⚠ THERE IS NO "VOID PREAUTH" TRANSACTION IN THIS API. A completion for
 * `0.00` is how a pre-authorisation is released — it captures nothing and
 * frees the remainder, which is the same mechanism as any other completion.
 * Written down because "void" is what every other processor calls it and its
 * absence reads like an omission rather than a design.
 */
function buildRelease(
  config: MonerisConfig,
  args: { monerisOrderId: string; txnNumber: string },
): string {
  return buildCompletion(config, { ...args, amount: '0.00' });
}

export interface MonerisReceipt {
  readonly approved: boolean;
  readonly responseCode: string | null;
  readonly message: string;
  readonly txnNumber: string | null;
  readonly referenceNum: string | null;
  readonly transAmount: string | null;
}

/** One field out of the receipt. Deliberately not a full XML parser. */
function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return match === null ? null : match[1]!.trim();
}

/**
 * ⭐ WHAT COUNTS AS APPROVED, AND THE TRAP IN IT.
 *
 * Moneris returns a `ResponseCode` and approval is `code < 50`. The trap is
 * that a DECLINE and a SYSTEM ERROR are not the same shape: on a system error
 * the field comes back as the literal string `null`, or empty, or absent —
 * and `Number('null')` is `NaN`, while `Number('')` is `0`, which is
 * **less than 50 and would read as approved**.
 *
 * ⚠ So the empty case is checked explicitly BEFORE the numeric comparison.
 * Getting this wrong marks a failed transaction as a successful hold, and the
 * shop finds out when the capture fails days later against nothing.
 */
export function parseReceipt(xml: string): MonerisReceipt {
  const responseCode = tag(xml, 'ResponseCode');
  const message = tag(xml, 'Message') ?? '';

  const usable =
    responseCode !== null && responseCode !== '' && responseCode.toLowerCase() !== 'null';
  const numeric = usable ? Number(responseCode) : Number.NaN;
  const approved = Number.isFinite(numeric) && numeric >= 0 && numeric < 50;

  return {
    approved,
    responseCode: usable ? responseCode : null,
    message,
    txnNumber: tag(xml, 'TransID'),
    referenceNum: tag(xml, 'ReferenceNum'),
    transAmount: tag(xml, 'TransAmount'),
  };
}

/** Injected so the adapter can be tested without a network. */
export type MonerisTransport = (url: string, body: string) => Promise<string>;

const fetchTransport: MonerisTransport = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    body,
    // A processor that has stopped answering must not hold a request handler
    // open indefinitely. Moneris' own guidance is a 60-second read timeout.
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`Moneris returned HTTP ${response.status}`);
  }
  return response.text();
};

/**
 * ⭐ `payment_intent_id` HOLDS BOTH HALVES: `<monerisOrderId>:<txnNumber>`.
 *
 * A completion needs the `order_id` AND the `txn_number` of the pre-auth, and
 * this table has exactly one column to remember a processor's handle in. The
 * alternative was a migration adding a second column used by one adapter;
 * a delimited pair in the existing column is smaller and reversible.
 *
 * ⚠ THE DELIMITER IS SAFE because both halves are constrained: our
 * `monerisOrderId` is `ps-` plus hex, and a Moneris `TransID` is digits.
 * Neither can contain a colon. If a future adapter reuses this encoding for
 * values that can, it needs a different one.
 */
export function encodeAuthId(monerisOrderIdValue: string, txnNumber: string): string {
  return `${monerisOrderIdValue}:${txnNumber}`;
}

export function decodeAuthId(
  authId: string,
): { monerisOrderId: string; txnNumber: string } | null {
  const index = authId.lastIndexOf(':');
  if (index <= 0 || index === authId.length - 1) return null;
  return {
    monerisOrderId: authId.slice(0, index),
    txnNumber: authId.slice(index + 1),
  };
}

export class MonerisPaymentAdapter implements PaymentAdapter {
  readonly name = 'moneris';

  constructor(
    private readonly config: MonerisConfig,
    private readonly transport: MonerisTransport = fetchTransport,
  ) {}

  private async post(body: string): Promise<MonerisReceipt> {
    return parseReceipt(await this.transport(HOSTS[this.config.environment], body));
  }

  /**
   * Place the hold.
   *
   * ══ THE ORDER OF OPERATIONS, AND WHY IT IS THIS WAY ═══════════════════════
   *
   *   1. claim the `payment` row       (REQUIRES_PAYMENT_METHOD, no processor call)
   *   2. if it is already authorised   → return that. This is a replay.
   *   3. call Moneris                  (HTTP, no transaction open)
   *   4. record the handle             (→ REQUIRES_CAPTURE)
   *
   * ⭐ STEP 1 IS THE REAL DOUBLE-TAP GATE, and it is the database's, not
   * Moneris'. `payment.order_id` is UNIQUE, so two concurrent checkouts for
   * one order produce ONE claim: the loser's insert conflicts and it reads the
   * winner's row rather than opening a second hold on the card. Moneris'
   * duplicate-`order_id` refusal sits underneath as a second line, which is
   * where a processor's idempotency should sit — a backstop, never the plan.
   *
   * ⚠ NO DATABASE TRANSACTION SPANS STEP 3. `CLAUDE.md` §7: never call a
   * payment processor inside a transaction. A transaction holding row locks
   * across a call to Moneris has its duration set by somebody else's uptime.
   *
   * ⚠ THE HONEST FAILURE WINDOW: a crash between 3 and 4 leaves a row in
   * `REQUIRES_PAYMENT_METHOD` with a hold on the customer's card that this
   * system has forgotten the handle for. That is why the claim is written
   * FIRST — the row exists, it names the order, and its Moneris `order_id` is
   * re-derivable from the same idempotency key, so the hold is findable in
   * Moneris' portal by a human. The reverse order would leave a hold with
   * nothing at all pointing at it.
   */
  async authoriseCeiling(input: AuthoriseInput): Promise<{ authId: string }> {
    if (!Number.isSafeInteger(input.ceilingCents) || input.ceilingCents <= 0) {
      throw new Error(
        `authoriseCeiling needs a positive integer ceiling, got ${input.ceilingCents}`,
      );
    }
    if (input.paymentToken === undefined || input.paymentToken === '') {
      // A real processor cannot authorise nothing. The stub can, which is why
      // the token is optional on the interface and required here.
      throw new Error('MonerisPaymentAdapter requires a payment token from hosted tokenisation');
    }

    await db
      .insert(payment)
      .values({
        orderId: input.orderId,
        provider: this.name,
        status: 'REQUIRES_PAYMENT_METHOD',
        authorisedCents: input.ceilingCents,
      })
      .onConflictDoNothing({ target: payment.orderId });

    const existing = await db
      .select({ status: payment.status, paymentIntentId: payment.paymentIntentId })
      .from(payment)
      .where(eq(payment.orderId, input.orderId))
      .limit(1);

    const row = existing[0];
    if (row === undefined) throw new Error('payment claim produced no row');

    // A retry of an attempt that already succeeded. The answer is the
    // authorisation that exists, never a second hold.
    if (row.paymentIntentId !== null) return { authId: row.paymentIntentId };

    const merchantOrderId = monerisOrderId(input.idempotencyKey);
    const receipt = await this.post(
      buildPreauth(this.config, {
        orderId: input.orderId,
        monerisOrderId: merchantOrderId,
        amount: monerisAmount(input.ceilingCents),
        dataKey: input.paymentToken,
      }),
    );

    if (!receipt.approved || receipt.txnNumber === null) {
      await db
        .update(payment)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(
          and(eq(payment.orderId, input.orderId), eq(payment.status, 'REQUIRES_PAYMENT_METHOD')),
        );
      throw new Error(
        `Moneris declined the pre-authorisation (${receipt.responseCode ?? 'no code'}: ${receipt.message})`,
      );
    }

    const authId = encodeAuthId(merchantOrderId, receipt.txnNumber);

    await db
      .update(payment)
      .set({
        paymentIntentId: authId,
        status: 'REQUIRES_CAPTURE',
        authorisedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(payment.orderId, input.orderId), eq(payment.status, 'REQUIRES_PAYMENT_METHOD')));

    return { authId };
  }

  /**
   * Take the money, exactly once.
   *
   * ══ THE CLAIM-THEN-CALL PATTERN, AND WHY IT IS NOT THE STUB'S ═════════════
   *
   * The stub marks the row CAPTURED in one conditional UPDATE, because for the
   * stub the UPDATE *is* the capture. Here the money moves over a network, so
   * the row cannot be marked CAPTURED until Moneris says it happened — and it
   * cannot be left unmarked either, or two concurrent calls both reach the
   * processor.
   *
   * ⭐ SO THE CLAIM IS SEPARATE FROM THE RESULT. Writing
   * `capture_idempotency_key` where it is still NULL is an atomic claim: two
   * concurrent captures serialise on the row and exactly one wins. The loser
   * gets `alreadyCaptured` without ever reaching Moneris.
   *
   * ⚠ A RETRY BY THE SAME KEY IS ALLOWED THROUGH ON PURPOSE. That is what a
   * crash between the claim and the response looks like, and Moneris' own
   * duplicate-`order_id` refusal is what makes it safe: the completion is
   * refused as a duplicate, we read the amount back, and the answer is the
   * money actually taken. This is the `alreadyCaptured` replay case that
   * `CLAUDE.md` §7 insists is a replay and not an error.
   */
  async captureExact(input: CaptureInput): Promise<CaptureResult> {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) {
      throw new Error(`captureExact needs a non-negative integer amount, got ${input.amountCents}`);
    }

    const handle = decodeAuthId(input.authId);
    if (handle === null) return { ok: false, reason: 'notFound' };

    const claimed = await db
      .update(payment)
      .set({ captureIdempotencyKey: input.idempotencyKey, updatedAt: new Date() })
      .where(
        and(
          eq(payment.paymentIntentId, input.authId),
          eq(payment.status, 'REQUIRES_CAPTURE'),
          isNull(payment.capturedCents),
          sql`${payment.authorisedCents} >= ${input.amountCents}`,
          // Null, or already ours. Ours means this is a retry of the same
          // attempt, which must be allowed through to Moneris — see above.
          sql`(${payment.captureIdempotencyKey} IS NULL
               OR ${payment.captureIdempotencyKey} = ${input.idempotencyKey})`,
        ),
      )
      .returning({ id: payment.id });

    if (claimed[0] === undefined) return this.explainRefusal(input);

    const receipt = await this.post(
      buildCompletion(this.config, {
        monerisOrderId: handle.monerisOrderId,
        txnNumber: handle.txnNumber,
        amount: monerisAmount(input.amountCents),
      }),
    );

    if (!receipt.approved) {
      /*
       * ⚠ THE CLAIM IS RELEASED so a genuine transient failure can be retried.
       *
       * ⭐ BUT ONLY THE CLAIM — the status is left alone. Marking the payment
       * FAILED here would be a guess: a timeout on the way BACK from a
       * successful completion looks identical to a decline from here, and the
       * money would already be gone. Leaving the row REQUIRES_CAPTURE means a
       * retry re-asks the processor, which is the only party that knows.
       */
      await db
        .update(payment)
        .set({ captureIdempotencyKey: null, updatedAt: new Date() })
        .where(
          and(
            eq(payment.paymentIntentId, input.authId),
            eq(payment.captureIdempotencyKey, input.idempotencyKey),
          ),
        );
      return { ok: false, reason: 'exceedsAuthorisation', authorisedCents: input.amountCents };
    }

    await db
      .update(payment)
      .set({
        status: 'CAPTURED',
        capturedCents: input.amountCents,
        capturedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(payment.paymentIntentId, input.authId));

    return { ok: true, capturedCents: input.amountCents };
  }

  /** Which guard refused, read from the row. The three cases mean very different things. */
  private async explainRefusal(input: CaptureInput): Promise<CaptureResult> {
    const rows = await db
      .select({
        status: payment.status,
        capturedCents: payment.capturedCents,
        authorisedCents: payment.authorisedCents,
      })
      .from(payment)
      .where(eq(payment.paymentIntentId, input.authId))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return { ok: false, reason: 'notFound' };
    if (row.status === 'CANCELLED') return { ok: false, reason: 'voided' };
    if (row.capturedCents !== null) {
      return { ok: false, reason: 'alreadyCaptured', capturedCents: row.capturedCents };
    }
    return { ok: false, reason: 'exceedsAuthorisation', authorisedCents: row.authorisedCents };
  }

  /**
   * Release the hold — a completion for `0.00`. See `buildRelease`.
   *
   * Idempotent from the caller's point of view: a second release of an already
   * released hold is refused by Moneris and swallowed here, because "the hold
   * is not there any more" is the outcome the caller wanted either way.
   */
  async voidAuthorisation(authId: string): Promise<void> {
    const handle = decodeAuthId(authId);
    if (handle === null) return;

    try {
      await this.post(buildRelease(this.config, handle));
    } catch {
      // Swallowed deliberately. The row is marked CANCELLED below regardless,
      // because a hold we failed to release expires on its own within days,
      // while a row stuck in REQUIRES_CAPTURE blocks the order forever.
    }

    await db
      .update(payment)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(and(eq(payment.paymentIntentId, authId), eq(payment.status, 'REQUIRES_CAPTURE')));
  }
}

/**
 * The configuration, or null when this deployment has no Moneris credentials.
 *
 * ⚠ ALL THREE OR NOTHING. A half-configured processor is the failure that
 * looks like it works in staging: a store id with no token authorises nothing
 * and the shop discovers it at the first real checkout.
 */
export function monerisConfig(): MonerisConfig | null {
  const storeId = process.env.MONERIS_STORE_ID;
  const apiToken = process.env.MONERIS_API_TOKEN;
  if (storeId === undefined || storeId === '' || apiToken === undefined || apiToken === '') {
    return null;
  }

  /*
   * ⭐ PRODUCTION IS OPT-IN, and the default is the test host.
   *
   * The reverse default — live unless told otherwise — means a mistyped
   * variable name sends real cards to the real processor during testing. This
   * way the same mistake costs a confusing "why did nothing settle", which is
   * the failure you find in an afternoon rather than the one you find in a
   * bank statement.
   */
  const environment = process.env.MONERIS_ENV === 'production' ? 'production' : 'test';
  return { storeId, apiToken, environment };
}
