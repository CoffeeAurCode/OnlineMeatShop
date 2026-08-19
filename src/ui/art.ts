/**
 * Where a picture's SIZES live.
 *
 * ⚠ THIS FILE EXISTS BECAUSE `next.config.ts` SETS `images.unoptimized`. That
 * is a deliberate decision — image processing on a 0.5 vCPU instance is the
 * wrong place to spend the CPU — but it has a consequence that is easy to
 * forget and impossible to see in a screenshot: **`next/image` resizes
 * nothing.** `sizes` still emits a `srcset`, but every entry points at the one
 * file, so the browser downloads the source at its full weight no matter how
 * small the slot is.
 *
 * 🔴 THAT WAS ALREADY COSTING REAL BYTES. The catalog's menu rows draw a 96px
 * thumbnail and were handed the same file as the 4:3 card. On the photographic
 * set that was `market-counter.webp` at 556 kB, per row, for a square the size
 * of a postage stamp — about 20 MB of images on a full catalog page, nearly all
 * of it discarded by the rasteriser.
 *
 * So variants are a build-time obligation here, not an optimisation. Every
 * painting is written out twice by the asset pipeline:
 *
 *   /painted/<slug>.webp         800px on the long edge, for cards and sheets
 *   /painted/<slug>-thumb.webp   256px, for menu rows and any other chip
 *
 * `scripts/check-assets.mjs` fails the build if a `-thumb` is ever missing, so
 * the convention below cannot quietly stop being true.
 */

/** The directory whose contents are painted rather than photographed. */
const PAINTED = '/painted/';

/**
 * The small variant of a picture, when one is known to exist.
 *
 * ⚠ IT IS A PURE STRING REWRITE AND IT IS DELIBERATELY CONSERVATIVE. Only
 * `/painted/` is rewritten, because that is the only set this repository
 * generates both sizes for. A photograph under `/sherbrooke/` — or anything an
 * operator pastes into `image_path` later — is returned untouched, so the worst
 * case is the status quo (an oversized image) rather than a 404 where a
 * thumbnail should be.
 *
 * ⚠ DO NOT "IMPROVE" THIS BY DROPPING THE PREFIX TEST. The `-thumb` sibling is
 * a fact about how the file got onto disk, not about its extension, and a
 * blanket rewrite turns every future non-painted image into a broken one.
 */
export function thumb(imagePath: string): string {
  if (!imagePath.startsWith(PAINTED)) return imagePath;
  return imagePath.replace(/\.webp$/, '-thumb.webp');
}

/**
 * Whether a picture is a PAINTING rather than a photograph.
 *
 * ⭐ THIS IS THE §6 BOUNDARY, MADE QUERYABLE. The rule is that generated
 * imagery must never pose as a photograph of the actual cut; the answer this
 * project adopted is that generated imagery may carry a product's IDENTITY as
 * long as it stays visibly hand-painted. Call sites use this to apply the
 * `.painted` treatment, which is also what keeps the art legible on a dark
 * ground.
 *
 * ⚠ THE DIRECTORY IS THE SOURCE OF TRUTH ON PURPOSE. A boolean column on
 * `product` would be a second place for the answer to live and a first place
 * for it to be wrong; a path either starts with `/painted/` or it does not.
 */
export function isPainted(imagePath: string): boolean {
  return imagePath.startsWith(PAINTED);
}
