#!/usr/bin/env node
/**
 * Seed the eight counters and the catalog that sits on them.
 *
 * ⚠ THIS IS PLACEHOLDER CATALOG DATA. The category taxonomy is real: it is
 * read off the shop's own landing page, which already names these eight
 * counters. The PRODUCTS AND PRICES ARE INVENTED, plausibly, so the prototype
 * has something to demonstrate. They must be replaced with the shop's real
 * catalog before anyone trades on this.
 *
 * ⭐ EVERY `image_path` HERE POINTS AT `/painted/`, WHICH IS PAINTING AND NOT
 * PHOTOGRAPHY, and the directory is named that way so the distinction is
 * visible in the path itself rather than buried in a comment. §6 forbids
 * generated imagery POSING AS a product photograph, because a customer who
 * ordered from a picture and got a different cut is a refund and a lost
 * regular. A gouache illustration does not pose: nobody mistakes it for the
 * fillet that will arrive, so it can carry the IDENTITY of the product — this
 * is mackerel, that is halibut — without making a promise about the portion.
 *
 * ⚠ THAT IS THE WHOLE JUSTIFICATION, AND IT ONLY HOLDS WHILE THE ART STAYS
 * OBVIOUSLY PAINTED. If anyone re-renders this set photorealistically it goes
 * straight back to being the thing §6 bans. When the shop supplies real
 * photographs of its real cuts, those replace these and live in
 * `/sherbrooke/`.
 *
 * ⚠ WHAT THIS REPLACED WAS WORSE THAN NOTHING. Fourteen photographs were
 * spread across thirty-seven products, so cod, haddock, sea bass, trout and
 * mackerel all showed the SAME picture of a counter. That is the
 * misrepresentation §6 is actually about, and it was already shipping.
 *
 * Why invented rather than minimal: the interesting behaviour in this system
 * only shows up with a catalog that exercises it. This one deliberately spans
 * BOTH pricing modes and ALL FOUR handling classes, so that the hot-food slot
 * rule, the per-kg estimate, the pack fixed price and the weighing screen all
 * have something to act on. Eight one-line fixtures would demonstrate none of
 * that and would make the storefront look empty at 2 columns on a phone.
 *
 * Idempotent: every insert is an upsert keyed on the slug, so running it twice
 * updates rather than duplicates. It does NOT delete products that have been
 * removed from this file, because deleting a product that an order references
 * should fail loudly rather than cascade.
 *
 * Usage:
 *   DIRECT_DATABASE_URL=postgres://... node scripts/seed-catalog.mjs
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

/**
 * The same TLS decision the application makes, inlined because this script
 * runs under plain node and cannot import the TypeScript helper. Loopback is
 * plaintext (the test container); everything else pins the CA.
 */
function tls(connectionString) {
  const host = new URL(connectionString).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
  return { ca: readFileSync('certs/supabase-prod-ca-2021.crt', 'utf8'), rejectUnauthorized: true };
}

// ── The eight counters ─────────────────────────────────────────────────────
// Names and blurbs come from the shop's own landing page, so the taxonomy is
// not a guess: it is already decided. The art is painted (see the header) —
// each tile is a GROUPED counter arrangement rather than a single item, which
// is what stops a category tile reading as a product card at 82px.

