#!/usr/bin/env node
/**
 * ⭐ THE PARITY GATE. Phase 8 of the Figma parity plan.
 *
 * It does three things no other gate in this project does:
 *
 *   1. It puts the storefront into NAMED STATES — a filled basket, an open
 *      item sheet, an address sheet showing an outside-the-area verdict — and
 *      photographs each one. Every other gate here measures a page as the
 *      server sent it.
 *   2. It DIFFS each photograph against the committed baseline, so unintended
 *      visual drift between sessions is a thing somebody is told about rather
 *      than a thing somebody notices in a screenshot six weeks later.
 *   3. It PRESSES every control it names, at that control's own centre, and
 *      reports what was actually under the finger.
 *
 * ⚠ THE THIRD ONE IS NOT DECORATION. On 2026-08-18 this project shipped three
 * controls that existed, looked right in a screenshot, typechecked, linted and
 * were completely unreachable because an invisible stretched link was painted
 * over them. Nothing else in this repository presses a button.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * ⚠ IT DOES NOT DIFF AGAINST FIGMA, AND IT CANNOT. There are no adapted golden
 * frames and there is no way to generate them: the Figma REST API is read-only
 * for file content. Fidelity to the reference is checked by a HUMAN comparing
 * a capture against the exported reference PNG, at each phase checkpoint, with
 * the verdict written into `08-A-figma-frame-inventory.md` in the private
 * parent repository. Client decision, 2026-08-18. See `08-PLAN` Phase 8.
 *
 * ⚠ A DIFF IS A PROMPT TO LOOK, NOT A FAILURE. The baseline is re-blessed
 * deliberately with `--update` whenever a change is intended. What DOES fail
 * this script is a control that could not be found or could not be pressed,
 * because that is never intentional.
 *
 * ── RUNNING IT ────────────────────────────────────────────────────────────
 *
 *   npm run dev                      # or a production server
 *   node scripts/check-parity.mjs http://localhost:3000
 *   node scripts/check-parity.mjs http://localhost:3000 --update
 *   node scripts/check-parity.mjs http://localhost:3000 --only=item-sheet
 *
 * ⭐ THE COMMITTED BASELINES WERE TAKEN AGAINST THE THROWAWAY DATABASE, not
 * against whatever catalog a developer's `.env.local` points at. Reproduce it:
 *
 *   npm run db:test:up
 *   export DIRECT_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres
 *   export DATABASE_URL=$DIRECT_DATABASE_URL
 *   npx drizzle-kit migrate
 *   node scripts/seed-catalog.mjs && node scripts/seed-fulfilment.mjs
 *   psql -c "INSERT INTO business_day (business_date) VALUES (CURRENT_DATE)"
 *   node scripts/seed-stock.mjs
 *   DATABASE_URL=$DATABASE_URL ALLOW_STUB_PAYMENTS=true DEV_VERIFICATION_CODE=424242 \
 *     NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= \
 *     STAFF_SESSION_SECRET=<32+ chars> npx next dev --port 3010
 *
 * ⚠ A DIFF AGAINST A DIFFERENT CATALOG IS NOISE, not drift. The captures carry
 * real product names and photographs; point this at the seeded database or
 * re-bless the whole set.
 *
 * ⚠ `localhost`, NEVER `127.0.0.1`. Next 16 blocks dev-chunk requests from a
 * host outside `allowedDevOrigins`, so on `127.0.0.1` the page never hydrates,
 * no `onClick` handler exists anywhere, and every interactive assertion in
 * here silently measures a dead document. Measured, 2026-08-18.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng, diffImages } from './parity-png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BASELINE_DIR = join(ROOT, 'parity', 'baseline');
const CURRENT_DIR = join(ROOT, 'parity', 'current');

const args = process.argv.slice(2);
const ORIGIN = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000';
const UPDATE = args.includes('--update');
const ONLY = args.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? null;

/**
 * The phone the reference was drawn for, near enough.
 *
 * The Figma frames are 375×812 iOS; 390×844 is the device this storefront is
 * actually designed against and the width every previous session measured at.
 * Captures are 1× rather than 2×: the diff is looking for layout movement, and
 * a retina capture is four times the bytes to say the same thing.
 */
