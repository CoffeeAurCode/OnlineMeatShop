import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { payment } from '@/db/schema';

/**
 * ⭐⭐ THE PAYMENT SEAM, AND THE MOST VALUABLE THING IN THIS PROTOTYPE.
 *
 * The hard part of this system is not taking a card. It is that an ESTIMATE is
 * authorised and a WEIGHED EXACT AMOUNT is captured, once, idempotently, while
 * the order and payment state machines move independently. Stubbing only the
 * network and keeping that whole lifecycle means the riskiest path in the
 * application is exercised and tested BEFORE real money touches it.
 *
 * The alternative, going straight to pay-on-delivery for the prototype, would
 * have left exactly that path unwritten and unmeasured, and would have
 * discovered its bugs on the day a processor was wired in.
 *
 * ══ THE RULE THE WHOLE INTERFACE EXISTS TO ENFORCE ════════════════════════
 *
 * ⚠ YOU GET EXACTLY ONE CAPTURE PER AUTHORISATION. A partial capture
 * automatically releases the remainder; you cannot come back for the
 * difference. So `Finalise` has to be complete and correct before settlement
 * fires, and a second `captureExact` is not a retry, it is a bug. This
 * interface refuses it rather than trusting the caller.
 *
 * ══ WHY THIS IS NOT WRITTEN AGAINST STRIPE ════════════════════════════════
 *
 * The processor is Clover. `CloverPaymentAdapter` implements this same
 * interface and that is the whole seam. Two things must be settled before it
 * is written, and neither is a frontend problem: Clover documents no
 * idempotency-key mechanism, so `02-DTM` §8.2's checkout boundary has to be
 * re-solved, and CAD settlement is unconfirmed.
 */

export interface AuthoriseInput {
  readonly orderId: string;
  /**
   * The CEILING, not the estimate: `estTotal × (1 + tolerance)`. Authorising
   * the estimate itself would fail the capture whenever a cut came in heavy,
   * which is the normal case, not the edge case.
   */
  readonly ceilingCents: number;
  /**
   * Stable across retries of the same attempt, and it CHANGES WITH THE AMOUNT.
   * A key that ignored the amount would make a processor replay the original
   * response and quietly authorise the old number.
   */
  readonly idempotencyKey: string;
}

export interface CaptureInput {
  readonly authId: string;
  /** The exact `cappedTotal`. Never more than the ceiling. */
  readonly amountCents: number;
  readonly idempotencyKey: string;
}

export type CaptureResult =
  | { readonly ok: true; readonly capturedCents: number }
  /** A second capture. Not retryable, and not an error to paper over. */
  | { readonly ok: false; readonly reason: 'alreadyCaptured'; readonly capturedCents: number }
  | { readonly ok: false; readonly reason: 'exceedsAuthorisation'; readonly authorisedCents: number }
  | { readonly ok: false; readonly reason: 'notFound' | 'voided' };

export interface PaymentAdapter {
  /** The provider identity written to `payment.provider`. */
  readonly name: string;
  authoriseCeiling(input: AuthoriseInput): Promise<{ authId: string }>;
  captureExact(input: CaptureInput): Promise<CaptureResult>;
  voidAuthorisation(authId: string): Promise<void>;
}

/**
 * The prototype's adapter. ONLY THE NETWORK IS FAKE.
 *
 * It writes a real `payment` row, moves `payment_status` through
 * `REQUIRES_CAPTURE → CAPTURED`, honours the one-capture rule, and refuses to
 * capture more than it authorised. Everything a real processor would enforce
 * on its side is enforced here, so that the code around it is tested against
 * the same refusals.
 *
 * ⚠ `provider = 'stub'` IS THE ONLY THING THAT MARKS THESE AS TEST ORDERS.
 * They are deliberately `pay_mode = PREPAID`, because that is the branch this
 * exercise exists to run, so the pay mode cannot distinguish them. Anything
 * that ever reads takings must filter on the provider.
 */
export class StubPaymentAdapter implements PaymentAdapter {
  readonly name = 'stub';