const CATEGORIES = [
  {
    slug: 'fresh-fish',
    en: 'Fresh fish',
    fr: 'Poissons frais',
    blurbEn: 'A daily selection chosen for texture, colour and condition.',
    blurbFr: 'Une sélection quotidienne choisie pour sa texture, sa couleur et sa fraîcheur.',
    image: '/painted/category-fresh-fish.webp',
  },
  {
    slug: 'salmon-tuna',
    en: 'Salmon and tuna',
    fr: 'Saumon et thon',
    blurbEn: 'Atlantic salmon and yellowfin tuna, including sushi grade cuts when available.',
    blurbFr: "Saumon de l'Atlantique et thon à nageoires jaunes, qualité sushi selon les arrivages.",
    image: '/painted/category-salmon-tuna.webp',
  },
  {
    slug: 'lobster',
    en: 'Lobster',
    fr: 'Homard',
    blurbEn: 'Live and cooked lobster, prepared to order when available.',
    blurbFr: 'Homard vivant ou cuit, préparé sur demande selon la disponibilité.',
    image: '/painted/category-lobster.webp',
  },
  {
    slug: 'oysters',
    en: 'Oysters',
    fr: 'Huîtres',
    blurbEn: 'Whole and freshly shucked oysters for the counter or your table.',
    blurbFr: 'Huîtres entières ou fraîchement ouvertes, pour le comptoir ou votre table.',
    image: '/painted/category-oysters.webp',
  },
  {
    slug: 'shellfish',
    en: 'Shellfish',
    fr: 'Fruits de mer',
    blurbEn: 'Scallops, tiger shrimp and a changing shellfish selection.',
    blurbFr: 'Pétoncles, crevettes tigrées et sélection variable de coquillages.',
    image: '/painted/category-shellfish.webp',
  },
  {
    slug: 'chef-prepared',
    en: 'Chef prepared',
    fr: 'Prêt-à-manger',
    blurbEn: 'Soups, bisques, tartares, paella and signature dishes.',
    blurbFr: 'Soupes, bisques, tartares, paella et plats signatures.',
    image: '/painted/category-chef-prepared.webp',
  },
  {
    slug: 'fine-foods',
    en: 'Fine foods',
    fr: 'Épicerie fine',
    blurbEn: 'Caviar, smoked salmon, oils, vinegars and spices.',
    blurbFr: 'Caviar, saumon fumé, huiles, vinaigres et épices.',
    image: '/painted/category-fine-foods.webp',
  },
  {
    slug: 'produce-essentials',
    en: 'Produce and essentials',
    fr: 'Produits et essentiels',
    blurbEn: 'Fresh produce, pasta, noodles and selected dairy essentials.',
    blurbFr: 'Produits frais, pâtes, nouilles et produits laitiers sélectionnés.',
    image: '/painted/category-produce-essentials.webp',
  },
];

/*
 * Tax codes, populated conservatively because DQ-2 is unanswered.
 *
 * ⚠ `tax_code` is NEVER derived from `handling`. The mapping genuinely does
 * not line up: in Canada basic groceries are zero rated and prepared or hot
 * food generally is not, and the SAME cooked fish can fall either side
 * depending on how it is sold. The accountant settles this; these values are a
 * defensible starting point, not an answer.
 */
const ZERO = 'ZERO_RATED_BASIC_GROCERY';
const STD = 'STANDARD';

/** perKg: [ratePerKgCents, minOrderG, stepG]. pack: [priceCents, wMinG, wMaxG]. */
const kg = (rate, min = 250, step = 250) => ({ mode: 'perKg', rate, min, step });
const pack = (price, wMin, wMax) => ({ mode: 'pack', price, wMin, wMax });