const VIEWPORT = { width: 390, height: 844, mobile: true };

/**
 * A FICTIONAL address, per `CLAUDE.md` §1 — this repository is public.
 *
 * ⚠ THE POSTAL CODE DECIDES WHAT THE SERVICEABILITY STATES SHOW, and it
 * depends on the delivery areas configured in whatever database the server is
 * pointed at. Both are overridable so a capture run can say what it means:
 *
 *   --served=H2X1Y4 --outside=X0X0X0
 */
const SERVED_POSTAL = (args.find((a) => a.startsWith('--served='))?.slice(9) ?? 'H2X 1Y4').trim();
/*
 * ⚠ THE DEFAULT OUTSIDE CODE IS `Z9Z 9Z9`, AND FINDING ONE TOOK SEVERAL TRIES.
 * `X0X`, `A9A`, `V6B`, `T2P`, `B1B` and `H0H` are all inside the delivery area
 * of the database this was first run against — the seeded FSA list is wide
 * enough to include Vancouver and Calgary — so the obvious "clearly nowhere"
 * codes all came back served and the capture silently photographed the wrong
 * state. `Z9Z` is refused, and if it ever is not, this state's capture will
 * say so in the picture rather than in an assertion.
 */
const OUTSIDE_POSTAL = (args.find((a) => a.startsWith('--outside='))?.slice(10) ?? 'Z9Z 9Z9').trim();

const SEED_LOCATION = {
  lat: null,
  lng: null,
  accuracyM: null,
  source: null,
  line1: '1 Rue Sample',
  line2: '',
  city: 'Sample City',
  region: 'QC',
  postalCode: SERVED_POSTAL,
  notes: '',
  dropOff: 'HAND_TO_ME',
};

/**
 * ⭐ THE TWO ORDER STATES ARE OPT-IN, BECAUSE THEY NEED AN ORDER.
 *
 * Tracking is the one part of the storefront that cannot be reached by
 * pressing buttons on a fresh browser: it needs a placed order, weighed,
 * finalised and dispatched. So the tokens are passed in, and the states are
 * skipped — visibly, in the report — when they are not.
 *
 *   node scripts/check-parity.mjs http://localhost:3010 \
 *     --order-active=<public token of a live order> \
 *     --order-delivered=<public token of a settled CASH order>
 *
 * ⚠ NEVER POINT THESE AT THE LIVE DATABASE. A capture of a real order is a
 * photograph of a customer's home address, and this repository is public. The
 * baselines committed here were taken against the throwaway database described
 * at the top of this file, whose only customer is a reserved 555 number.
 */
const ORDER_ACTIVE = args.find((a) => a.startsWith('--order-active='))?.slice(15) ?? null;
const ORDER_DELIVERED = args.find((a) => a.startsWith('--order-delivered='))?.slice(18) ?? null;

/**
 * ⭐ THE STATES. Each one names an application state from `08-A` §3's
 * "Maps to" column, so a reviewer can put the capture beside the reference
 * frame it was adapted from.
 *
 * `steps` is a tiny action list rather than a general scripting language, on
 * purpose: everything a parity capture needs is "go here, press that, type
 * this, wait for the other", and anything more expressive becomes a test
 * framework nobody maintains.
 */