  /**
   * Create the hold.
   *
   * Idempotent on `payment.order_id`, which is UNIQUE. Two concurrent
   * checkouts for one order therefore produce ONE authorisation: the loser's
   * insert conflicts and it reads the winner's row rather than opening a
   * second hold on the customer's card. That is the double-tap gate, and it is
   * enforced by the database rather than by a check-then-act in application
   * code, which is the version that loses the race.
   */
  async authoriseCeiling(input: AuthoriseInput): Promise<{ authId: string }> {
    if (!Number.isSafeInteger(input.ceilingCents) || input.ceilingCents <= 0) {
      throw new Error(`authoriseCeiling needs a positive integer ceiling, got ${input.ceilingCents}`);
    }

    const authId = `stub_auth_${randomUUID()}`;

    const rows = await db
      .insert(payment)
      .values({
        orderId: input.orderId,
        provider: this.name,
        paymentIntentId: authId,
        status: 'REQUIRES_CAPTURE',
        authorisedCents: input.ceilingCents,
        authorisedAt: new Date(),
      })
      .onConflictDoNothing({ target: payment.orderId })
      .returning({ paymentIntentId: payment.paymentIntentId });

    const created = rows[0];
    if (created?.paymentIntentId != null) return { authId: created.paymentIntentId };

    // Lost the race, or this is a retry. Either way the answer is the
    // authorisation that already exists, never a new one.
    const existing = await db
      .select({ paymentIntentId: payment.paymentIntentId })
      .from(payment)
      .where(eq(payment.orderId, input.orderId))
      .limit(1);

    const found = existing[0]?.paymentIntentId;
    if (found == null) throw new Error('payment upsert produced no authorisation');
    return { authId: found };
  }

  /**
   * Take the money, exactly once.
   *
   * ⭐ THE ONE-CAPTURE RULE IS ENFORCED BY A CONDITIONAL UPDATE, not by reading
   * the row and then deciding. `where status = 'REQUIRES_CAPTURE' and
   * captured_cents is null` means two concurrent captures serialise on the row
   * and exactly one of them matches; the other updates zero rows and is told
   * `alreadyCaptured`. A read-then-write would let both through under
   * concurrency, and a duplicate capture is a real-money bug.
   *
   * The ceiling is checked in the same statement rather than beforehand, for
   * the same reason. The Postgres CHECK on the table is the backstop beneath
   * both.
   */
  async captureExact(input: CaptureInput): Promise<CaptureResult> {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) {
      throw new Error(`captureExact needs a non-negative integer amount, got ${input.amountCents}`);
    }

    const updated = await db
      .update(payment)
      .set({
        status: 'CAPTURED',
        capturedCents: input.amountCents,
        capturedAt: new Date(),
        captureIdempotencyKey: input.idempotencyKey,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(payment.paymentIntentId, input.authId),
          eq(payment.status, 'REQUIRES_CAPTURE'),
          isNull(payment.capturedCents),
          sql`${payment.authorisedCents} >= ${input.amountCents}`,
        ),
      )
      .returning({ capturedCents: payment.capturedCents });

    if (updated[0]?.capturedCents != null) {
      return { ok: true, capturedCents: updated[0].capturedCents };
    }

    // Nothing matched. Work out WHICH guard refused, because the three cases
    // mean very different things to the caller and lumping them into one
    // failure would hide a real-money bug behind a retry.
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

  /** Release the hold. Idempotent: voiding a voided authorisation is fine. */
  async voidAuthorisation(authId: string): Promise<void> {
    await db
      .update(payment)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(and(eq(payment.paymentIntentId, authId), eq(payment.status, 'REQUIRES_CAPTURE')));
  }
}

/**
 * ⭐ THE FAIL-CLOSED CHOICE.
 *
 * A stub payment adapter reaching production would take orders and move no
 * money, which is the most expensive possible failure for a shop.
 *
 * ⚠ THIS FUNCTION IS THE SECOND LINE, NOT THE FIRST. It is called inside route
 * handlers, so on its own it would only fail at the first CHECKOUT -- the
 * worst possible moment, costing a real customer a real order. The comment
 * here used to claim it refused "at startup", which was simply false.
 *
 * `src/instrumentation.ts` now makes that true: it runs once before the server
 * accepts any request and throws on the same condition, so a misconfigured
 * deploy fails its health check and the previous version keeps serving. This
 * check stays as the backstop for anything that bypasses startup.
 */
export function paymentAdapter(): PaymentAdapter {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_STUB_PAYMENTS !== 'true') {
    throw new Error(
      'No real payment adapter is configured. StubPaymentAdapter moves no money and ' +
        'must never be reached in production. Configure a processor, or set ' +
        'ALLOW_STUB_PAYMENTS=true to run a deliberate no-money demo deployment.',
    );
  }
  return new StubPaymentAdapter();
}

/**
 * Whether the current deployment is taking real money, which the UI banner
 * turns on. Read separately from `paymentAdapter()` so a page can ask without
 * constructing one.
 */
export function isStubPayments(): boolean {
  return true;
}

/** A capture key that CHANGES WITH THE AMOUNT. See `AuthoriseInput`. */
export function captureKey(orderId: string, amountCents: number): string {
  return `capture:${orderId}:${amountCents}`;
}

/** Unused today; kept beside `captureKey` so the pair stays consistent. */
export function authoriseKey(attemptId: string, ceilingCents: number): string {
  return `auth:${attemptId}:${ceilingCents}`;
}
