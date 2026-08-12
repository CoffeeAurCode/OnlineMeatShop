import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { migrateTestDatabase, testPool, truncateAll } from './helpers/db';

/**
 * ⭐ THE GATE for increment 5's webhook half (DTM §8.4):
 * REPLAY · CRASH-AFTER-INSERT · OUT-OF-ORDER.
 *
 * Stripe retries, and a duplicate capture is a real-money bug. But a DROPPED
 * event is one too, and the obvious implementation drops them — which is why
 * the crash-after-insert case is the important test here rather than the
 * replay one everybody writes.
 */

let pool: Pool;
let repo: typeof import('@/db/repositories/payments');

beforeAll(async () => {
  await migrateTestDatabase();
  pool = testPool();
  repo = await import('@/db/repositories/payments');
});

afterAll(async () => {
  await pool.end();
  const { pool: appPool } = await import('@/db/client');
  await appPool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

const EVENT = { id: 'evt_test_1', type: 'payment_intent.succeeded', payload: { object: 'x' } };

async function effectCount(): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM audit_log`);
  return rows[0].n;
}

/** A stand-in local effect, so "did it run twice" is directly observable. */
async function recordEffect(tx: Parameters<Parameters<typeof repo.handleStripeEvent>[1]>[0]) {
  const { sql } = await import('drizzle-orm');
  await tx.execute(
    sql`INSERT INTO audit_log (actor, action, entity, entity_id) VALUES ('stripe', 'effect', 'test', 'e')`,
  );
}

describe('replay', () => {
  it('applies the effect once and reports the second delivery as a replay', async () => {
    expect(await repo.handleStripeEvent(EVENT, recordEffect)).toBe('processed');
    expect(await repo.handleStripeEvent(EVENT, recordEffect)).toBe('replay');
    expect(await effectCount()).toBe(1);
  });

  it('counts attempts, so a noisy redelivery is visible rather than invisible', async () => {
    await repo.handleStripeEvent(EVENT, recordEffect);
    await repo.handleStripeEvent(EVENT, recordEffect);
    await repo.handleStripeEvent(EVENT, recordEffect);
    const { rows } = await pool.query(`SELECT attempts FROM stripe_event WHERE id = $1`, [EVENT.id]);
    expect(rows[0].attempts).toBe(2);
  });
});

describe('crash after insert — THE case the naive implementation loses', () => {
  it('a retry completes normally after the first attempt died mid-handler', async () => {
    // The naive design inserts the event id, returns 200 on conflict, and
    // applies effects afterwards. If the process dies here, Stripe's retry
    // finds the id present and discards the event — permanently, silently.
    await expect(
      repo.handleStripeEvent(EVENT, async () => {
        throw new Error('process died mid-handler');
      }),
    ).rejects.toThrow(/died mid-handler/);

    // The insert rolled back WITH the effects. Nothing is recorded at all.
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM stripe_event`);
    expect(rows[0].n).toBe(0);
    expect(await effectCount()).toBe(0);

    // So the retry is clean and the event is not lost.
    expect(await repo.handleStripeEvent(EVENT, recordEffect)).toBe('processed');
    expect(await effectCount()).toBe(1);
  });

  it('an event inserted but never stamped is retried, not discarded', async () => {
    // Simulates the row surviving somehow with processed_at still NULL — the
    // state the nullable column exists to represent.
    await pool.query(
      `INSERT INTO stripe_event (id, type, payload) VALUES ($1, $2, '{}'::jsonb)`,
      [EVENT.id, EVENT.type],
    );

    expect(await repo.handleStripeEvent(EVENT, recordEffect)).toBe('processed');
    expect(await effectCount()).toBe(1);

    const { rows } = await pool.query(`SELECT processed_at FROM stripe_event WHERE id = $1`, [
      EVENT.id,
    ]);
    expect(rows[0].processed_at).not.toBeNull();
  });

  it('reports an unprocessed event as stuck, for the alert', async () => {
    await pool.query(
      `INSERT INTO stripe_event (id, type, payload, received_at)
       VALUES ($1, $2, '{}'::jsonb, now() - interval '30 minutes')`,
      [EVENT.id, EVENT.type],
    );
    const stuck = await repo.stuckEvents(15 * 60_000);
    expect(stuck.map((e) => e.id)).toEqual([EVENT.id]);
  });
});