const STATES = [
  {
    name: 'home',
    frame: '163:838 HomeScreen (Delivery)',
    path: '',
    locales: ['en', 'fr'],
    schemes: ['light', 'dark'],
    hitTest: ['nav-home', 'nav-shop', 'nav-basket', 'nav-orders'],
  },
  {
    name: 'catalog',
    frame: '289:1962 Restaurant Details (Delivery)',
    path: '/shop',
    locales: ['en', 'fr'],
    schemes: ['light', 'dark'],
    hitTest: ['first-add'],
  },
  {
    name: 'category',
    frame: '228:2312 Covenience Screen',
    path: '/shop/lobster',
    locales: ['en'],
    schemes: ['light'],
  },
  {
    name: 'product',
    frame: '408:3224 Item Detail Screen',
    path: '/p/atlantic-salmon-fillet',
    locales: ['en'],
    schemes: ['light'],
  },
  {
    name: 'item-sheet',
    frame: '314:2986 Order Selection Screen',
    path: '/shop',
    locales: ['en', 'fr'],
    schemes: ['light', 'dark'],
    steps: [
      { click: 'first-add' },
      { waitFor: '[role="dialog"][aria-labelledby="item-sheet-title"]' },
    ],
    hitTest: ['sheet-add', 'sheet-close'],
    escapeReturnsTo: 'first-add',
  },
  {
    name: 'basket-empty',
    frame: '331:2545 Carts (No basket) Screen',
    path: '',
    locales: ['en'],
    schemes: ['light'],
    steps: [{ click: 'nav-basket' }, { waitFor: '[role="dialog"]' }],
    escapeReturnsTo: 'nav-basket',
  },
  {
    name: 'basket-filled',
    frame: '330:2480 Carts (Order) Screen',
    path: '',
    locales: ['en', 'fr'],
    schemes: ['light'],
    seed: ['location', 'cart'],
    // ⚠ The waits here are for a SERVER QUOTE, not for an animation. Every
    // amount in the basket and on the checkout comes from `/api/quote`, so a
    // capture taken too early photographs skeleton bars and a disabled button.
    steps: [{ click: 'nav-basket' }, { waitFor: '[role="dialog"]' }, { wait: 2500 }],
    hitTest: ['basket-checkout'],
  },
  {
    name: 'location-sheet',
    frame: '254:1768 Change Address Screen',
    path: '',
    locales: ['en', 'fr'],
    schemes: ['light', 'dark'],
    steps: [{ click: 'address-pill' }, { waitFor: '#location-sheet-title' }],
    hitTest: ['location-save'],
    escapeReturnsTo: 'address-pill',
  },
  {
    name: 'location-invalid',
    frame: '254:1768 Change Address Screen (invalid address)',
    path: '',
    locales: ['en'],
    schemes: ['light'],
    steps: [
      { click: 'address-pill' },
      { waitFor: '#loc-postal' },
      { type: { selector: '#loc-postal', value: 'NOT A CODE' } },
      { wait: 400 },
    ],
  },
  {
    name: 'location-outside',
    frame: '254:1768 Change Address Screen (outside the area)',
    path: '',
    locales: ['en'],
    schemes: ['light'],
    steps: [
      { click: 'address-pill' },
      { waitFor: '#loc-postal' },
      { type: { selector: '#loc-postal', value: OUTSIDE_POSTAL } },
      { wait: 1500 },
    ],
  },
  {
    name: 'checkout-empty',
    frame: '335:2653 Delivery Details Screen (empty basket)',
    path: '/checkout',
    locales: ['en'],
    schemes: ['light'],
  },
  {
    name: 'checkout-filled',
    frame: '335:2653 Delivery Details Screen',
    path: '/checkout',
    locales: ['en', 'fr'],
    schemes: ['light', 'dark'],
    seed: ['location', 'cart'],
    steps: [{ wait: 3000 }],
    hitTest: ['place-order'],
  },
  {
    name: 'sign-in-sheet',
    frame: '128:792 Phone input Screen',
    path: '/checkout',
    locales: ['en'],
    schemes: ['light'],
    seed: ['location', 'cart'],
    steps: [{ wait: 3000 }, { click: 'place-order' }, { waitFor: '[role="dialog"]' }],
  },
  {
    name: 'orders-signed-out',
    frame: '426:2997 Account Screen (reduced)',
    path: '/orders',
    locales: ['en'],
    schemes: ['light'],
  },
  {
    name: 'search',
    frame: '447:2807 Search Screen',
    path: '/search?q=salmon',
    locales: ['en'],
    schemes: ['light'],
  },
  ...(ORDER_ACTIVE === null
    ? []
    : [
        {
          name: 'order-active',
          frame: '492:3016 Track order Screen',
          path: `/orders/${ORDER_ACTIVE}`,
          locales: ['en', 'fr'],
          schemes: ['light'],
        },
      ]),
  ...(ORDER_DELIVERED === null
    ? []
    : [
        {
          name: 'order-delivered-cod',
          frame: '538:3294 Delivered Screen',
          path: `/orders/${ORDER_DELIVERED}`,
          locales: ['en', 'fr'],
          schemes: ['light', 'dark'],
        },
        {
          // The half of the delivered screen the reference has no equivalent
          // for: a cash order states what the driver collected, and it is the
          // only amount on the page that is a fact rather than an estimate.
          name: 'order-payment-cod',
          frame: '538:3294 Delivered Screen (payment block — no reference equivalent)',
          path: `/orders/${ORDER_DELIVERED}`,
          locales: ['en'],
          schemes: ['light'],
          steps: [{ scrollTo: '[data-parity="payment-block"]' }],
        },
      ]),
];

