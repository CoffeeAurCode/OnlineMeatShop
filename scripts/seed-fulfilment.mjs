#!/usr/bin/env node
/**
 * Seed the delivery zone, the serviceable postal areas, and the delivery
 * slots.
 *
 * ⚠ EVERY VALUE IN HERE IS A PLACEHOLDER. The real delivery radius, zone fee
 * and free-delivery threshold are DQ-3, and the real windows, cutoffs and
 * which of them carry hot food are DQ-4 — both still with the client. Nothing
 * here is a business decision; it exists so the prototype has fulfilment data
 * to act on, and it must be replaced before anyone trades on it.
 *
 * WHY A SCRIPT AND NOT A SCREEN: the owner console can open a business day and
 * adjust stock, but it has no screen for zones or slots, because their real
 * values are blocked. A live database with a full catalog and no slots or
 * serviceable FSAs looks fine on the storefront and then refuses every order
 * at checkout, which is exactly how it was found.
 *
 * Idempotent. The zone is upserted on its name, FSAs on the primary key, and a
 * slot is inserted only when that (service_date, starts_at) is not already
 * there — so re-running never duplicates a window and never resets a
 * `booked_count` that customers are already holding places in.
 *
 * Usage:
 *   DIRECT_DATABASE_URL=postgres://... node scripts/seed-fulfilment.mjs
 *
 * Optional:
 *   SEED_FSA_PREFIXES=H,M   first letters of the FSAs to serve. THE DEFAULT IS
 *                           EVERY LETTER CANADA POST USES — see below.
 *   SEED_SLOT_DAYS=14       how many days of windows to CREATE. The picker only
 *                           offers the first three (DTM §19 DQ-9, bounded in
 *                           `slotsFrom`); the rest is runway, so that a
 *                           prototype nobody re-seeds runs out of windows in a
 *                           fortnight rather than in two days.
 *   SHOP_TIMEZONE=America/Toronto
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';

try {
  process.loadEnvFile('.env.local');
} catch {
  /* no .env.local, which is expected in CI */
}

const url = process.env.SEED_DATABASE_URL ?? process.env.DIRECT_DATABASE_URL;
if (!url) {
  console.error('Set SEED_DATABASE_URL or DIRECT_DATABASE_URL.');
  process.exit(1);
}

const tz = process.env.SHOP_TIMEZONE ?? 'America/Toronto';
const days = Number(process.env.SEED_SLOT_DAYS ?? 14);
/**
 * ⚠ THE DEFAULT SERVES ALL OF CANADA, AND IT IS DELIBERATELY WRONG.
 *
 * The real radius is DQ-3, still with the client, and one storefront will never
 * deliver outside its own city. This says yes to every Canadian postal code
 * because what is being tested right now is the CUSTOMER FLOW — browse, order,
 * track — and an `outsideDeliveryArea` refusal at step three ends that for
 * everyone whose address is not in Montreal or Toronto, testers included.
 *
 * It is also NOT the shape the real answer will have: the plan is a GPS fix plus
 * the address line, so serviceability becomes a distance rather than a table of
 * three-character prefixes. Curating this list would be building the wrong
 * mechanism more carefully. Pass SEED_FSA_PREFIXES to narrow it for a demo.
 *
 * Every first letter Canada Post issues: D, F, I, O, Q and U appear nowhere, W
 * and Z never lead, and the count stays honest by leaving them out.
 */
const ALL_CANADA = 'A,B,C,E,G,H,J,K,L,M,N,P,R,S,T,V,X,Y';

const prefixes = (process.env.SEED_FSA_PREFIXES ?? ALL_CANADA)
  .split(',')
  .map((p) => p.trim().toUpperCase())
  .filter((p) => /^[A-Z]$/.test(p));

if (!Number.isInteger(days) || days < 1 || days > 14) {
  console.error('SEED_SLOT_DAYS must be an integer between 1 and 14.');
  process.exit(1);
}
if (prefixes.length === 0) {
  console.error('SEED_FSA_PREFIXES must be a comma-separated list of single letters.');
  process.exit(1);
}

