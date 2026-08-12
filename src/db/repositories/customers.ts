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
 * ⚠ NEITHER IDENTIFIER IS VERIFIED. Anyone who knows a number can claim to be
 * its owner. That is tolerable only because nothing sensitive hangs off it:
 * order tracking is gated on `order.public_token`, not on identity. When
 * `PhoneVerifier` becomes real, `phone_verified_at` is what changes and this
 * file is not.
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
 * Normalise a Canadian phone number to E.164.
 *
 * Deliberately narrow: it accepts the shapes a Montreal customer actually
 * types — `514-486-5246`, `(514) 486-5246`, `+1 514 486 5246` — and returns
 * `null` for anything else rather than guessing. A number stored in two
 * formats is two customers.
 */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
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