/**
 * How a control is found, in the page, by a name this script uses everywhere.
 *
 * ⚠ NOT CSS SELECTORS AT THE CALL SITE. A control is identified the way a
 * customer identifies it — by what it says — wherever that is possible, so a
 * class rename does not quietly stop the gate from pressing anything. The two
 * that are structural (`first-add`, `sheet-add`) say so.
 */
const CONTROLS = {
  // The tab bar is the only `nav > ul` in the storefront, and its four tabs
  // are in a fixed order — see `bottom-nav.tsx`.
  'nav-home': 'nav ul li:nth-child(1) a',
  'nav-shop': 'nav ul li:nth-child(2) a',
  'nav-basket': 'nav ul li:nth-child(3) button',
  'nav-orders': 'nav ul li:nth-child(4) a',
  // The rest carry `data-parity`, because every text-based selector for them
  // changes with the locale and every structural one changes with the layout.
  'address-pill': '[data-parity="address-pill"]',
  'first-add': '[data-parity="add"]',
  'sheet-add': '[data-parity="sheet-add"]',
  'sheet-close': '[data-parity="sheet-close"]',
  'location-save': '[data-parity="location-save"]',
  'basket-checkout': '[data-parity="basket-checkout"]',
  'place-order': '[data-parity="place-order"]',
};

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  // ⚠ Same omission as `check-responsive.mjs` carried: no macOS path, so this
  // gate silently no-ops on every developer machine and only ever runs in CI.
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('Chrome not found. This gate needs a Chrome or Chromium binary.');
  process.exit(1);
}

mkdirSync(BASELINE_DIR, { recursive: true });
mkdirSync(CURRENT_DIR, { recursive: true });

const port = 9444;
const profile = mkdtempSync(join(tmpdir(), 'fishshop-parity-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    // Deterministic text rendering between runs on the same machine. Without
    // it a diff reports a few thousand changed pixels of pure anti-aliasing.
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
  ],
  { stdio: 'ignore' },
);
process.on('exit', () => chrome.kill());

const wsUrl = await waitForDevTools(port);
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  const resolver = pending.get(msg.id);
  if (resolver) {
    pending.delete(msg.id);
    resolver(msg);
  }
});

function send(method, params = {}, sessionId) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
}

const { result: target } = await send('Target.createTarget', { url: 'about:blank' });
const { result: attached } = await send('Target.attachToTarget', {
  targetId: target.targetId,
  flatten: true,
});
const session = attached.sessionId;

await send('Page.enable', {}, session);
await send('Runtime.enable', {}, session);
await send(
  'Emulation.setDeviceMetricsOverride',
  { ...VIEWPORT, deviceScaleFactor: 1 },
  session,
);

const results = [];
const failures = [];
/** Things worth saying that are not failures. See `nextjs-portal` below. */
const notes = [];