describe('concurrent delivery of the same event', () => {
  it('serialises on the row lock — the effect still runs exactly once', async () => {
    // ON CONFLICT DO UPDATE rather than DO NOTHING is what takes the lock. With
    // DO NOTHING both deliveries would see no row and both would proceed.
    const [a, b] = await Promise.all([
      repo.handleStripeEvent(EVENT, recordEffect),
      repo.handleStripeEvent(EVENT, recordEffect),
    ]);
    expect([a, b].sort()).toEqual(['processed', 'replay']);
    expect(await effectCount()).toBe(1);
  });
});

describe('out-of-order arrival', () => {
  it('a guarded transition ignores an event describing a state already passed', async () => {
    // Stripe does not guarantee delivery order. A handler that applies a
    // transition just because an event describes it walks the order backwards.
    const { db } = await import('@/db/client');
    const { sql } = await import('drizzle-orm');

    const orderId = await seedMinimalOrder(pool);

    await db.transaction(async (tx) => {
      // Forward: PLACED → PREPARING.
      expect(await repo.transitionOrder(tx, orderId, ['PLACED'], 'PREPARING')).toBe(true);
      // The late-arriving earlier event: PREPARING is not in `from`, so no-op.
      expect(await repo.transitionOrder(tx, orderId, ['PLACED'], 'PLACED')).toBe(false);
      void sql;
    });

    const { rows } = await pool.query(`SELECT status FROM "order" WHERE id = $1`, [orderId]);
    expect(rows[0].status).toBe('PREPARING');
  });
});

describe('outbox de-duplication', () => {
  it('a redelivered event does not enqueue a second email', async () => {
    const { db } = await import('@/db/client');
    const orderId = await seedMinimalOrder(pool);

    const enqueue = async () =>
      db.transaction(async (tx) => {
        await repo.enqueueNotification(tx, {
          channel: 'EMAIL',
          kind: 'order.accepted',
          recipient: 'sample@example.test',
          payload: { orderId },
          orderId,
          dedupeKey: `order.accepted:${orderId}`,
        });
      });

    await enqueue();
    await enqueue();

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM notification_outbox`);
    expect(rows[0].n).toBe(1);
  });
});

/** The smallest order the FKs will accept. Fictional values only. */
async function seedMinimalOrder(p: Pool): Promise<string> {
  const { seedBusinessDay, seedCustomer, seedPerKgProduct, seedServedArea, seedSlot } =
    await import('./helpers/fixtures');

  await seedServedArea(p);
  const chicken = await seedPerKgProduct(p, { slug: 'chicken', ratePerKgCents: 1200 });
  const dayId = await seedBusinessDay(p, '2026-08-12', [{ productId: chicken.id, stockedG: 5000 }]);
  const slotId = await seedSlot(p, { capacity: 10 });
  const customerId = await seedCustomer(p);

  const { rows } = await p.query(
    `INSERT INTO "order"
       (customer_id, postal_code, fsa, address_line1, city, province,
        slot_id, business_day_id, pay_mode, status,
        est_line_total_cents, delivery_fee_cents, est_total_cents, catalog_version,
        slot_hot_eligible, has_hot_line)
     VALUES ($1, 'A1A1A1', 'A1A', '1 Test Street', 'Testville', 'QC',
             $2, $3, 'PREPAID', 'PLACED', 1200, 0, 1200, 1, false, false)
     RETURNING id`,
    [customerId, slotId, dayId],
  );
  return rows[0].id as string;
}
