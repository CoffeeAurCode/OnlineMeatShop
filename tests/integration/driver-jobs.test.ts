import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { migrateTestDatabase, testPool, truncateAll } from './helpers/db';
import {
  FSA_SERVED,
  seedBusinessDay,
  seedCustomer,
  seedPerKgProduct,
  seedServedArea,
  seedSlot,
} from './helpers/fixtures';

/**
 * ⭐⭐ THE DRIVER PORTAL'S TWO GATES.
 *
 *   1. **SCOPING.** A driver sees their own jobs and nothing else. This is the
 *      whole security model of the portal, and what it protects is every
 *      customer's home address and phone number.
 *   2. **THE CASH BACKSTOP.** A cash order cannot reach DELIVERED without the
 *      exact money recorded against it — enforced in the repository AND by
 *      `order_cod_settled_on_delivery`, so a future route handler that forgets
 *      to ask produces a failed transaction rather than a silent loss.
 *
 * ⚠ BOTH FAIL SILENTLY IF WRONG. A leaked address is invisible until somebody
 * complains; a cash shortfall is invisible until somebody counts up at the end
 * of a week and cannot reconstruct which drop it came from. That is precisely
 * why they are tested against a real Postgres rather than reasoned about.
 *
 * ⚠ EVERY FIXTURE IS FICTIONAL — `A1A`, `1 Test Street`, 555 numbers. This
 * repository is public.
 */

let pool: Pool;
let repo: typeof import('@/db/repositories/driver');

beforeAll(async () => {
  await migrateTestDatabase();
  pool = testPool();
  repo = await import('@/db/repositories/driver');
});