for (const state of STATES) {
  if (ONLY !== null && state.name !== ONLY) continue;

  for (const locale of state.locales) {
    for (const scheme of state.schemes) {
      const label = `${state.name}.${locale}.${scheme}`;
      await send(
        'Emulation.setEmulatedMedia',
        { features: [{ name: 'prefers-color-scheme', value: scheme }] },
        session,
      );

      // Every state starts from nothing. A basket left behind by the previous
      // capture is the classic way a suite like this passes while measuring
      // something nobody asked for.
      await goto(`${ORIGIN}/${locale}`);
      await evaluate('localStorage.clear(); true');

      const seeds = state.seed ?? [];
      if (seeds.includes('location')) {
        await evaluate(
          `localStorage.setItem('delivery.v1', ${JSON.stringify(JSON.stringify(SEED_LOCATION))}); true`,
        );
      }
      if (seeds.includes('cart')) {
        const seeded = await seedCart();
        if (!seeded.ok) {
          failures.push(`${label}: could not seed a basket — ${seeded.reason}`);
          continue;
        }
      }

      await goto(`${ORIGIN}/${locale}${state.path}`);
      // Hydration. Every interactive assertion below is worthless without it,
      // and `Page.loadEventFired` is well before React has attached anything.
      await settle();

      let broken = false;
      for (const step of state.steps ?? []) {
        const outcome = await runStep(step);
        if (!outcome.ok) {
          failures.push(`${label}: ${outcome.reason}`);
          broken = true;
          break;
        }
      }
      if (broken) continue;

      for (const control of state.hitTest ?? []) {
        const probe = await hitTest(control);
        if (!probe.ok) {
          failures.push(`${label}: ${control} — ${probe.reason}`);
        }
      }

      const shot = await capture();
      const masks = await maskRects();
      results.push(await compare(label, shot, masks, state.frame));

      /*
       * ⭐ ESCAPE CLOSES IT AND FOCUS GOES BACK WHERE IT CAME FROM.
       *
       * ⚠ THE SECOND HALF IS THE ONE THAT BREAKS SILENTLY. A dialog that drops
       * focus on `<body>` looks perfect and costs a keyboard user the whole
       * page: their next Tab starts again at the skip link. This project has
       * already shipped that bug once — see the mount/unmount note in
       * `cart-drawer.tsx` — and nothing else here would notice it coming back.
       */
      if (state.escapeReturnsTo !== undefined) {
        const back = await escapeAndCheck(state.escapeReturnsTo);
        if (!back.ok) failures.push(`${label}: Escape — ${back.reason}`);
      }
    }
  }
}

ws.close();
chrome.kill();

report();

// ───────────────────────────────────────────────────────────────────────────

async function goto(url) {
  await send('Page.navigate', { url }, session);
  await waitForLoad();
}

/**
 * Wait for React, not for `load`.
 *
 * The marker is any element carrying a React event handler — the tab bar's
 * basket button is a `<button>` with no `href`, so it is inert until
 * hydration and reachable the moment it is not.
 */
async function settle() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const hydrated = await evaluate(
      `!!document.querySelector('nav button') || !!document.querySelector('[role="dialog"]')`,
    );
    if (hydrated === true) break;
    await sleep(150);
  }
  // One paint after hydration, plus the standard-duration transitions the
  // sheets run on entry. Capturing mid-animation is how a differ reports a
  // change nobody made.
  await sleep(600);
}

