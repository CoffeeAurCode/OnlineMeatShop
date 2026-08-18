/**
 * A PNG decoder and a pixel differ, in about a hundred lines and no
 * dependencies.
 *
 * ⚠ WHY NOT `pixelmatch` AND `pngjs`. The same reason `check-responsive.mjs`
 * drives Chrome over a raw WebSocket instead of installing Playwright: this
 * repository's whole browser-gate story is "the protocol is already there and
 * the browser is already installed". Two more packages in the dependency tree
 * of a public repository, to unfilter a scanline and subtract two bytes, is a
 * worse trade than the fifty lines below.
 *
 * What it handles: 8-bit, non-interlaced, colour type 2 (RGB) or 6 (RGBA) —
 * which is what `Page.captureScreenshot` emits, every time. Anything else
 * throws by name rather than decoding to noise, because a differ that silently
 * misreads its input reports a clean pass forever.
 */

import { inflateSync } from 'node:zlib';

/** @returns {{width:number,height:number,channels:number,data:Buffer}} */
export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

  let offset = 8;
  let header = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colourType: body[9],
        interlace: body[12],
      };
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    // 4 length + 4 type + body + 4 CRC.
    offset += 12 + length;
  }

  if (header === null) throw new Error('PNG has no IHDR');
  if (header.bitDepth !== 8) throw new Error(`PNG bit depth ${header.bitDepth} unsupported`);
  if (header.interlace !== 0) throw new Error('interlaced PNG unsupported');
  if (header.colourType !== 2 && header.colourType !== 6) {
    throw new Error(`PNG colour type ${header.colourType} unsupported`);
  }

  const channels = header.colourType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = header.width * channels;
  const out = Buffer.alloc(stride * header.height);

  /*
   * Un-filtering. Each scanline is prefixed with one filter byte, and every
   * filter refers to the pixel to the LEFT (`a`), the one ABOVE (`b`) and the
   * one above-left (`c`) — of the already-reconstructed output, never of the
   * filtered input. Getting that wrong decodes the first row correctly and
   * turns everything below it into diagonal smear, which is a memorable
   * enough symptom to name here.
   */
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));

    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      const v = line[x];

      let value;
      switch (filter) {
        case 0:
          value = v;
          break;
        case 1:
          value = v + a;
          break;
        case 2:
          value = v + b;
          break;
        case 3:
          value = v + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }
      out[y * stride + x] = value & 0xff;
    }
  }

  return { width: header.width, height: header.height, channels, data: out };
}

/**
 * Compare two decoded images, ignoring rectangles.
 *
 * ⚠ THE MASKS ARE WHY THIS IS USABLE AT ALL. Prices, stock weights, dates and
 * order tokens change between runs for reasons that have nothing to do with
 * layout, and a differ that counts them reports a diff on every capture until
 * nobody reads it any more.
 *
 * `tolerance` is per channel: anti-aliasing on a subpixel-positioned glyph
 * moves a channel by a few units without anything having moved.
 */
export function diffImages(a, b, masks = [], tolerance = 8) {
  if (a.width !== b.width || a.height !== b.height) {
    return {
      comparable: false,
      reason: `size ${a.width}x${a.height} vs ${b.width}x${b.height}`,
      changed: 0,
      total: a.width * a.height,
      fraction: 1,
      box: null,
    };
  }

  const masked = (x, y) =>
    masks.some((m) => x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height);

  let changed = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      if (masked(x, y)) continue;
      const ia = (y * a.width + x) * a.channels;
      const ib = (y * b.width + x) * b.channels;
      // Alpha is deliberately not compared: a screenshot is opaque, and a
      // difference there would be a bug in the capture rather than in the page.
      const differs =
        Math.abs(a.data[ia] - b.data[ib]) > tolerance ||
        Math.abs(a.data[ia + 1] - b.data[ib + 1]) > tolerance ||
        Math.abs(a.data[ia + 2] - b.data[ib + 2]) > tolerance;
      if (differs) {
        changed += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  const total = a.width * a.height;
  return {
    comparable: true,
    reason: null,
    changed,
    total,
    fraction: changed / total,
    box: changed === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}
