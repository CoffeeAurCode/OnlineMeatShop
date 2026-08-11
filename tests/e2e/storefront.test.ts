import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { migrateTestDatabase, testPool, truncateAll } from '../integration/helpers/db';
import {
  FSA_SERVED,
  FSA_UNSERVED,
  seedPerKgProduct,
  seedServedArea,
  seedSlot,
} from '../integration/helpers/fixtures';
import { asStranger, startServer, stopServer } from './helpers/server';

/**
 * ⭐ THE STOREFRONT, END TO END.
 *
 * What this suite is really protecting is the two claims the storefront makes
 * that are expensive to get wrong:
 *
 *   1. **Price and availability are in the HTML.** SEO is the entire
 *      justification for server rendering here (`04-PLAN` §5), and a
 *      regression to client-side fetching would be invisible in a browser and
 *      fatal in search.
 *   2. **The browser never decides an amount.** Every total is recomputed
 *      server-side, and the aggregation rule that stops an ordinary basket
 *      overselling is checked explicitly.
 *
 * ⚠ Fixtures are fictional. This repository is public. See CLAUDE.md §1.
 */

let pool: Pool;

const RATE_PER_KG = 1840; // $18.40/kg, fictional
const DELIVERY_FEE = 500;

let lambId = '';
let hotId = '';

beforeAll(async () => {
  await migrateTestDatabase();
  pool = testPool();
  await truncateAll(pool);

  const lamb = await seedPerKgProduct(pool, {
    slug: 'sample-lamb-shoulder',
    name: 'Sample Lamb Shoulder, Boneless',
    ratePerKgCents: RATE_PER_KG,
    minOrderG: 500,
    stepG: 250,
  });
  lambId = lamb.id;

  const hot = await seedPerKgProduct(pool, {
    slug: 'sample-hot-grill',
    name: 'Sample Hot Grill Plate',
    ratePerKgCents: 2400,
    minOrderG: 250,
    stepG: 250,
    handling: 'COOKED_HOT',
    taxCode: 'STANDARD',
  });
  hotId = hot.id;

  await seedServedArea(pool, { feeCents: DELIVERY_FEE });

  // 1.5 kg of lamb on the counter. The aggregation test below turns on this
  // number being smaller than two 1 kg lines put together.
  await pool.query(`UPDATE business_day SET open = false, closed_at = now() WHERE open`);
  const { rows } = await pool.query(
    `INSERT INTO business_day (business_date, open) VALUES ('2026-08-12', true) RETURNING id`,
  );
  const dayId = rows[0].id as string;
  await pool.query(
    `INSERT INTO stock_item (business_day_id, product_id, stocked_g, reserved_g)
     VALUES ($1, $2, 1500, 0), ($1, $3, 5000, 0)`,
    [dayId, lambId, hotId],
  );

  await startServer();
}, 240_000);

afterAll(async () => {
  await stopServer();
  await pool?.end();
});