async function runStep(step) {
  if (step.wait !== undefined) {
    await sleep(step.wait);
    return { ok: true };
  }
  if (step.waitFor !== undefined) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const there = await evaluate(`!!document.querySelector(${JSON.stringify(step.waitFor)})`);
      if (there === true) {
        await sleep(500);
        return { ok: true };
      }
      await sleep(150);
    }
    return { ok: false, reason: `nothing matched ${step.waitFor} within 8s` };
  }
  if (step.scrollTo !== undefined) {
    const ok = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(step.scrollTo)});
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      return true;
    })()`);
    await sleep(400);
    return ok === true ? { ok: true } : { ok: false, reason: `nothing matched ${step.scrollTo}` };
  }
  if (step.scroll !== undefined) {
    // Some states live below the fold of a 844px phone — the payment block on
    // a delivered order, for one — and a viewport capture of the top of the
    // page is not a capture of them.
    await evaluate(`window.scrollTo(0, ${step.scroll}); true`);
    await sleep(400);
    return { ok: true };
  }
  if (step.click !== undefined) {
    const probe = await hitTest(step.click);
    if (!probe.ok) return { ok: false, reason: `cannot press ${step.click} — ${probe.reason}` };
    await press(probe.x, probe.y);
    await sleep(500);
    return { ok: true };
  }
  if (step.type !== undefined) {
    const ok = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(step.type.selector)});
      if (!el) return false;
      // The native setter, then an input event: React tracks the previous
      // value on the node and ignores an assignment it did not see.
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set;
      el.focus();
      setter.call(el, ${JSON.stringify(step.type.value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      /*
       * ⚠ focusout, NOT blur. React's onBlur is wired to the BUBBLING
       * focusout event, and a synthetic non-bubbling 'blur' never reaches it:
       * the first version of this dispatched one, the postal-code check never
       * ran, and two capture states photographed a sheet with no verdict in it
       * while reporting a clean pass.
       */
      el.blur();
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      return true;
    })()`);
    return ok === true
      ? { ok: true }
      : { ok: false, reason: `no field matched ${step.type.selector}` };
  }
  return { ok: false, reason: `unknown step ${JSON.stringify(step)}` };
}

/**
 * ⭐ PRESS IT WHERE A FINGER WOULD LAND, AND REPORT WHAT WAS ACTUALLY THERE.
 *
 * `document.elementFromPoint` at the control's own centre is the whole point:
 * an element can exist, be visible, be the right size, and have something
 * else painted over it. That is not a hypothetical — see the header.
 */
async function hitTest(control) {
  const selector = CONTROLS[control];
  if (selector === undefined) return { ok: false, reason: `no selector registered` };

  const raw = await evaluate(`(() => {
    /*
     * ⚠ THE FIRST *VISIBLE* MATCH, NOT THE FIRST MATCH. The storefront renders
     * several controls twice and hides one copy with a breakpoint — the address
     * pill has a phone row and a desktop pill, the catalog has an add button
     * per product. \`querySelector\` would hand back a \`display: none\` element
     * at 390px and this gate would report the control as broken every run,
     * which is the fastest way to teach somebody to ignore it.
     */
    const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
    if (all.length === 0) return JSON.stringify({ found: false });

    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const el = all.find((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0 &&
        r.top >= 0 && r.bottom <= vh && r.left >= 0 && r.right <= vw;
    });
    if (!el) return JSON.stringify({ found: true, sized: false, count: all.length });

    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const at = document.elementFromPoint(x, y);
    const swallowed = at === null ? 'nothing' : (el.contains(at) || at.contains(el)) ? null
      : (at.tagName.toLowerCase() + (at.className && typeof at.className === 'string'
          ? '.' + at.className.split(' ').slice(0, 2).join('.') : ''));
    return JSON.stringify({
      found: true, sized: true, x, y, swallowed,
      height: Math.round(r.height), width: Math.round(r.width),
      name: el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 40),
    });
  })()`);

  const info = JSON.parse(raw);
  if (!info.found) return { ok: false, reason: `no element matched ${selector}` };
  if (!info.sized) {
    return {
      ok: false,
      reason: `${info.count} matched, none of them visible inside the viewport`,
    };
  }
  if (info.swallowed !== null) {
    /*
     * ⚠ `nextjs-portal` IS THE DEV INDICATOR, NOT A DEFECT. It sits bottom-left
     * over the first tab in `next dev` and is not in a production build —
     * verified on the deployed site, 2026-08-18. It is still REPORTED, so that
     * a run against a production server, where it cannot appear, would show a
     * real cover rather than swallowing it silently.
     */
    if (info.swallowed.startsWith('nextjs-portal')) {
      notes.push(`${control} sits under the Next dev indicator (dev only)`);
    } else {
      return { ok: false, reason: `covered at its own centre by ${info.swallowed}` };
    }
  }
  // 44px on both axes, the WCAG target-size floor this project treats as a
  // rule. Reported rather than fatal for a control that is deliberately small.
  if (info.height < 44 || info.width < 24) {
    return { ok: false, reason: `target ${info.width}x${info.height} is under the 44px floor` };
  }
  return { ok: true, x: info.x, y: info.y, name: info.name };
}