/** The same TLS decision the application makes — see `seed-catalog.mjs`. */
function tls(connectionString) {
  const host = new URL(connectionString).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
  return { ca: readFileSync('certs/supabase-prod-ca-2021.crt', 'utf8'), rejectUnauthorized: true };
}

// ── The zone ───────────────────────────────────────────────────────────────
// Named so that nobody mistakes it for a decision. One zone, because a second
// one would encode a boundary the client has not drawn.

const ZONE = { name: 'Local (placeholder)', feeCents: 599, freeAboveCents: 7500 };

// ── The windows ────────────────────────────────────────────────────────────
// WALL CLOCK, converted to instants by Postgres against the shop's timezone,
// which is what makes them survive DST. The database stores `timestamptz`; the
// owner thinks "order by 2pm". The conversion happens once, here.
//
// `hotEligible` is the food-safety rule (inv-O3), not a preference: an order
// containing hot kitchen food can only go in a window that carries it. Two of
// the four do, so the rule is visible in the picker rather than vacuous.

const WINDOWS = [
  { cutoff: '08:00', start: '10:00', end: '12:00', capacity: 10, hotEligible: false },
  { cutoff: '10:00', start: '12:00', end: '14:00', capacity: 8, hotEligible: true },
  { cutoff: '14:00', start: '16:00', end: '18:00', capacity: 8, hotEligible: true },
  { cutoff: '16:00', start: '18:00', end: '20:00', capacity: 10, hotEligible: false },
];

const fsas = prefixes.flatMap((p) =>
  Array.from({ length: 10 }, (_, d) =>
    Array.from({ length: 26 }, (_, l) => `${p}${d}${String.fromCharCode(65 + l)}`),
  ).flat(),
);

const client = new pg.Client({ connectionString: url, ssl: tls(url) });
await client.connect();

let slotsInserted = 0;

try {
  await client.query('BEGIN');

  const { rows } = await client.query(
    `INSERT INTO zone (name, fee_cents, free_above_cents)
       VALUES ($1, $2, $3)
     ON CONFLICT (name) DO UPDATE SET
       fee_cents = excluded.fee_cents, free_above_cents = excluded.free_above_cents
     RETURNING id`,
    [ZONE.name, ZONE.feeCents, ZONE.freeAboveCents],
  );
  const zoneId = rows[0].id;

  // `unnest` rather than a loop: a few thousand round trips to a pooler in
  // another region is minutes of waiting for no reason.
  await client.query(
    `INSERT INTO serviceable_fsa (fsa, zone_id)
       SELECT f, $2 FROM unnest($1::text[]) AS f
     ON CONFLICT (fsa) DO UPDATE SET zone_id = excluded.zone_id`,
    [fsas, zoneId],
  );

  for (const w of WINDOWS) {
    const inserted = await client.query(
      `INSERT INTO slot (service_date, starts_at, ends_at, cutoff_at, capacity, hot_eligible, active)
         SELECT g.d::date,
                (g.d::date + $2::time) AT TIME ZONE $1,
                (g.d::date + $3::time) AT TIME ZONE $1,
                (g.d::date + $4::time) AT TIME ZONE $1,
                $5, $6, true
           FROM generate_series(
                  (now() AT TIME ZONE $1)::date,
                  (now() AT TIME ZONE $1)::date + ($7::int - 1),
                  interval '1 day') AS g(d)
          WHERE NOT EXISTS (
                  SELECT 1 FROM slot s
                   WHERE s.service_date = g.d::date
                     AND s.starts_at = (g.d::date + $2::time) AT TIME ZONE $1)
       RETURNING id`,
      [tz, w.start, w.end, w.cutoff, w.capacity, w.hotEligible, days],
    );
    slotsInserted += inserted.rowCount;
  }

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}

console.log(
  `Seeded zone "${ZONE.name}", ${fsas.length} serviceable FSAs (${prefixes.join(', ')}), ` +
    `and ${slotsInserted} new slots across ${days} day(s) in ${tz}.`,
);
console.log('⚠ Placeholder fulfilment data. Replace it with the real zone and windows (DQ-3, DQ-4).');
if (prefixes.length > 3) {
  console.log('⚠ This deployment now says YES to every Canadian postal code. That is a prototype');
  console.log('  setting for testing the customer flow, not a delivery area.');
}