afterAll(async () => {
  await pool.end();
  const { pool: appPool } = await import('@/db/client');
  await appPool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

async function seedPartner(name: string, phone: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO delivery_partner (name, phone) VALUES ($1, $2) RETURNING id`,
    [name, phone],
  );
  return rows[0].id as string;
}

interface SeedOrderArgs {
  readonly partnerId: string | null;
  readonly payMode?: 'PREPAID' | 'COD';
  readonly status?: string;
  readonly finalTotalCents?: number | null;
}

/**
 * The shop, once per test.
 *
 * ⚠ SEPARATE FROM `seedOrder` BECAUSE THE WORLD IS NOT PER-ORDER. Folding this
 * in meant a test placing three orders inserted the same FSA three times and
 * died on `serviceable_fsa_pkey` — which reads as a bug in the test rather
 * than in its setup, and cost a run to work out.
 */
interface World {
  readonly dayId: string;
  readonly slotId: string;
  readonly customerId: string;
}

async function seedWorld(): Promise<World> {
  await seedServedArea(pool);
  const fish = await seedPerKgProduct(pool, { slug: 'sample-cod', ratePerKgCents: 3299 });
  const dayId = await seedBusinessDay(pool, '2026-08-17', [
    { productId: fish.id, stockedG: 10_000 },
  ]);
  const slotId = await seedSlot(pool, { capacity: 10 });
  const customerId = await seedCustomer(pool);
  return { dayId, slotId, customerId };
}

async function seedOrder(world: World, args: SeedOrderArgs): Promise<string> {
  const status = args.status ?? 'OUT';
  const payMode = args.payMode ?? 'PREPAID';
  // inv-O5: a final total exists exactly when weighing is done, so a status at
  // or past WEIGHED must carry one or the CHECK refuses the insert.
  const finalTotal =
    args.finalTotalCents === undefined
      ? ['WEIGHED', 'READY', 'OUT', 'DELIVERED'].includes(status)
        ? 5_000
        : null
      : args.finalTotalCents;

  const { rows } = await pool.query(
    `INSERT INTO "order"
       (customer_id, postal_code, fsa, address_line1, city, province,
        slot_id, business_day_id, pay_mode, status,
        est_line_total_cents, delivery_fee_cents, est_total_cents, final_total_cents,
        catalog_version, slot_hot_eligible, has_hot_line,
        delivery_partner_id, partner_name, partner_phone, assigned_at)
     VALUES ($1, $2, $3, '1 Test Street', 'Testville', 'QC',
             $4, $5, $6, $7, 5000, 0, 5000, $8, 1, false, false,
             $9, $10, $11, $12)
     RETURNING id`,
    [
      world.customerId,
      `${FSA_SERVED} 1A1`,
      FSA_SERVED,
      world.slotId,
      world.dayId,
      payMode,
      status,
      finalTotal,
      args.partnerId,
      args.partnerId === null ? null : 'Sample Driver',
      args.partnerId === null ? null : '+15145550142',
      args.partnerId === null ? null : new Date(),
    ],
  );
  return rows[0].id as string;
}

describe('1. ⭐ SCOPING — a driver sees their own jobs and nothing else', () => {
  it('lists only the orders assigned to that partner', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const sam = await seedPartner('Sample Sam', '+15145550002');

    const mine = await seedOrder(world, { partnerId: alex });
    await seedOrder(world, { partnerId: sam });
    await seedOrder(world, { partnerId: null, status: 'PLACED' });

    const jobs = await repo.jobsForPartner(alex);
    expect(jobs.map((j) => j.orderId)).toEqual([mine]);
  });

  it('⭐ refuses another partner’s order EVEN WITH ITS EXACT ID', async () => {
    /*
     * The attack this closes is not sophisticated: a driver who has ever been
     * assigned an order knows what these URLs look like, and a UUID in a
     * browser history is a UUID somebody can retype. Because the partner id is
     * part of the LOOKUP rather than a check afterwards, the answer is `null`
     * — the same answer as an order that does not exist.
     */
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const sam = await seedPartner('Sample Sam', '+15145550002');
    const theirs = await seedOrder(world, { partnerId: sam });

    expect(await repo.jobForPartner(alex, theirs)).toBeNull();
    // And it is genuinely visible to the partner who owns it, so the null
    // above is scoping rather than a broken query.
    expect(await repo.jobForPartner(sam, theirs)).not.toBeNull();
  });

  it('refuses to close another partner’s order', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const sam = await seedPartner('Sample Sam', '+15145550002');
    const theirs = await seedOrder(world, { partnerId: sam });

    const result = await repo.reportDelivery(alex, theirs, null, Date.now());
    expect(result).toEqual({ ok: false, reason: 'notFound' });

    const { rows } = await pool.query(`SELECT status FROM "order" WHERE id = $1`, [theirs]);
    expect(rows[0].status).toBe('OUT');
  });
});

describe('2. Closing a prepaid job', () => {
  it('closes on one tap, with no cash', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex, payMode: 'PREPAID' });

    expect(await repo.reportDelivery(alex, orderId, null, Date.now())).toEqual({
      ok: true,
      outcome: 'exact',
      status: 'DELIVERED',
    });

    const { rows } = await pool.query(
      `SELECT status, delivered_at, cash_collected_cents FROM "order" WHERE id = $1`,
      [orderId],
    );
    expect(rows[0].status).toBe('DELIVERED');
    expect(rows[0].delivered_at).not.toBeNull();
    expect(rows[0].cash_collected_cents).toBeNull();
  });

  it('refuses cash against a prepaid order — two rails, one basket', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex, payMode: 'PREPAID' });

    expect(await repo.reportDelivery(alex, orderId, 5_000, Date.now())).toEqual({
      ok: false,
      reason: 'cashNotAllowed',
    });
  });

  it('⭐ refuses a SECOND report — what a double tap on one bar of signal looks like', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex, payMode: 'PREPAID' });

    await repo.reportDelivery(alex, orderId, null, Date.now());
    expect(await repo.reportDelivery(alex, orderId, null, Date.now())).toEqual({
      ok: false,
      reason: 'notOut',
    });
  });

  it('refuses before the counter has handed the order over', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex, status: 'READY' });

    expect(await repo.reportDelivery(alex, orderId, null, Date.now())).toEqual({
      ok: false,
      reason: 'notOut',
    });
  });
});

describe('3. ⭐⭐ THE CASH GATE — exactly, not at least', () => {
  it('closes a cash order when the exact amount comes back', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex, payMode: 'COD', finalTotalCents: 4_620 });

    expect(await repo.reportDelivery(alex, orderId, 4_620, Date.now())).toEqual({
      ok: true,
      outcome: 'exact',
      status: 'DELIVERED',
    });

    const { rows } = await pool.query(
      `SELECT status, cash_collected_cents, cash_reported_at FROM "order" WHERE id = $1`,
      [orderId],
    );
    expect(rows[0]).toMatchObject({ status: 'DELIVERED', cash_collected_cents: 4_620 });
    expect(rows[0].cash_reported_at).not.toBeNull();
  });

  it('⭐ RECORDS a shortfall and leaves the order OPEN', async () => {
    /*
     * The design decision this test exists to pin down. The obvious choice —
     * reject the report — is wrong: the food is at the door, the money is in
     * somebody's pocket, and refusing the report leaves the only record of the
     * discrepancy in one person's memory on a driveway.
     */
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex, payMode: 'COD', finalTotalCents: 4_620 });

    expect(await repo.reportDelivery(alex, orderId, 4_000, Date.now())).toEqual({
      ok: true,
      outcome: 'short',
      status: 'OUT',
    });

    const { rows } = await pool.query(
      `SELECT status, cash_collected_cents FROM "order" WHERE id = $1`,
      [orderId],
    );
    expect(rows[0]).toMatchObject({ status: 'OUT', cash_collected_cents: 4_000 });
  });

  it('⭐ treats an OVERPAYMENT the same way — the customer paid too much', async () => {
    // The case an "at least" check waves straight through, which is why it is
    // tested separately from the shortfall rather than assumed symmetric.
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex, payMode: 'COD', finalTotalCents: 4_620 });

    expect(await repo.reportDelivery(alex, orderId, 5_000, Date.now())).toEqual({
      ok: true,
      outcome: 'over',
      status: 'OUT',
    });
  });

  it('refuses to close a cash order with no amount at all', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex, payMode: 'COD', finalTotalCents: 4_620 });

    expect(await repo.reportDelivery(alex, orderId, null, Date.now())).toEqual({
      ok: false,
      reason: 'cashRequired',
    });
  });

  it('surfaces the mismatch to the console', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex, payMode: 'COD', finalTotalCents: 4_620 });
    await repo.reportDelivery(alex, orderId, 4_000, Date.now());

    const flagged = await repo.cashDiscrepancies();
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ dueCents: 4_620, collectedCents: 4_000 });
  });
});

describe('4. ⭐ THE DATABASE BACKSTOP', () => {
  it('refuses a DELIVERED cash order with no money recorded, in SQL', async () => {
    /*
     * ⚠ THIS BYPASSES THE REPOSITORY ENTIRELY, on purpose. The repository is
     * one `if` away from allowing this, and one `if` is easy to delete while
     * chasing something else. `order_cod_settled_on_delivery` is what makes
     * the guarantee survive that edit.
     */
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex, payMode: 'COD', finalTotalCents: 4_620 });

    await expect(
      pool.query(`UPDATE "order" SET status = 'DELIVERED' WHERE id = $1`, [orderId]),
    ).rejects.toThrow(/order_cod_settled_on_delivery/);
  });

  it('refuses a DELIVERED cash order whose recorded money is WRONG', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex, payMode: 'COD', finalTotalCents: 4_620 });

    await expect(
      pool.query(
        `UPDATE "order"
            SET status = 'DELIVERED', cash_collected_cents = 4000, cash_reported_at = now()
          WHERE id = $1`,
        [orderId],
      ),
    ).rejects.toThrow(/order_cod_settled_on_delivery/);
  });

  it('refuses cash recorded against a prepaid order', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex, payMode: 'PREPAID' });

    await expect(
      pool.query(
        `UPDATE "order" SET cash_collected_cents = 4000, cash_reported_at = now() WHERE id = $1`,
        [orderId],
      ),
    ).rejects.toThrow(/order_cash_only_on_cod/);
  });

  it('refuses an amount with no timestamp beside it', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex, payMode: 'COD', finalTotalCents: 4_620 });

    await expect(
      pool.query(`UPDATE "order" SET cash_collected_cents = 4620 WHERE id = $1`, [orderId]),
    ).rejects.toThrow(/order_cash_coherent/);
  });
});

describe('5. ⭐⭐ THE SINGLE-USE DISPATCH LINK', () => {
  let link: typeof import('@/auth/driver-link');

  beforeAll(async () => {
    link = await import('@/auth/driver-link');
  });

  async function mint(partnerId: string, orderId: string | null, ttlMs?: number) {
    const now = Date.now();
    const minted = link.mintDriverLinkToken(now);
    await repo.issueDriverLink({
      tokenHash: minted.tokenHash,
      partnerId,
      orderId,
      expiresAt: ttlMs === undefined ? minted.expiresAt : new Date(now + ttlMs),
    });
    return minted.token;
  }

  it('the token is never stored — only its hash', async () => {
    /*
     * ⚠ THE PROPERTY THAT MAKES A LEAKED BACKUP HARMLESS. Anybody who can read
     * this table would otherwise hold working sign-in links for every driver.
     */
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex });
    const token = await mint(alex, orderId);

    const { rows } = await pool.query(`SELECT token_hash FROM driver_link`);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toBe(link.hashDriverLinkToken(token));
  });

  it('⭐ READING the link does not spend it — a preview bot must not burn it', async () => {
    /*
     * The single most important behaviour here. Carriers and messaging apps GET
     * the URL out of an SMS to build a preview. If that consumed the token, the
     * driver would tap a dead link on EVERY dispatch and the feature would be
     * broken a hundred percent of the time.
     */
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex });
    const token = await mint(alex, orderId);
    const hash = link.hashDriverLinkToken(token);

    for (let i = 0; i < 3; i += 1) {
      expect(await repo.peekDriverLink(hash, Date.now())).toEqual({
        state: 'valid',
        partnerId: alex,
        orderId,
      });
    }
    // And it is still spendable afterwards.
    expect(await repo.consumeDriverLink(hash, Date.now())).toMatchObject({ state: 'valid' });
  });

  it('⭐ spends exactly once — a forwarded copy is worthless afterwards', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex });
    const token = await mint(alex, orderId);
    const hash = link.hashDriverLinkToken(token);

    expect(await repo.consumeDriverLink(hash, Date.now())).toEqual({
      state: 'valid',
      partnerId: alex,
      orderId,
    });
    expect(await repo.consumeDriverLink(hash, Date.now())).toEqual({ state: 'spent' });
  });

  it('⭐ SINGLE USE HOLDS UNDER A RACE — exactly one winner out of ten', async () => {
    /*
     * Two people tapping the same link at once is the whole scenario this
     * feature exists for. A read-then-write would let several through; the
     * conditional UPDATE on `used_at` is what makes it one, and it is the same
     * mechanism as the one-capture rule in the payment adapter.
     */
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex });
    const token = await mint(alex, orderId);
    const hash = link.hashDriverLinkToken(token);

    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => repo.consumeDriverLink(hash, now)),
    );

    expect(results.filter((r) => r.state === 'valid')).toHaveLength(1);
    expect(results.filter((r) => r.state === 'spent')).toHaveLength(9);
  });

  it('counts reuse attempts — the only signal a forward ever produces', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex });
    const token = await mint(alex, orderId);
    const hash = link.hashDriverLinkToken(token);

    await repo.consumeDriverLink(hash, Date.now());
    await repo.consumeDriverLink(hash, Date.now());
    await repo.consumeDriverLink(hash, Date.now());

    const { rows } = await pool.query(`SELECT reuse_attempts FROM driver_link`);
    expect(rows[0].reuse_attempts).toBe(2);
  });

  it('refuses an expired link, and the expiry is checked in the same statement', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex });
    // Already dead when it was written.
    const token = await mint(alex, orderId, -1000);
    const hash = link.hashDriverLinkToken(token);

    expect(await repo.peekDriverLink(hash, Date.now())).toEqual({ state: 'expired' });
    expect(await repo.consumeDriverLink(hash, Date.now())).toEqual({ state: 'expired' });
    // And an expired link is NOT marked used, so it cannot be confused with one
    // somebody actually spent.
    const { rows } = await pool.query(`SELECT used_at FROM driver_link`);
    expect(rows[0].used_at).toBeNull();
  });

  it('12 hours is the stated lifetime', () => {
    expect(link.DRIVER_LINK_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });

  it('refuses a token nobody ever issued', async () => {
    expect(await repo.peekDriverLink(link.hashDriverLinkToken('nope'), Date.now())).toEqual({
      state: 'unknown',
    });
  });

  it('⚠ removing a driver takes their unspent links with them', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex });
    await mint(alex, orderId);

    await pool.query(`DELETE FROM "order" WHERE id = $1`, [orderId]);
    await pool.query(`DELETE FROM delivery_partner WHERE id = $1`, [alex]);

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM driver_link`);
    expect(rows[0].n).toBe(0);
  });

  it('sweeps links that expired over a week ago, and keeps recent ones', async () => {
    const world = await seedWorld();
    const alex = await seedPartner('Sample Alex', '+15145550001');
    const orderId = await seedOrder(world, { partnerId: alex });
    await mint(alex, orderId, -8 * 24 * 60 * 60 * 1000);
    await mint(alex, orderId);

    expect(await repo.sweepDriverLinks(Date.now())).toBe(1);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM driver_link`);
    expect(rows[0].n).toBe(1);
  });
});