async function press(x, y) {
  const common = { x, y, button: 'left', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...common }, session);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...common }, session);
}

/**
 * A basket, built by USING THE SHOP, not by writing `localStorage`.
 *
 * ⚠ THAT IS DELIBERATE AND IT COSTS A FEW SECONDS PER STATE. A hand-written
 * cart entry needs a product id, which means this script would carry a copy of
 * the catalog and go stale; and it would skip the item sheet, which is one of
 * the states being photographed. Pressing the buttons proves the path exists.
 */
async function seedCart() {
  await goto(`${ORIGIN}/en/shop`);
  await settle();

  const add = await hitTest('first-add');
  if (!add.ok) return { ok: false, reason: `no add control on /en/shop (${add.reason})` };
  await press(add.x, add.y);
  await sleep(700);

  const sheetAdd = await hitTest('sheet-add');
  if (!sheetAdd.ok) return { ok: false, reason: `item sheet did not open (${sheetAdd.reason})` };
  await press(sheetAdd.x, sheetAdd.y);
  await sleep(900);

  // Adding opens the basket. Escape it, so the next navigation starts from a
  // page rather than from an overlay.
  await send(
    'Input.dispatchKeyEvent',
    { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    session,
  );
  await sleep(400);

  const lines = await evaluate(
    `(() => { try { return JSON.parse(localStorage.getItem('basket.v1') ?? '[]').length; }
      catch { return 0; } })()`,
  );
  return lines > 0 ? { ok: true } : { ok: false, reason: 'the basket stayed empty' };
}

/** Every dynamic region on screen, as rectangles the differ must ignore. */
async function maskRects() {
  const raw = await evaluate(`(() => {
    /*
     * The .tnum class is this project's tabular figures, and it is on every
     * amount, weight and count in the storefront — which is exactly the set of
     * things that change between two runs without the layout having moved.
     * [data-parity-mask] is the escape hatch for anything else.
     */
    const els = document.querySelectorAll('.tnum, time, [data-parity-mask]');
    const out = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      out.push({
        x: Math.max(0, Math.floor(r.left) - 2),
        y: Math.max(0, Math.floor(r.top) - 2),
        width: Math.ceil(r.width) + 4,
        height: Math.ceil(r.height) + 4,
      });
    }
    return JSON.stringify(out);
  })()`);
  return JSON.parse(raw);
}

async function capture() {
  /*
   * ⚠ THE NEXT DEV INDICATOR IS NOT PART OF THE STOREFRONT. It is a floating
   * badge bottom-left in `next dev` only, and leaving it in a baseline means
   * every capture carries a control the shipped site does not have — and a
   * production run would then diff against it. Removed at capture time, AFTER
   * the hit tests, so the fact that it covers the Home tab in development is
   * still reported.
   */
  await evaluate(`document.querySelectorAll('nextjs-portal').forEach((n) => n.remove()); true`);
  const { result } = await send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false },
    session,
  );
  return Buffer.from(result.data, 'base64');
}

