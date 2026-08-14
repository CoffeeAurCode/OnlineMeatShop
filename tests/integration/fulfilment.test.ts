import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { migrateTestDatabase, testPool, truncateAll } from './helpers/db';
import { seedSlot, seedZone } from './helpers/fixtures';

let pool: Pool;
let repo: typeof import('@/db/repositories/fulfilment');

beforeAll(async () => {
  await migrateTestDatabase();
  pool = testPool();
  repo = await import('@/db/repositories/fulfilment');
});

afterAll(async () => {
  await pool.end();
  const { pool: appPool } = await import('@/db/client');
  await appPool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

describe('inv-F4 / inv-F5 as DATABASE constraints', () => {
  it('the database refuses booked_count > capacity', async () => {
    const slotId = await seedSlot(pool, { capacity: 2 });
    await expect(
      pool.query(`UPDATE slot SET booked_count = 3 WHERE id = $1`, [slotId]),
    ).rejects.toThrow(/slot_not_overbooked/);
  });

  it('booked_count = capacity is legal — the boundary is inclusive', async () => {
    const slotId = await seedSlot(pool, { capacity: 2 });
    await pool.query(`UPDATE slot SET booked_count = 2 WHERE id = $1`, [slotId]);
    const { rows } = await pool.query(`SELECT booked_count FROM slot`);
    expect(rows[0].booked_count).toBe(2);
  });

  it('the database refuses a cutoff after the slot starts (inv-F5)', async () => {
    await expect(
      seedSlot(pool, { cutoffOffsetHours: +1 }),
    ).rejects.toThrow(/slot_times_ordered/);
  });

  it('the database refuses an FSA that is not in the A1A shape', async () => {
    const zoneId = await seedZone(pool, { name: 'near', feeCents: 499 });
    await expect(
      pool.query(`INSERT INTO serviceable_fsa (fsa, zone_id) VALUES ('a1a', $1)`, [zoneId]),
    ).rejects.toThrow(/fsa_format/);
  });

  it('the database refuses free_above_cents = 0 — one typo from free delivery for all', async () => {
    await expect(
      pool.query(
        `INSERT INTO zone (name, fee_cents, free_above_cents) VALUES ('bad', 499, 0)`,
      ),
    ).rejects.toThrow(/zone_free_above_positive/);
  });
});

describe('bookSlot / unbookSlot', () => {
  it('books up to capacity and then refuses, without raising', async () => {
    const slotId = await seedSlot(pool, { capacity: 2 });
    const { db } = await import('@/db/client');

    const results = await db.transaction(async (tx) => [
      await repo.bookSlot(tx, slotId),
      await repo.bookSlot(tx, slotId),
      // The third must return false rather than violate the CHECK — a CHECK
      // violation aborts the whole transaction and loses the chance to answer
      // `slotFull` cleanly.
      await repo.bookSlot(tx, slotId),
    ]);

    expect(results).toEqual([true, true, false]);
    const { rows } = await pool.query(`SELECT booked_count FROM slot`);
    expect(rows[0].booked_count).toBe(2);
  });

  it('unbooking floors at zero rather than failing', async () => {
    const slotId = await seedSlot(pool, { capacity: 2 });
    const { db } = await import('@/db/client');
    await db.transaction(async (tx) => {
      await repo.unbookSlot(tx, slotId);
      await repo.unbookSlot(tx, slotId);
    });
    const { rows } = await pool.query(`SELECT booked_count FROM slot`);
    expect(rows[0].booked_count).toBe(0);
  });
});

describe('serviceability lookup', () => {
  it('maps an FSA to its zone fee rule, and misses cleanly', async () => {
    const zoneId = await seedZone(pool, { name: 'near', feeCents: 499, freeAboveCents: 5000 });
    await pool.query(`INSERT INTO serviceable_fsa (fsa, zone_id) VALUES ('A1A', $1)`, [zoneId]);

    const served = await repo.zoneForPostalCode('a1a 1a1');
    expect(served?.feeCents).toBe(499);
    expect(served?.freeAboveCents).toBe(5000);

    expect(await repo.zoneForPostalCode('Z9Z 9Z9')).toBeNull();
    expect(await repo.zoneForPostalCode('not a postcode')).toBeNull();
  });

  it('reads the whole FSA→fee map', async () => {
    const near = await seedZone(pool, { name: 'near', feeCents: 499, freeAboveCents: 5000 });
    const far = await seedZone(pool, { name: 'far', feeCents: 899 });
    await pool.query(`INSERT INTO serviceable_fsa (fsa, zone_id) VALUES ('A1A', $1), ('A1B', $2)`, [
      near,
      far,
    ]);

    const map = await repo.zoneFeesByFsa();
    expect(map.get('A1A')?.feeCents).toBe(499);
    // `null`, not 0 — never free, as distinct from always free.
    expect(map.get('A1B')?.freeAboveCents).toBeNull();
  });
});

/**
 * The booking horizon. The seed deliberately creates more days of windows than
 * a customer may book, so that a prototype nobody re-seeds keeps working — which
 * means the bound here is the ONLY thing keeping a fortnight of runway out of
 * the checkout picker, and an off-by-one either way is invisible in a screenshot.
 */
describe('slotsFrom — the booking horizon', () => {
  it('includes both ends of the range and excludes the day after it', async () => {
    await seedSlot(pool, { serviceDate: '2026-08-14', startOffsetHours: 6 });
    await seedSlot(pool, { serviceDate: '2026-08-16', startOffsetHours: 54 });
    const beyond = await seedSlot(pool, { serviceDate: '2026-08-17', startOffsetHours: 78 });

    const rows = await repo.slotsFrom('2026-08-14', '2026-08-16');

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).not.toContain(beyond);
  });

  it('excludes days before the range', async () => {
    await seedSlot(pool, { serviceDate: '2026-08-13' });
    await seedSlot(pool, { serviceDate: '2026-08-14', startOffsetHours: 6 });

    expect(await repo.slotsFrom('2026-08-14', '2026-08-16')).toHaveLength(1);
  });

  it('excludes an inactive slot, and returns one whose cutoff has passed', async () => {
    await seedSlot(pool, { serviceDate: '2026-08-14', active: false });
    // A closed window must still come back: the picker shows it as closed
    // rather than silently dropping it. `evaluateSlot` decides, not this query.
    const closed = await seedSlot(pool, {
      serviceDate: '2026-08-14',
      startOffsetHours: 1,
      cutoffOffsetHours: -2,
    });

    const rows = await repo.slotsFrom('2026-08-14', '2026-08-16');

    expect(rows.map((r) => r.id)).toEqual([closed]);
    expect(rows[0]!.cutoffAtMs).toBeLessThan(Date.now());
  });
});
