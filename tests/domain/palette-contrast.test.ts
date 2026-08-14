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
  { fg: '--accent-solid-ink', bg: '--accent-solid', min: 4.5, why: 'the footer and the hero' },
  { fg: '--hot-ink', bg: '--hot', min: 4.5, why: 'the hot kitchen pill' },
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

describe('the two known brand collisions stay resolved', () => {
  it('⭐ cyan is NEVER the accent on a light ground', () => {
    // `--brand #6dd0f5` against white is about 1.7:1: unusable for text and
    // illegible as a button fill. It is the accent on DARK only.
    const light = tokens('light');
    expect(resolve(light, '--accent')).not.toBe(resolve(light, '--brand'));

    const dark = tokens('dark');
    expect(resolve(dark, '--accent')).toBe(resolve(dark, '--brand'));
  });

  it('⭐ mist is a hairline colour and never text', () => {
    // Proving the derived `--ink-muted` was necessary: the brand's own muted
    // tone fails badly on ice, which is why it is `--line` and not text.
    const light = tokens('light');
    expect(contrast(resolve(light, '--mist'), resolve(light, '--surface'))).toBeLessThan(3);
    expect(resolve(light, '--line')).toBe(resolve(light, '--mist'));
    expect(resolve(light, '--ink-muted')).not.toBe(resolve(light, '--mist'));
  });
});