async function compare(label, shot, masks, frame) {
  const baselinePath = join(BASELINE_DIR, `${label}.png`);
  const currentPath = join(CURRENT_DIR, `${label}.png`);
  writeFileSync(currentPath, shot);

  if (!existsSync(baselinePath) || UPDATE) {
    writeFileSync(baselinePath, shot);
    return { label, frame, status: existsSync(baselinePath) && UPDATE ? 'blessed' : 'new' };
  }

  const before = decodePng(readFileSync(baselinePath));
  const after = decodePng(shot);
  const diff = diffImages(before, after, masks);

  return {
    label,
    frame,
    status: !diff.comparable ? 'resized' : diff.changed === 0 ? 'same' : 'changed',
    detail: !diff.comparable
      ? diff.reason
      : diff.changed === 0
        ? null
        : `${(diff.fraction * 100).toFixed(2)}% of pixels, first region ${diff.box.width}x${diff.box.height} at ${diff.box.x},${diff.box.y}`,
  };
}

function report() {
  console.log(`\nParity capture — ${ORIGIN} at ${VIEWPORT.width}x${VIEWPORT.height}\n`);
  for (const r of results) {
    const mark =
      r.status === 'same' ? '·' : r.status === 'new' ? '+' : r.status === 'blessed' ? '=' : '!';
    console.log(
      `  ${mark} ${r.label.padEnd(34)} ${r.status.padEnd(8)} ${r.detail ?? ''}`.trimEnd(),
    );
    if (r.frame) console.log(`      reference: ${r.frame}`);
  }

  if (ORDER_ACTIVE === null || ORDER_DELIVERED === null) {
    console.log(
      '\n⚠ Order tracking states were SKIPPED. They need a placed order:\n' +
        '  --order-active=<token> --order-delivered=<token of a settled cash order>',
    );
  }

  const changed = results.filter((r) => r.status === 'changed' || r.status === 'resized');
  console.log(
    `\n${results.length} states captured · ${changed.length} differ from the baseline · ` +
      `${results.filter((r) => r.status === 'new').length} new`,
  );

  if (changed.length > 0) {
    console.log(
      '\n⚠ A DIFFERENCE IS A PROMPT TO LOOK, NOT A FAILURE.\n' +
        `  Compare parity/current against parity/baseline, and re-bless with --update\n` +
        '  once the change is the one you meant to make.',
    );
  }

  if (notes.length > 0) {
    console.log(`
${notes.length} notes:`);
    for (const n of [...new Set(notes)]) console.log(`  ${n}`);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} CONTROL FAILURES — these ARE failures:\n`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }

  console.log('\nEvery named control was found, sized and reachable at its own centre.\n');
}

/** Press Escape, then ask what closed and where focus landed. */
async function escapeAndCheck(openerControl) {
  await send(
    'Input.dispatchKeyEvent',
    { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    session,
  );
  await send(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    session,
  );
  await sleep(500);

  const selector = CONTROLS[openerControl];
  const raw = await evaluate(`(() => {
    const active = document.activeElement;
    return JSON.stringify({
      open: !!document.querySelector('[role="dialog"]'),
      onOpener: !!active && active.matches(${JSON.stringify(selector)}),
      active: active === null ? 'null'
        : active.tagName.toLowerCase() + (active.getAttribute('data-parity')
            ? '[' + active.getAttribute('data-parity') + ']' : ''),
    });
  })()`);

  const info = JSON.parse(raw);
  if (info.open) return { ok: false, reason: 'the dialog is still open' };
  if (!info.onOpener) {
    return { ok: false, reason: `focus landed on ${info.active}, not back on ${openerControl}` };
  }
  return { ok: true };
}

async function evaluate(expression) {
  const { result } = await send('Runtime.evaluate', { expression, returnByValue: true }, session);
  return result.result?.value;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForLoad() {
  return new Promise((resolve) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Page.loadEventFired' && msg.sessionId === session) {
        ws.removeEventListener('message', onMessage);
        setTimeout(resolve, 200);
      }
    };
    ws.addEventListener('message', onMessage);
    setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      resolve();
    }, 20_000);
  });
}

async function waitForDevTools(p) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${p}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Chrome did not expose a DevTools endpoint.');
}
