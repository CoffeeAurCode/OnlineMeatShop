import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';
import { customer } from '@/db/schema';

/**
 * Find the customer behind an email address, or create them.
 *
 * There is no customer sign-in yet (DTM §9 specifies Supabase Auth with an
 * email magic link, and it is not built), so an order is attached to whoever
 * owns the email address given at checkout. That is enough to place and
 * fulfil an order and is NOT enough to show someone their order history,
 * which is why no order-history page exists.
 *
 * `ON CONFLICT` rather than select-then-insert: two checkouts from the same
 * new address at the same moment would otherwise race on the unique index and
 * one of them would fail with a constraint violation at the worst moment.
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
      // Refresh the contact details, but never blank them: someone checking
      // out as a guest without a phone must not wipe the number they gave
      // last week, which is the number the shop would ring about a variance.
      set: {
        name: sql`coalesce(excluded.name, ${customer.name})`,
        phone: sql`coalesce(excluded.phone, ${customer.phone})`,
      },
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
