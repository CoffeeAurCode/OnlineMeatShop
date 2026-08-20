#!/usr/bin/env node
/**
 * The responsive gate: `scrollWidth === innerWidth` at every breakpoint, in
 * both locales, in both colour schemes.
 *
 * ⚠ HORIZONTAL SCROLL IS THE ONE LAYOUT BUG THAT IS INVISIBLE ON THE MACHINE
 * THAT CAUSED IT. A developer on a wide monitor never sees it; every phone
 * does, on every page, and it makes a site feel broken in a way no amount of
 * good typography recovers. So it is measured rather than eyeballed.
 *
 * Driven over the Chrome DevTools Protocol directly rather than through
 * Playwright or Puppeteer. Neither is a dependency of this project, and adding
 * a ~300 MB browser download to CI to measure one number per page is a poor
 * trade when Chrome is already installed and the protocol is a WebSocket.
 *
 * Usage (the server must already be running):
 *   node scripts/check-responsive.mjs http://localhost:3000
 *
 * 🔴 `localhost`, NEVER `127.0.0.1`, AND THIS DEFAULT WAS WRONG FOR ITS WHOLE
 * LIFE. Next 16 blocks dev-chunk requests from a host outside
 * `allowedDevOrigins`:
 *
 *   ⚠ Blocked cross-origin request to Next.js dev resource
 *     /_next/static/chunks/_1xdxhuk._.js from "127.0.0.1".
 *
 * So on `127.0.0.1` nothing hydrates. For horizontal overflow that is mostly
 * harmless — the layout is server-rendered — but it means every one of these
 * renders measured a document with NO CLIENT JAVASCRIPT, and anything whose
 * size depends on hydration (the basket counter, the address label switching
 * from a prompt to a street) was measured in its server state only. Found on
 * 2026-08-18 by a CDP probe whose buttons all did nothing.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = process.argv[2] ?? 'http://localhost:3000';

/**
 * The two ends of the plan's range plus the breakpoints between them.
 *
 * 360 is the narrowest phone the shop realistically serves and 2560 is a
 * desktop monitor; the middle three are where the grid actually changes
 * columns, which is where a layout breaks if it is going to.
 */
const VIEWPORTS = [
  { name: '360 phone', width: 360, height: 780, mobile: true },
  { name: '390 phone', width: 390, height: 844, mobile: true },
  { name: '768 tablet', width: 768, height: 1024, mobile: true },
  /*
   * ⭐ 1024 IS ALSO WHERE 1280 AT 200% BROWSER ZOOM LANDS, near enough, and
   * `04-PLAN` §12 asks for both. A page zoomed to 200% reflows at half its CSS
   * width; there is no separate zoom emulation to drive, so measuring the
   * narrow widths IS measuring the zoom.
   */
  { name: '1024 tablet', width: 1024, height: 900, mobile: false },
  { name: '1280 laptop', width: 1280, height: 900, mobile: false },
  { name: '2560 desktop', width: 2560, height: 1440, mobile: false },
];

/*
 * ⚠ `/checkout` IS IN THIS LIST NOW, and it was the notable omission. It
 * renders its empty-basket state here, since the sweep drives a fresh profile
 * with no `localStorage`, which is a real layout with a real heading and is
 * exactly the state a customer who taps the wrong thing sees. The filled state
 * is not reachable without a scripted basket and is covered by the e2e suite.
 */
const PATHS = [
  '',
  '/shop',
  '/shop/lobster',
  '/p/atlantic-salmon-fillet',
  '/how-weighing-works',
  '/delivery',
  '/checkout',
];
const LOCALES = ['fr', 'en'];
const SCHEMES = ['light', 'dark'];

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  // ⚠ macOS WAS MISSING FROM THIS LIST, so the gate reported "Chrome not
  // found" on a machine with Chrome installed and every developer on a Mac
  // has been skipping it. CI is Linux, which is why it was never noticed.
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('Chrome not found. This check needs a Chrome or Chromium binary.');
  process.exit(1);
}

const port = 9333;
const profile = mkdtempSync(join(tmpdir(), 'fishshop-cdp-'));
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
  ],
  { stdio: 'ignore' },
);

process.on('exit', () => chrome.kill());

const wsUrl = await waitForDevTools(port);
const failures = [];
let checked = 0;

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

// One tab, reused. Creating a target per combination would be 120 browser
// tabs and most of the runtime.
const { result: target } = await send('Target.createTarget', { url: 'about:blank' });
const { result: attached } = await send('Target.attachToTarget', {
  targetId: target.targetId,
  flatten: true,
});
const session = attached.sessionId;

