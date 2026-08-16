import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';
import { customer } from '@/db/schema';

/**
 * Finding or creating the person an order belongs to.
 *
 * The shop is PHONE-FIRST since migration 0006: a customer identifies
 * themselves with a number and may never give an email at all. Both
 * identifiers are therefore optional and both are uniquely indexed only where
 * they are present.
 *
 * ⭐ THE PHONE NUMBER IS NOW VERIFIED — BUT NOT BY THIS FILE, AND NOT ON
 * EVERY PATH.
 *
 * `findOrCreateCustomerByPhone` still takes a number somebody TYPED and asks
 * no questions about it, because it runs inside checkout where the customer
 * has already proven the number to `/api/auth/verify` and the checkout route
 * checks the session before calling in here. `phone_verified_at` is stamped by
 * `markPhoneVerified` below, from the verify route only.
 *
 * ⚠ So a row in this table with a NULL `phone_verified_at` is a real thing
 * and not a bug: it is either a pre-2026-08-16 order, or an email-path
 * checkout. Never read the presence of a row as proof of anything.
 *
 * ══ ON CONFLICT AGAINST A PARTIAL INDEX ═══════════════════════════════════
 *
 * ⚠ `ON CONFLICT (col)` DOES NOT MATCH A PARTIAL UNIQUE INDEX unless the
 * statement repeats the index predicate. Postgres infers the arbiter index by
 * matching BOTH the column list AND the predicate, so against
 * `UNIQUE (email) WHERE email IS NOT NULL` a bare `ON CONFLICT (email)` fails
 * outright with:
 *
 *     there is no unique or exclusion constraint matching
 *     the ON CONFLICT specification
 *
 * It is a runtime error, not a type error, and it surfaces as a 500 on
 * checkout rather than anywhere near the migration that caused it. Hence
 * `targetWhere` on both upserts below. Measured against Postgres 17, not
 * assumed.
 */

/** The predicate on `customer_email_unique`, repeated verbatim so it matches. */
const EMAIL_PRESENT = sql`${customer.email} IS NOT NULL`;
/** The predicate on `customer_phone_unique`. */
const PHONE_PRESENT = sql`${customer.phone} IS NOT NULL`;

/**
 * Refresh the contact details, but NEVER blank them.
 *
 * Someone checking out as a guest without a phone must not wipe the number
 * they gave last week — that number is the one the shop rings about a weight
 * variance, and losing it silently turns a phone call into an undeliverable
 * order.
 */
const refreshContact = {
  name: sql`coalesce(excluded.name, ${customer.name})`,
  phone: sql`coalesce(excluded.phone, ${customer.phone})`,
} as const;

/**
 * ⚠ `normalisePhone` MOVED TO `src/domain/phone.ts`. It is re-exported here
 * so existing imports keep working, and it is NOT reimplemented.
 *
 * It moved for two reasons. It gained callers that are not customers — the
 * OTP routes and the delivery-partner roster — and a rule enforced in three
 * places has to be stated in one. And it stopped being Canada-only: the moment
 * a phone number became a LOGIN, a normaliser that returns null for the user's
 * own number stopped being strict and started being broken.
 */
export { normalisePhone } from '@/domain/phone';

/**
 * Stamp `phone_verified_at` after a successful OTP check.
 *
 * ⭐ SEPARATE FROM THE UPSERT, ON PURPOSE. `findOrCreateCustomerByPhone`
 * runs at CHECKOUT, from a number somebody typed; this runs only from the
 * verify route, after a code that was texted to that number came back. If one
 * function did both, every checkout would silently mark itself verified and
 * the column would record nothing at all — which is exactly the state it was
 * in for the whole prototype, and the state it exists to escape.
 *
 * Idempotent: verifying twice keeps the FIRST timestamp, because the question
 * the column answers is "when was this number proven", not "when was it last
 * proven".
 */
export async function markPhoneVerified(
  phoneE164: string,
  atMs: number,
  tx: Tx | typeof db = db,
): Promise<void> {
  await tx
    .update(customer)
    .set({ phoneVerifiedAt: sql`coalesce(${customer.phoneVerifiedAt}, ${new Date(atMs)})` })
    .where(eq(customer.phone, phoneE164));
}

/**
 * Find the customer behind a PHONE NUMBER, or create them. The prototype's
 * primary identification path.
 *
 * `ON CONFLICT` rather than select-then-insert: two checkouts from the same
 * new number at the same moment would otherwise race on the unique index and
 * one would fail with a constraint violation at the worst possible moment.
 */
export async function findOrCreateCustomerByPhone(
  phoneE164: string,
  name: string | null,
  email: string | null,
  tx: Tx | typeof db = db,
): Promise<string> {
  const normalisedEmail = email === null ? null : email.trim().toLowerCase() || null;

  const rows = await tx
    .insert(customer)
    .values({ phone: phoneE164, name, email: normalisedEmail })
    .onConflictDoUpdate({
      target: customer.phone,
      targetWhere: PHONE_PRESENT,
      set: {
        name: sql`coalesce(excluded.name, ${customer.name})`,
        email: sql`coalesce(excluded.email, ${customer.email})`,
      },
    })
    .returning({ id: customer.id });

  const row = rows[0];
  if (row !== undefined) return row.id;

  const existing = await tx
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.phone, phoneE164))
    .limit(1);

  const found = existing[0];
  if (found === undefined) throw new Error('customer upsert by phone returned nothing');
  return found.id;
}

/**
 * Find the customer behind an EMAIL ADDRESS, or create them.
 *
 * Kept because email checkout still works and the e2e suite exercises it; the
 * phone path above is the one the storefront now uses.
 */
export async function findOrCreateCustomer(
  email: string,
  name: string | null,
  phone: string | null,
  tx: Tx | typeof db = db,
): Promise<string> {
  const normalised = email.trim().toLowerCase();

  const rows = await tx
    .insert(customer)
    .values({ email: normalised, name, phone })
    .onConflictDoUpdate({
      target: customer.email,
      targetWhere: EMAIL_PRESENT,
      set: refreshContact,
    })
    .returning({ id: customer.id });

  const row = rows[0];
  if (row !== undefined) return row.id;

  const existing = await tx
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.email, normalised))
    .limit(1);

  const found = existing[0];
  if (found === undefined) throw new Error('customer upsert returned nothing');
  return found.id;
}