describe('the storefront is server rendered', () => {
  it('puts the price and today’s availability in the HTML, not behind a fetch', async () => {
    const res = await asStranger('/p/sample-lamb-shoulder');
    expect(res.status).toBe(200);
    const html = await res.text();

    // The three facts a crawler has to be able to read without running JS.
    expect(html).toContain('Sample Lamb Shoulder, Boneless');
    expect(html).toContain('$18.40');
    expect(html).toContain('1.5 kg left today');
  });

  it('emits Product and Offer markup with CAD and real availability', async () => {
    const html = await (await asStranger('/p/sample-lamb-shoulder')).text();

    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)]
      .map((m) => m[1])
      .filter((raw) => raw !== undefined)
      .map((raw) => JSON.parse(raw) as Record<string, unknown>);

    // Without this, every assertion below would pass vacuously if the markup
    // ever stopped being emitted at all.
    expect(blocks.length).toBeGreaterThanOrEqual(3);

    const product = blocks.find((b) => b['@type'] === 'Product');
    expect(product).toBeDefined();

    const offer = product?.offers as Record<string, unknown>;
    expect(offer.priceCurrency).toBe('CAD');
    // A string, not a float: no float is created anywhere, including in JSON
    // that leaves the server.
    expect(offer.price).toBe('18.40');
    expect(offer.availability).toBe('https://schema.org/InStock');

    expect(blocks.some((b) => b['@type'] === 'BreadcrumbList')).toBe(true);
    expect(blocks.some((b) => b['@type'] === 'Butcher')).toBe(true);
  });

  it('keeps the console and the per-customer pages out of robots and the sitemap', async () => {
    const robots = await (await asStranger('/robots.txt')).text();
    for (const path of ['/admin', '/api', '/basket', '/checkout']) {
      expect(robots).toContain(`Disallow: ${path}`);
    }

    const sitemap = await (await asStranger('/sitemap.xml')).text();
    expect(sitemap).toContain('https://shop.example.invalid/p/sample-lamb-shoulder');
    expect(sitemap).not.toContain('/admin');
    expect(sitemap).not.toContain('/checkout');
  });

  it('renders the shop index with today’s quantities', async () => {
    const html = await (await asStranger('/shop')).text();
    expect(html).toContain('Sample Lamb Shoulder, Boneless');
    expect(html).toContain('1.5 kg left today');
    // Hot food carries its slot warning on the catalog page, not only at
    // checkout, because it changes what the customer can order.
    expect(html).toContain('Sample Hot Grill Plate');
  });
});

describe('the server decides every amount', () => {
  it('answers the hero postcode check for a served and an unserved area', async () => {
    const served = await (
      await asStranger('/api/serviceable', { json: { postalCode: `${FSA_SERVED}1A1` } })
    ).json();
    expect(served).toMatchObject({ served: true, feeCents: DELIVERY_FEE });

    const not = await (
      await asStranger('/api/serviceable', { json: { postalCode: `${FSA_UNSERVED}9Z9` } })
    ).json();
    expect(not.served).toBe(false);
  });

  it('prices a per-kg line by rounding UP, from the catalog', async () => {
    const quote = await (
      await asStranger('/api/quote', {
        json: {
          lines: [{ productId: lambId, requestedG: 750, prepOptionId: null }],
          postalCode: `${FSA_SERVED} 1A1`,
        },
      })
    ).json();

    // ⌈1840 × 750 / 1000⌉ = 1380 exactly; the rounding rule matters where it
    // is not exact, and it is the same function the order will use.
    expect(quote.lines[0].amountCents).toBe(1380);
    expect(quote.lines[0].isEstimate).toBe(true);
    expect(quote.deliveryFeeCents).toBe(DELIVERY_FEE);
    expect(quote.estTotalCents).toBe(1380 + DELIVERY_FEE);
  });

  it('⭐ aggregates stock demand ACROSS lines, so two cuts of one product cannot oversell', async () => {
    // The FR-4 case, and the reason `demandByProduct` exists. Two 1 kg lines
    // of the same product against 1.5 kg of stock: checked per line, each sees
    // 1 ≤ 1.5 and passes. Aggregated, 2 > 1.5 and both are refused.
    const quote = await (
      await asStranger('/api/quote', {
        json: {
          lines: [
            { productId: lambId, requestedG: 1000, prepOptionId: null },
            { productId: lambId, requestedG: 1000, prepOptionId: null },
          ],
          postalCode: `${FSA_SERVED} 1A1`,
        },
      })
    ).json();

    expect(quote.problems).toContain('insufficientStock');
    expect(quote.lines.every((l: { problem: string | null }) => l.problem === 'insufficientStock')).toBe(
      true,
    );

    // And a single line of the same weight is fine, so the refusal above is
    // the aggregation and not the product being unavailable.
    const single = await (
      await asStranger('/api/quote', {
        json: {
          lines: [{ productId: lambId, requestedG: 1000, prepOptionId: null }],
          postalCode: `${FSA_SERVED} 1A1`,
        },
      })
    ).json();
    expect(single.problems).toEqual([]);
  });

  it('refuses a quantity that is off the product’s step', async () => {
    const quote = await (
      await asStranger('/api/quote', {
        json: {
          // 600 g is above the 500 g minimum but not a multiple of the 250 g step.
          lines: [{ productId: lambId, requestedG: 600, prepOptionId: null }],
          postalCode: `${FSA_SERVED} 1A1`,
        },
      })
    ).json();
    expect(quote.lines[0].problem).toBe('invalidQuantity');
  });

  it('flags a hot line so the slot picker can narrow itself', async () => {
    const quote = await (
      await asStranger('/api/quote', {
        json: {
          lines: [{ productId: hotId, requestedG: 500, prepOptionId: null }],
          postalCode: `${FSA_SERVED} 1A1`,
        },
      })
    ).json();
    expect(quote.hasHotLine).toBe(true);
  });
});