await send('Page.enable', {}, session);
await send('Runtime.enable', {}, session);

for (const scheme of SCHEMES) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, session);

  for (const vp of VIEWPORTS) {
    await send(
      'Emulation.setDeviceMetricsOverride',
      { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile },
      session,
    );

    for (const locale of LOCALES) {
      for (const path of PATHS) {
        const url = `${ORIGIN}/${locale}${path}`;
        await send('Page.navigate', { url }, session);
        await waitForLoad(session);

        const { result } = await send(
          'Runtime.evaluate',
          {
            expression: `(() => {
              const de = document.documentElement;
              /*
               * clientWidth, NOT window.innerWidth.
               *
               * Under mobile emulation innerWidth reports the VISUAL viewport,
               * which Chrome inflates: at an emulated 360px it reads 1133.
               * Comparing against it silently passes any overflow narrower
               * than that, on exactly the two widths where overflow matters
               * most. documentElement.clientWidth is the layout viewport and
               * reads a true 360.
               *
               * Measured, after this script's own first version reported a
               * clean sweep against the wrong number.
               */
              const viewport = de.clientWidth;
              // The widest element that actually overflows, named, so a
              // failure points at the culprit instead of at the page.
              let widest = null;
              if (de.scrollWidth > viewport) {
                for (const el of document.querySelectorAll('*')) {
                  const r = el.getBoundingClientRect();
                  if (r.right > viewport + 1 || r.left < -1) {
                    widest = el.tagName.toLowerCase() +
                      (el.className && typeof el.className === 'string'
                        ? '.' + el.className.split(' ').slice(0, 3).join('.')
                        : '');
                    break;
                  }
                }
              }
              return JSON.stringify({
                scrollWidth: de.scrollWidth,
                viewport,
                title: document.title,
                lang: de.lang,
                h1: document.querySelectorAll('h1').length,
                imgNoAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length,
                widest,
              });
            })()`,
            returnByValue: true,
          },
          session,
        );

        const data = JSON.parse(result.result.value);
        checked += 1;

        const where = `${scheme.padEnd(5)} ${vp.name.padEnd(13)} ${locale} ${path || '/'}`;

        /*
         * ⭐ THE CHECK ON THE CHECK. If the device-metrics override stops
         * applying, every measurement below is taken at the wrong width and
         * the whole sweep reports a clean pass that means nothing. This is the
         * failure the first version of this script actually had.
         */
        if (data.viewport !== vp.width) {
          failures.push(
            `VIEWPORT NOT APPLIED  ${where}  measured ${data.viewport}, expected ${vp.width}`,
          );
        }

        // A pixel of slack: sub-pixel layout rounding can put `scrollWidth`
        // one above the viewport with nothing actually clipped or scrollable.
        if (data.scrollWidth > data.viewport + 1) {
          failures.push(
            `HORIZONTAL SCROLL  ${where}  ${data.scrollWidth} > ${data.viewport}` +
              (data.widest ? `  culprit: ${data.widest}` : ''),
          );
        }
        // Exactly one h1 per page. Zero is a document with no title for a
        // screen reader; more than one is two documents pretending to be one.
        if (data.h1 !== 1) failures.push(`H1 COUNT ${data.h1}       ${where}`);
        if (data.imgNoAlt > 0) failures.push(`IMG WITHOUT ALT ${data.imgNoAlt}  ${where}`);

        const expectedLang = locale === 'fr' ? 'fr-CA' : 'en-CA';
        if (data.lang !== expectedLang) {
          failures.push(`LANG ${data.lang} expected ${expectedLang}  ${where}`);
        }
      }
    }
  }
}

ws.close();
chrome.kill();

console.log(`\nChecked ${checked} page renders (${SCHEMES.length} schemes x ${VIEWPORTS.length} viewports x ${LOCALES.length} locales x ${PATHS.length} paths).`);

if (failures.length > 0) {
  console.error(`\n${failures.length} FAILURES:\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('No horizontal scroll. One h1 per page. Every image has alt. lang matches the locale.\n');

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

/**
 * Wait for the load event, then one animation frame.
 *
 * ⚠ `Page.navigate` resolving is NOT the page being ready: it resolves when
 * navigation is committed, which is before anything has rendered. Measuring
 * there reports the width of an empty document and passes every time.
 */
function waitForLoad(sessionId) {
  return new Promise((resolve) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Page.loadEventFired' && msg.sessionId === sessionId) {
        ws.removeEventListener('message', onMessage);
        setTimeout(resolve, 250);
      }
    };
    ws.addEventListener('message', onMessage);
    // A page that never fires load must not hang the whole run.
    setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      resolve();
    }, 15_000);
  });
}