const PRODUCTS = [
  // ── Fresh fish ───────────────────────────────────────────────────────────
  ['fresh-fish', 'atlantic-cod-fillet', 'Atlantic cod fillet', "Filet de morue de l'Atlantique",
    'Thick, flaking white fillets. Skin off, pin boned.', 'Filets blancs épais et floconneux. Sans peau, désarêtés.',
    'RAW', ZERO, kg(3299), '/painted/atlantic-cod-fillet.webp'],
  ['fresh-fish', 'haddock-fillet', 'Haddock fillet', "Filet d'aiglefin",
    'A little sweeter than cod and holds together well in a pan.', "Un peu plus doux que la morue, se tient bien à la poêle.",
    'RAW', ZERO, kg(2999), '/painted/haddock-fillet.webp'],
  ['fresh-fish', 'halibut-steak', 'Halibut steak', 'Darne de flétan',
    'Cut thick on the bone. Firm and lean.', "Coupé épais sur l'os. Ferme et maigre.",
    'RAW', ZERO, kg(6999), '/painted/halibut-steak.webp'],
  ['fresh-fish', 'whole-sea-bass', 'Whole sea bass', 'Bar entier',
    'Scaled and gutted, ready for the oven or the grill.', 'Écaillé et vidé, prêt pour le four ou le gril.',
    'RAW', ZERO, kg(3899), '/painted/whole-sea-bass.webp'],
  ['fresh-fish', 'rainbow-trout', 'Whole rainbow trout', 'Truite arc-en-ciel entière',
    'Farmed in Quebec. Mild and forgiving to cook.', 'Élevée au Québec. Douce et facile à cuisiner.',
    'RAW', ZERO, kg(2499), '/painted/rainbow-trout.webp'],
  ['fresh-fish', 'arctic-char-fillet', 'Arctic char fillet', "Filet d'omble chevalier",
    'Between salmon and trout, with a clean finish.', 'Entre le saumon et la truite, avec une finale nette.',
    'RAW', ZERO, kg(4499), '/painted/arctic-char-fillet.webp'],
  ['fresh-fish', 'whole-mackerel', 'Whole mackerel', 'Maquereau entier',
    'Oily, strong and very good over charcoal.', 'Gras, puissant et excellent sur charbon.',
    'RAW', ZERO, kg(1699), '/painted/whole-mackerel.webp'],

  // ── Salmon and tuna ──────────────────────────────────────────────────────
  ['salmon-tuna', 'atlantic-salmon-fillet', 'Atlantic salmon fillet', "Filet de saumon de l'Atlantique",
    'Centre cut, skin on. The counter staple.', 'Coupe centrale, avec peau. Le classique du comptoir.',
    'RAW', ZERO, kg(3699), '/painted/atlantic-salmon-fillet.webp'],
  ['salmon-tuna', 'salmon-steak', 'Salmon steak', 'Darne de saumon',
    'Cross cut on the bone, which keeps it moist.', "Coupée en travers sur l'os, ce qui la garde moelleuse.",
    'RAW', ZERO, kg(3499), '/painted/salmon-steak.webp'],
  ['salmon-tuna', 'yellowfin-tuna-loin', 'Yellowfin tuna loin', 'Longe de thon à nageoires jaunes',
    'Sushi grade when available. Ask at the counter.', 'Qualité sushi selon les arrivages. Demandez au comptoir.',
    'RAW', ZERO, kg(7999), '/painted/yellowfin-tuna-loin.webp'],
  ['salmon-tuna', 'maple-marinated-salmon', 'Maple marinated salmon', 'Saumon mariné à l’érable',
    'Marinated in the shop with maple and cracked pepper.', 'Mariné sur place à l’érable et au poivre concassé.',
    'MARINATED', ZERO, kg(4299), '/painted/maple-marinated-salmon.webp'],
  ['salmon-tuna', 'cold-smoked-salmon-200g', 'Cold smoked salmon, 200 g', 'Saumon fumé à froid, 200 g',
    'Sliced thin and interleaved.', 'Tranché finement et intercalé.',
    'COOKED_CHILLED', ZERO, pack(1899, 190, 210), '/painted/cold-smoked-salmon-200g.webp'],

  // ── Lobster ──────────────────────────────────────────────────────────────
  ['lobster', 'live-lobster', 'Live lobster', 'Homard vivant',
    'From the tank. Sold by the piece, about 500 to 600 g.', 'Du vivier. Vendu à la pièce, environ 500 à 600 g.',
    'RAW', ZERO, pack(2499, 500, 600), '/painted/live-lobster.webp'],
  ['lobster', 'cooked-lobster', 'Cooked lobster', 'Homard cuit',
    'Boiled in the shop this morning and chilled.', 'Bouilli sur place ce matin et refroidi.',
    'COOKED_CHILLED', ZERO, kg(4999), '/painted/cooked-lobster.webp'],
  ['lobster', 'lobster-tails-pair', 'Lobster tails, pair', 'Queues de homard, la paire',
    'Cold water tails, shell on.', "Queues d'eau froide, en carapace.",
    'RAW', ZERO, pack(3299, 220, 280), '/painted/lobster-tails-pair.webp'],
  ['lobster', 'lobster-roll-hot', 'Lobster roll, hot', 'Guédille au homard, chaude',
    'Made to order in the kitchen and sent out hot.', 'Préparée sur commande en cuisine et envoyée chaude.',
    'COOKED_HOT', STD, pack(2299, 240, 280), '/painted/lobster-roll-hot.webp'],

  // ── Oysters ──────────────────────────────────────────────────────────────
  ['oysters', 'malpeque-oysters-dozen', 'Malpeque oysters, dozen', 'Huîtres Malpeque, la douzaine',
    'Prince Edward Island. Briny and clean.', "Île-du-Prince-Édouard. Salines et nettes.",
    'RAW', ZERO, pack(2499, 700, 900), '/painted/malpeque-oysters-dozen.webp'],
  ['oysters', 'beausoleil-oysters-dozen', 'Beausoleil oysters, dozen', 'Huîtres Beausoleil, la douzaine',
    'New Brunswick. Small, sweet and mild.', 'Nouveau-Brunswick. Petites, douces et délicates.',
    'RAW', ZERO, pack(3299, 500, 700), '/painted/beausoleil-oysters-dozen.webp'],
  ['oysters', 'shucked-oysters-250g', 'Shucked oysters, 250 g', 'Huîtres écaillées, 250 g',
    'Opened in the shop. Best used the same day.', 'Ouvertes sur place. À consommer le jour même.',
    'RAW', ZERO, pack(1999, 240, 260), '/painted/shucked-oysters-250g.webp'],

  // ── Shellfish ────────────────────────────────────────────────────────────
  ['shellfish', 'sea-scallops', 'Sea scallops', 'Pétoncles géants',
    'Dry packed, so they sear instead of steaming.', 'Emballés à sec, donc ils saisissent au lieu de bouillir.',
    'RAW', ZERO, kg(5499), '/painted/sea-scallops.webp'],
  ['shellfish', 'tiger-shrimp', 'Tiger shrimp', 'Crevettes tigrées',
    'Shell on, deveined. Large, 16 to 20 a pound.', 'En carapace, déveinées. Grosses, 16 à 20 la livre.',
    'RAW', ZERO, kg(3299), '/painted/tiger-shrimp.webp'],
  ['shellfish', 'blue-mussels', 'Blue mussels', 'Moules bleues',
    'Rope grown, cleaned and bagged.', 'Élevées sur corde, nettoyées et ensachées.',
    'RAW', ZERO, kg(999, 500, 500), '/painted/blue-mussels.webp'],
  ['shellfish', 'snow-crab-clusters', 'Snow crab clusters', 'Sections de crabe des neiges',
    'Cooked and frozen at sea, thawed here.', 'Cuites et congelées en mer, décongelées ici.',
    'COOKED_CHILLED', ZERO, kg(4499), '/painted/snow-crab-clusters.webp'],
  ['shellfish', 'garlic-shrimp-skewers', 'Garlic butter shrimp skewers', "Brochettes de crevettes à l'ail",
    'Skewered and marinated in the shop, ready for the grill.', "Embrochées et marinées sur place, prêtes pour le gril.",
    'MARINATED', ZERO, kg(3999), '/painted/garlic-shrimp-skewers.webp'],

  // ── Chef prepared ────────────────────────────────────────────────────────
  ['chef-prepared', 'lobster-bisque-500ml', 'Lobster bisque, 500 ml', 'Bisque de homard, 500 ml',
    'Made from shells and reduced slowly. Reheat gently.', 'Faite à partir des carapaces et réduite lentement. Réchauffer doucement.',
    'COOKED_CHILLED', STD, pack(1499, 490, 520), '/painted/lobster-bisque-500ml.webp'],
  ['chef-prepared', 'salmon-tartare-200g', 'Salmon tartare, 200 g', 'Tartare de saumon, 200 g',
    'Cut and dressed to order. Eat the same day.', 'Coupé et assaisonné sur commande. À manger le jour même.',
    'RAW', STD, pack(1699, 190, 210), '/painted/salmon-tartare-200g.webp'],
  ['chef-prepared', 'seafood-paella-portion', 'Seafood paella, hot', 'Paella aux fruits de mer, chaude',
    'Cooked to order and sent out hot. One generous portion.', 'Cuisinée sur commande et envoyée chaude. Une portion généreuse.',
    'COOKED_HOT', STD, pack(2699, 450, 550), '/painted/seafood-paella-portion.webp'],
  ['chef-prepared', 'fish-and-chips-hot', 'Fish and chips, hot', 'Poisson-frites, chaud',
    'Haddock in beer batter, fried to order.', 'Aiglefin en pâte à la bière, frit sur commande.',
    'COOKED_HOT', STD, pack(1999, 400, 480), '/painted/fish-and-chips-hot.webp'],
  ['chef-prepared', 'crab-stuffed-sole', 'Crab stuffed sole', 'Sole farcie au crabe',
    'Rolled and stuffed in the shop. Bake from raw.', 'Roulée et farcie sur place. À cuire au four.',
    'RAW', STD, kg(4699), '/painted/crab-stuffed-sole.webp'],

  // ── Fine foods ───────────────────────────────────────────────────────────
  ['fine-foods', 'caviar-30g', 'Caviar, 30 g', 'Caviar, 30 g',
    'Served with a mother of pearl spoon, never metal.', 'À servir avec une cuillère en nacre, jamais en métal.',
    'RAW', STD, pack(8999, 28, 32), '/painted/caviar-30g.webp'],
  ['fine-foods', 'smoked-trout-pate-150g', 'Smoked trout paté, 150 g', 'Pâté de truite fumée, 150 g',
    'Whipped with lemon and a little horseradish.', 'Fouetté au citron avec un peu de raifort.',
    'COOKED_CHILLED', STD, pack(1299, 140, 160), '/painted/smoked-trout-pate-150g.webp'],
  ['fine-foods', 'lemon-dill-oil', 'Lemon and dill finishing oil', "Huile de finition citron et aneth",
    'For finishing, not for frying.', 'Pour la finition, pas pour la friture.',
    'RAW', STD, pack(1699, 240, 260), '/painted/lemon-dill-oil.webp'],
  ['fine-foods', 'fleur-de-sel', 'Fleur de sel', 'Fleur de sel',
    'Hand harvested. Finish the fish with it at the table.', 'Récoltée à la main. À saupoudrer sur le poisson à table.',
    'RAW', ZERO, pack(999, 120, 130), '/painted/fleur-de-sel.webp'],

  // ── Produce and essentials ───────────────────────────────────────────────
  ['produce-essentials', 'lemons-six', 'Lemons, bag of six', 'Citrons, sac de six',
    'Because everything on this list wants one.', 'Parce que tout le reste de cette liste en réclame un.',
    'RAW', ZERO, pack(499, 600, 750), '/painted/lemons-six.webp'],
  ['produce-essentials', 'fresh-dill', 'Fresh dill', 'Aneth frais',
    'A bunch, cut this morning.', 'Un bouquet, coupé ce matin.',
    'RAW', ZERO, pack(299, 25, 40), '/painted/fresh-dill.webp'],
  ['produce-essentials', 'squid-ink-linguine', 'Squid ink linguine, 500 g', 'Linguine à l’encre de seiche, 500 g',
    'Dried, bronze cut.', 'Sèches, tréfilées au bronze.',
    'RAW', ZERO, pack(899, 490, 510), '/painted/squid-ink-linguine.webp'],
  ['produce-essentials', 'unsalted-butter-250g', 'Unsalted butter, 250 g', 'Beurre non salé, 250 g',
    'For the sauce, and for the pan.', 'Pour la sauce, et pour la poêle.',
    'RAW', ZERO, pack(649, 245, 255), '/painted/unsalted-butter-250g.webp'],
];