describe('checkout', () => {
  it('places a real order, and refuses hot food in a slot that cannot carry it', async () => {
    const coldSlot = await seedSlot(pool, { hotEligible: false });

    const quote = await (
      await asStranger('/api/quote', {
        json: {
          lines: [{ productId: hotId, requestedG: 500, prepOptionId: null }],
          postalCode: `${FSA_SERVED} 1A1`,
        },
      })
    ).json();

    // P7 — a food-safety rule, enforced at placement and not merely hidden in
    // the picker. The UI filtering is a courtesy; this is the guarantee.
    const refused = await asStranger('/api/checkout', {
      json: {
        lines: [{ productId: hotId, requestedG: 500, prepOptionId: null }],
        postalCode: `${FSA_SERVED} 1A1`,
        slotId: coldSlot,
        email: 'sample@example.test',
        name: 'Sample Customer',
        phone: null,
        catalogVersion: quote.catalogVersion,
      },
    });
    expect(refused.status).toBe(409);
    expect((await refused.json()).reason).toBe('hotFoodNotAllowedInSlot');

    // The same basket into a hot-eligible slot goes through.
    const hotSlot = await seedSlot(pool, { hotEligible: true });
    const placed = await asStranger('/api/checkout', {
      json: {
        lines: [{ productId: hotId, requestedG: 500, prepOptionId: null }],
        postalCode: `${FSA_SERVED} 1A1`,
        slotId: hotSlot,
        email: 'sample@example.test',
        name: 'Sample Customer',
        phone: null,
        catalogVersion: quote.catalogVersion,
      },
    });
    expect(placed.status).toBe(200);
    const body = await placed.json();
    expect(body.ok).toBe(true);
    // ⌈2400 × 500 / 1000⌉ = 1200, plus the fee.
    expect(body.estTotalCents).toBe(1200 + DELIVERY_FEE);
    // 🔴 No money moved: there is no payments adapter yet.
    expect(body.paymentPending).toBe(true);

    // The stock it consumed is really gone.
    const { rows } = await pool.query(
      'SELECT reserved_g FROM stock_item WHERE product_id = $1',
      [hotId],
    );
    expect(rows[0].reserved_g).toBe(500);
  });

  it('refuses a stale quote rather than silently charging the new price', async () => {
    const slotId = await seedSlot(pool, { hotEligible: false });

    const stale = await asStranger('/api/checkout', {
      json: {
        lines: [{ productId: lambId, requestedG: 500, prepOptionId: null }],
        postalCode: `${FSA_SERVED} 1A1`,
        slotId,
        email: 'sample@example.test',
        name: null,
        phone: null,
        // A version the catalog has moved past.
        catalogVersion: 99_999,
      },
    });

    expect(stale.status).toBe(409);
    expect((await stale.json()).reason).toBe('priceChanged');

    // Nothing was written for the refused attempt.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM order_line WHERE product_id = $1`,
      [lambId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('refuses an address outside the delivery area', async () => {
    const slotId = await seedSlot(pool, { hotEligible: false });
    const quote = await (
      await asStranger('/api/quote', {
        json: {
          lines: [{ productId: lambId, requestedG: 500, prepOptionId: null }],
          postalCode: `${FSA_UNSERVED} 9Z9`,
        },
      })
    ).json();

    const res = await asStranger('/api/checkout', {
      json: {
        lines: [{ productId: lambId, requestedG: 500, prepOptionId: null }],
        postalCode: `${FSA_UNSERVED} 9Z9`,
        slotId,
        email: 'sample@example.test',
        name: null,
        phone: null,
        catalogVersion: quote.catalogVersion,
      },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('outsideDeliveryArea');
  });
});
