import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * ⭐ EVERY TOKEN PAIR THAT CARRIES TEXT PASSES WCAG AA, IN BOTH SCHEMES.
 *
 * Checked here rather than in a browser because contrast is arithmetic on two
 * hex values, and arithmetic belongs in a test that runs in 40ms on every
 * commit rather than in a manual sweep somebody does once.
 *
 * ⚠ THE VALUES ARE PARSED OUT OF `globals.css`, not copied into this file.
 * A copy would drift, and a contrast test that checks last month's palette is
 * worse than none: it reports a pass for colours nobody is shipping.
 *
 * This is what caught the two real collisions in the brand: cyan cannot be the
 * accent on a light ground (about 1.7:1 against white), and `--mist` is a
 * hairline colour rather than a text colour (about 1.6:1 on ice).
 */

const CSS = readFileSync('src/app/globals.css', 'utf8');

/**
 * Read one scheme's resolved token values.
 *
 * The light block is bare `:root`; the dark one is `:root` inside the
 * `prefers-color-scheme: dark` media query. Dark INHERITS every token the
 * light block sets and overrides only some, which is exactly how the
 * stylesheet behaves, so the dark map starts as a copy of light.
 */
function tokens(scheme: 'light' | 'dark'): Map<string, string> {
  const lightBlock = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('@media (prefers-color-scheme: dark)'));
  const darkStart = CSS.indexOf('@media (prefers-color-scheme: dark)');
  const darkBlock = CSS.slice(darkStart, CSS.indexOf('@theme inline'));

  const map = new Map<string, string>();
  const read = (block: string) => {
    for (const m of block.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) {
      map.set(m[1] as string, (m[2] as string).trim());
    }
  };

  read(lightBlock);
  if (scheme === 'dark') read(darkBlock);
  return map;
}

/** Resolve `var(--x)` chains down to a literal colour. */
function resolve(map: Map<string, string>, name: string, depth = 0): string {
  const raw = map.get(name);
  if (raw === undefined) throw new Error(`token ${name} is not defined`);
  if (depth > 10) throw new Error(`token ${name} resolves in a cycle`);

  const varMatch = /^var\((--[a-z-]+)\)$/.exec(raw);
  if (varMatch) return resolve(map, varMatch[1] as string, depth + 1);
  return raw;
}