/** Cut preferences. FR-4: these are NOT separate products. */
const PREPS = {
  'atlantic-cod-fillet': [['Whole piece', 'Pièce entière'], ['Cut into portions', 'Coupé en portions']],
  'atlantic-salmon-fillet': [['Whole side', 'Filet entier'], ['Cut into portions', 'Coupé en portions'], ['Skin removed', 'Sans peau']],
  'whole-sea-bass': [['Whole', 'Entier'], ['Filleted', 'En filets'], ['Butterflied', 'En crapaudine']],
  'rainbow-trout': [['Whole', 'Entier'], ['Filleted', 'En filets']],
  'yellowfin-tuna-loin': [['Whole piece', 'Pièce entière'], ['Cut into steaks', 'Coupée en darnes']],
  'live-lobster': [['Live', 'Vivant'], ['Cooked before delivery', 'Cuit avant la livraison']],
};

const client = new pg.Client({ connectionString: url, ssl: tls(url) });
await client.connect();

try {
  await client.query('BEGIN');

  for (const [i, c] of CATEGORIES.entries()) {
    await client.query(
      `INSERT INTO category (slug, name_en, name_fr, blurb_en, blurb_fr, image_path, sort_order, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)
       ON CONFLICT (slug) DO UPDATE SET
         name_en = excluded.name_en, name_fr = excluded.name_fr,
         blurb_en = excluded.blurb_en, blurb_fr = excluded.blurb_fr,
         image_path = excluded.image_path, sort_order = excluded.sort_order,
         active = true, updated_at = now()`,
      [c.slug, c.en, c.fr, c.blurbEn, c.blurbFr, c.image, i],
    );
  }

  for (const [catSlug, slug, nameEn, nameFr, descEn, descFr, handling, taxCode, pricing, image] of PRODUCTS) {
    const p = pricing.mode === 'pack'
      ? { packPrice: pricing.price, wMin: pricing.wMin, wMax: pricing.wMax, rate: null, min: null, step: null }
      : { packPrice: null, wMin: null, wMax: null, rate: pricing.rate, min: pricing.min, step: pricing.step };

    await client.query(
      `INSERT INTO product (
         slug, name, name_fr, description, description_fr, image_path,
         category_id, handling, pricing_mode,
         pack_price_cents, w_min_g, w_max_g,
         rate_per_kg_cents, min_order_g, step_g,
         tax_code, active)
       VALUES ($1,$2,$3,$4,$5,$6,
               (SELECT id FROM category WHERE slug = $7),
               $8,$9,$10,$11,$12,$13,$14,$15,$16,true)
       ON CONFLICT (slug) DO UPDATE SET
         name = excluded.name, name_fr = excluded.name_fr,
         description = excluded.description, description_fr = excluded.description_fr,
         image_path = excluded.image_path, category_id = excluded.category_id,
         handling = excluded.handling, pricing_mode = excluded.pricing_mode,
         pack_price_cents = excluded.pack_price_cents,
         w_min_g = excluded.w_min_g, w_max_g = excluded.w_max_g,
         rate_per_kg_cents = excluded.rate_per_kg_cents,
         min_order_g = excluded.min_order_g, step_g = excluded.step_g,
         tax_code = excluded.tax_code, active = true, updated_at = now()`,
      [slug, nameEn, nameFr, descEn, descFr, image, catSlug, handling, pricing.mode,
       p.packPrice, p.wMin, p.wMax, p.rate, p.min, p.step, taxCode],
    );
  }

  for (const [slug, options] of Object.entries(PREPS)) {
    // Replaced wholesale rather than upserted: prep options have no natural
    // key beyond their label, and a renamed label would otherwise accumulate
    // as a second option rather than replacing the first.
    await client.query(
      `DELETE FROM prep_option WHERE product_id = (SELECT id FROM product WHERE slug = $1)`,
      [slug],
    );
    for (const [i, [labelEn]] of options.entries()) {
      await client.query(
        `INSERT INTO prep_option (product_id, label, sort_order, active)
           VALUES ((SELECT id FROM product WHERE slug = $1), $2, $3, true)`,
        [slug, labelEn, i],
      );
    }
  }

  /*
   * Bump the catalog version. Precondition P8 compares this inside the
   * placement transaction, so a basket quoted before this seed ran must be
   * re-confirmed rather than placed at the old prices.
   */
  await client.query(`UPDATE catalog_version SET version = version + 1, updated_at = now() WHERE id = 1`);

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}

console.log(`Seeded ${CATEGORIES.length} categories and ${PRODUCTS.length} products.`);