function toRgb(colour: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) {
    const n = Number.parseInt(hex[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // `rgb(199 213 215 / .18)` and friends. Only `--line` uses this, and a
  // hairline is not text, so it never reaches a contrast assertion.
  const rgb = /rgb\(\s*(\d+)\s+(\d+)\s+(\d+)/.exec(colour);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  throw new Error(`cannot parse colour: ${colour}`);
}

/** WCAG relative luminance. */
function luminance(colour: string): number {
  const [r, g, b] = toRgb(colour).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Hue in degrees, for the "are these two the same colour" checks. */
function hue(colour: string): number {
  const [r, g, b] = toRgb(colour).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  const raw = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (raw * 60 + 360) % 360;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/**
 * The pairs that actually carry text. `foreground on background`, with the
 * minimum each has to meet.
 *
 * 4.5 is AA for body text. 3.0 applies only where the text is large, and the
 * only such pair here is muted text on a section band, which is used for
 * headings and short copy.
 */
const PAIRS: readonly { fg: string; bg: string; min: number; why: string }[] = [
  { fg: '--ink', bg: '--surface', min: 4.5, why: 'body text on the page' },
  { fg: '--ink', bg: '--surface-raised', min: 4.5, why: 'body text on a card' },
  { fg: '--ink', bg: '--surface-soft', min: 4.5, why: 'body text on a section band' },
  { fg: '--ink-muted', bg: '--surface', min: 4.5, why: 'secondary text on the page' },
  { fg: '--ink-muted', bg: '--surface-raised', min: 4.5, why: 'secondary text on a card' },
  { fg: '--accent', bg: '--surface', min: 4.5, why: 'a link on the page' },
  { fg: '--accent', bg: '--surface-raised', min: 4.5, why: 'a link on a card' },
  { fg: '--accent-ink', bg: '--accent', min: 4.5, why: 'THE PRIMARY BUTTON' },
  { fg: '--brand-ground-ink', bg: '--brand-ground', min: 4.5, why: 'the footer and the hero' },
  { fg: '--hot-ink', bg: '--hot', min: 4.5, why: 'the hot kitchen pill' },
  /*
   * The badge, as opposed to the pill: near-black words on a pale neutral in
   * light, and the same relationship inverted in dark. Added with the token
   * itself — `bg-hot-wash` had four call sites and no definition, so until now
   * this pair was only ever legible by accident.
   */
  { fg: '--hot', bg: '--hot-wash', min: 4.5, why: 'the hot food badge' },
  { fg: '--danger', bg: '--surface', min: 4.5, why: 'an inline error' },
  { fg: '--danger', bg: '--danger-wash', min: 4.5, why: 'an error in its own box' },
];

describe.each(['light', 'dark'] as const)('the %s palette', (scheme) => {
  const map = tokens(scheme);

  it.each(PAIRS)('$fg on $bg passes AA ($why)', ({ fg, bg, min }) => {
    const ratio = contrast(resolve(map, fg), resolve(map, bg));
    // The received value is in the message, so a failure says how far off it
    // is rather than only that it failed.
    expect(ratio, `${fg} on ${bg} in ${scheme} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });

  it('⭐ has a focus indicator that meets the 3:1 non-text requirement', () => {
    /*
     * Checked on the COMPANION RING, not on the coral.
     *
     * Brand coral on ice is 2.94:1, which is a hair under the 3:1 a non-text
     * indicator needs. Darkening it would fix the number and cost the brand,
     * so the indicator is two colours: coral for recognition, plus a thin
     * high-contrast ring that carries the requirement. This asserts the part
     * that actually has to pass.
     */
    expect(
      contrast(resolve(map, '--focus-contrast'), resolve(map, '--surface')),
    ).toBeGreaterThanOrEqual(3);
  });

  it('records that coral alone would NOT have been enough', () => {
    // The measurement the two-part indicator exists because of. If a future
    // change makes coral pass on its own, this fails and the companion ring
    // can be reconsidered on purpose rather than dropped by accident.
    const ratio = contrast(resolve(map, '--focus'), resolve(map, '--surface'));
    if (scheme === 'light') expect(ratio).toBeLessThan(3);
  });

  /**
   * 🔴 THE ASSERTION THAT WOULD HAVE CAUGHT THE UNREADABLE FOOTER, and the
   * reason the existing pair did not.
   *
   * `--brand-ground-ink on --brand-ground` passed in both schemes the whole
   * time it was broken, because the token pair was never the problem: when the
   * ground flipped to cyan the ink flipped to midnight with it, and midnight
   * on cyan is about 11:1.
   *
   * ⚠ WHAT ACTUALLY SHIPPED WAS `text-white/75`, HARD-CODED. The home hero,
   * the storefront footer and the tracking status card all paint their body
   * copy, their hairlines and their secondary labels in literal white with an
   * alpha, because on a dark brand panel that is the obvious thing to write.
   * So the real dependency is not "the ink token suits the ground", it is
   * "WHITE suits the ground" — and nothing asserted that.
   *
   * 0.75 alpha over the ground is composited here rather than assumed, because
   * `text-white/75` is what the markup says and 4.5:1 is a threshold the
   * difference straddles.
   */
  it('🔴 keeps HARD-CODED WHITE readable on the brand ground, in both schemes', () => {
    const ground = resolve(map, '--brand-ground');
    const [bgR, bgG, bgB] = toRgb(ground);

    for (const alpha of [1, 0.8, 0.75, 0.65]) {
      const composited = `#${[bgR, bgG, bgB]
        .map((c) => Math.round(255 * alpha + c * (1 - alpha)))
        .map((c) => c.toString(16).padStart(2, '0'))
        .join('')}`;
      const ratio = contrast(composited, ground);
      expect(
        ratio,
        `white at ${alpha} alpha on --brand-ground in ${scheme} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  /**
   * 🔴 THE SAME ASSERTION FOR THE HEADER BAND, WHICH IS A SECOND GROUND AND
   * WAS NOT COVERED BY THE ONE ABOVE.
   *
   * `--brand-ground` is atlantic #06283d and white sits at 13:1 on it, so
   * every alpha down to 0.65 clears AA with room to spare. `--hero-ground` is
   * #0e7490 and white is 5.36:1 — a THIRD of the headroom. The storefront
   * header and the landing band are both painted on it and both set their
   * secondary copy in `text-white/<alpha>`, so the alpha that is safe on one
   * ground is not the alpha that is safe on the other.
   *
   * ⚠ AND THE DIFFERENCE WAS ALREADY SHIPPED WRONG. The landing band's lead
   * paragraph was `text-white/85`, which is 4.34:1 on this ground: body copy
   * at 17px regular, so the 3:1 large-text allowance does not apply to it.
   * 0.90 is 4.67:1 and is the FIRST STEP THAT PASSES, which is why nothing on
   * either surface may go below it.
   *
   * The ladder stops at 0.9 on purpose. Adding 0.85 here would not be a
   * stricter test, it would be a failing one.
   */
  it('🔴 keeps HARD-CODED WHITE readable on the HEADER BAND, in both schemes', () => {
    const ground = resolve(map, '--hero-ground');
    const [bgR, bgG, bgB] = toRgb(ground);

    for (const alpha of [1, 0.9]) {
      const composited = `#${[bgR, bgG, bgB]
        .map((c) => Math.round(255 * alpha + c * (1 - alpha)))
        .map((c) => c.toString(16).padStart(2, '0'))
        .join('')}`;
      const ratio = contrast(composited, ground);
      expect(
        ratio,
        `white at ${alpha} alpha on --hero-ground in ${scheme} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  /**
   * ⭐ THE FILLED CHIPS ON THAT BAND ARE ICON-ONLY, AND THIS IS THE NUMBER
   * THAT DECIDED IT.
   *
   * `.band-chip` composites white at 0.14 over the band to make a control read
   * as a control. White on THAT surface is about 4.1:1 — comfortably over the
   * 3:1 WCAG asks of a non-text graphic, and under the 4.5:1 it asks of words.
   * So the filled chips carry glyphs and everything with words in it uses
   * `.band-outline`, which leaves the ground alone and keeps the full 5.36:1.
   *
   * This asserts both halves: that a glyph on a chip passes, and that TEXT on
   * one would not. If a palette change ever makes the second half pass, this
   * fails, and the two appearances can be collapsed on purpose rather than
   * merged by somebody who assumed they were interchangeable.
   */
  it('⭐ keeps a filled band chip legible for GLYPHS and provably not for TEXT', () => {
    const ground = toRgb(resolve(map, '--hero-ground'));
    // `rgb(255 255 255 / 0.14)` over the band — the literal in `.band-chip`.
    const chip = `#${ground
      .map((c) => Math.round(255 * 0.14 + c * 0.86))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')}`;
    const ratio = contrast('#ffffff', chip);

    expect(ratio, `white on a band chip in ${scheme} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    expect(ratio, `white on a band chip in ${scheme} is ${ratio.toFixed(2)}:1`).toBeLessThan(4.5);
  });

  it('keeps selected text readable on the selection highlight', () => {
    // White on coral is 3.17:1 and fails AA. Selected text is still text.
    expect(contrast(resolve(map, '--midnight'), resolve(map, '--coral'))).toBeGreaterThanOrEqual(4.5);
  });

  it('⭐ keeps the error colour distinct from the focus ring', () => {
    // The collision this palette was designed around. Coral now sits on every
    // focus ring, so an error message beside a focused input must still read
    // as an error rather than as more focus decoration.
    const danger = toRgb(resolve(map, '--danger'));
    const focus = toRgb(resolve(map, '--focus'));
    const distance = Math.hypot(
      danger[0] - focus[0],
      danger[1] - focus[1],
      danger[2] - focus[2],
    );
    expect(distance, `danger ${danger} vs focus ${focus}`).toBeGreaterThan(70);

    /*
     * ⭐ SEPARATED ON HUE AND ON LIGHTNESS, in both schemes.
     *
     * Hue alone is not enough: it vanishes in greyscale and for a red-green or
     * red-blind reader. Lightness alone is not enough either, because two
     * colours of the same hue at different lightness still read as one thing
     * emphasised. Both, and the dark palette failed this until `--danger` was
     * moved 13 degrees pinker.
     */
    const hueGap = Math.min(
      Math.abs(hue(resolve(map, '--danger')) - hue(resolve(map, '--focus'))),
      360 - Math.abs(hue(resolve(map, '--danger')) - hue(resolve(map, '--focus'))),
    );
    expect(hueGap, `hue gap in ${scheme} is ${hueGap.toFixed(0)} degrees`).toBeGreaterThan(30);

    const lightnessGap = Math.abs(
      luminance(resolve(map, '--danger')) - luminance(resolve(map, '--focus')),
    );
    expect(lightnessGap, `lightness gap in ${scheme}`).toBeGreaterThan(0.1);
  });
});

describe('the brand collisions stay resolved', () => {
  /**
   * ⭐ CYAN IS THE ACCENT ON DARK AND NEVER ON LIGHT — the oldest rule in this
   * palette, and the 2026-08-19 redesign went away from it and came back.
   *
   * `--brand #6dd0f5` is the landing page's CTA colour, but there it only ever
   * sits on midnight or atlantic. Against white it is about 1.7:1: unusable as
   * text and illegible as a button fill. On the dark ground it is 10.7:1. Same
   * brand, correct contrast in both modes — so the light half of this is a
   * prohibition and the dark half is a requirement, and BOTH are asserted.
   *
   * ⚠ AN INTERMEDIATE CUT OF THE REDESIGN MADE THE ACCENT CORAL IN BOTH
   * SCHEMES, and this test was rewritten then to say cyan was the accent
   * nowhere. That was true for exactly as long as coral was the accent. The
   * lesson is not about cyan: it is that this assertion states a RELATIONSHIP
   * between the brand hue and the ground, and rewriting it to name a specific
   * colour is how it stops protecting anything.
   */
  it('🔴 the brand cyan is the accent on DARK and never on LIGHT', () => {
    const light = tokens('light');
    expect(
      resolve(light, '--accent'),
      'the raw brand cyan is 1.7:1 on white — it cannot be the accent on a light ground',
    ).not.toBe(resolve(light, '--brand'));

    const dark = tokens('dark');
    expect(resolve(dark, '--accent')).toBe(resolve(dark, '--brand'));

    // The measurement that disqualifies it on light, kept so the reason lives
    // in the file rather than only in a comment.
    expect(contrast(resolve(light, '--brand'), resolve(light, '--surface-raised'))).toBeLessThan(3);
  });

  /**
   * ⭐ THE GENERAL FORM OF THE RULE ABOVE, and the one most likely to be lost.
   *
   * Whatever the brand's headline colour is, it does not clear AA on a light
   * ground — cyan is 1.7:1 and coral is 2.9:1. So `--accent` on light is always
   * a DEEPENED version of it, never the raw hue.
   *
   * ⚠ THE FAILURE MODE IS SOMEBODY "RESTORING THE BRAND" by pointing
   * `--accent` at `--brand` or `--coral` because it looks more correct, which
   * silently drops every button and every price on the site below AA. The AA
   * pairs above would catch it; this says why in one line when they do.
   */
  it('🔴 the light accent is never a raw brand hue', () => {
    const light = tokens('light');
    for (const raw of ['--brand', '--coral', '--glass', '--mist'] as const) {
      expect(
        resolve(light, '--accent'),
        `--accent is the undarkened ${raw}, which does not clear AA on a light ground`,
      ).not.toBe(resolve(light, raw));
    }
  });

  it('⭐ the hairline colour is a hairline and never text', () => {
    /*
     * Proving the derived `--ink-muted` is necessary: the palette's hairline
     * fails badly against the ground, which is why it draws rules and not
     * words.
     *
     * ⚠ IT USED TO ASSERT `--line === --mist` SPECIFICALLY. The redesign
     * retuned the neutrals, so the brand's `--mist` is no longer the literal
     * line value — but the PROPERTY that made mist unusable as text is exactly
     * the property the new line must also have, and that is what is worth
     * pinning. `--mist` is still checked, because it is still in the file and
     * still tempting.
     */
    const light = tokens('light');
    for (const hairline of ['--line', '--mist'] as const) {
      expect(
        contrast(resolve(light, hairline), resolve(light, '--surface')),
        `${hairline} passes 3:1 and has become mistakable for a text colour`,
      ).toBeLessThan(3);
    }
    expect(resolve(light, '--ink-muted')).not.toBe(resolve(light, '--line'));
    expect(resolve(light, '--ink-muted')).not.toBe(resolve(light, '--mist'));
  });
});
