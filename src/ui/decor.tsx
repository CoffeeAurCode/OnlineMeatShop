/**
 * ⭐ THE DECORATIVE LAYER. Line art, patterns and the shapes that make the
 * interface feel finished rather than merely correct.
 *
 * ── WHY THIS IS DRAWN IN CODE AND NOT GENERATED ───────────────────────────
 *
 * ⚠ §6 BANS GENERATED IMAGERY AS PRODUCT PHOTOGRAPHY, and the reason is
 * commercial rather than aesthetic: a generated fillet misrepresents the cut,
 * the portion and the preparation the customer will actually receive, and a
 * customer who ordered from a picture and got something else is a refund and a
 * lost regular. Everything in this file is deliberately on the OTHER side of
 * that line — empty states, dividers, textures and glyphs. None of it depicts
 * a product, and none of it may ever be used where a photograph belongs.
 *
 * ⭐ THE OTHER REASON IS WEIGHT. These are a few hundred bytes of markup each,
 * they inherit `currentColor` so they are correct in both colour schemes for
 * free, and they stay sharp on a 3x display. The raster equivalents would be
 * eight more files in `public/`, eight more requests, two more variants each
 * for dark mode, and a re-export every time the palette moves.
 *
 * ── HOW TO USE THEM ───────────────────────────────────────────────────────
 *
 * Every export is a pure server-safe component: no hooks, no client boundary.
 * They take `currentColor`, so set the colour on the PARENT — `text-muted` for
 * an empty state, `text-accent` where it should carry weight.
 *
 * ⚠ ALL OF THEM ARE `aria-hidden`. They are decoration sitting beside real
 * copy that already says the thing. An illustration that needs alt text to be
 * understood is an illustration doing a job that a sentence should be doing.
 */

type DecorProps = {
  /** Tailwind sizing goes here — these have no intrinsic size. */
  className?: string;
};

/**
 * The shared stroke geometry. Pulled out because eight illustrations drifting
 * apart on stroke width is exactly how a hand-drawn set stops looking like a
 * set — and it is the kind of drift nobody notices in review because each one
 * looks fine on its own.
 */
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** The washed-out companion stroke: context lines that must not compete. */
const STROKE_SOFT = { ...STROKE, opacity: 0.35 } as const;

/* ══════════════════════════════════════════════════════════════════════════
 * EMPTY STATES
 *
 * One per dead end a customer can actually reach. Each is drawn on a 120×120
 * viewBox so they are interchangeable at a call site and so a row of them
 * across different screens reads at the same optical size.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Nothing in the basket yet. */
export function EmptyBasket({ className }: DecorProps) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden focusable="false">
      {/* The handle, drawn behind the rim so the join reads correctly. */}
      <path {...STROKE} d="M44 52 L52 30 M76 52 L68 30" />
      <path {...STROKE} d="M26 52 h68 l-7 40 a8 8 0 0 1 -8 7 h-38 a8 8 0 0 1 -8 -7 z" />
      {/* Two weave lines. Three read as a drawing of a basket; two read as a
          basket. */}
      <path {...STROKE_SOFT} d="M52 64 v22 M68 64 v22" />
      {/*
        The rising dot: the one moving part, and it is what makes an empty
        state feel like a prompt rather than a report. It is inert under
        `prefers-reduced-motion` because the base layer collapses every
        animation, and it carries no meaning that is only in the movement.
      */}
      <circle cx="60" cy="22" r="3.5" fill="currentColor" opacity="0.5">
        <animate
          attributeName="cy"
          values="22;16;22"
          dur="2.4s"
          repeatCount="indefinite"
          calcMode="spline"
          keySplines="0.32 0.72 0 1; 0.32 0.72 0 1"
          keyTimes="0;0.5;1"
        />
      </circle>
    </svg>
  );
}

/** No orders yet, or no orders in this filter. */
export function EmptyOrders({ className }: DecorProps) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden focusable="false">
      {/* A receipt, torn along the bottom. The zigzag is what says "receipt"
          rather than "document" at 64px. */}
      <path
        {...STROKE}
        d="M34 24 h52 v66 l-6.5 -5 -6.5 5 -6.5 -5 -6.5 5 -6.5 -5 -6.5 5 -6.5 -5 -6.5 5 z"
      />
      <path {...STROKE} d="M46 44 h28 M46 58 h28 M46 72 h16" />
    </svg>
  );
}

/** A search that matched nothing. */
export function EmptySearch({ className }: DecorProps) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden focusable="false">
      <circle {...STROKE} cx="54" cy="52" r="24" />
      <path {...STROKE} d="M71 69 L90 88" />
      {/* A wave inside the lens rather than a cross or a frown: this shop
          sells fish, and an empty result is not an error. */}
      <path {...STROKE_SOFT} d="M40 54 q7 -8 14 0 t14 0" />
    </svg>
  );
}

/**
 * The address is outside the delivery radius.
 *
 * ⚠ THIS IS THE ONE DEAD END THAT IS NOT THE CUSTOMER'S FAULT AND CANNOT BE
 * FIXED BY THEM. The dashed circle is doing real work — it says "there is a
 * boundary and you are beyond it", which is a different message from "nothing
 * found". Do not swap it for the search glyph.
 */
export function OutsideArea({ className }: DecorProps) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden focusable="false">
      <circle {...STROKE_SOFT} cx="52" cy="58" r="30" strokeDasharray="5 7" />
      <path {...STROKE} d="M84 40 a10 10 0 1 1 -20 0 c0 -7 10 -18 10 -18 s10 11 10 18 z" />
      <circle {...STROKE} cx="74" cy="40" r="3.5" />
    </svg>
  );
}

/** Nothing on the counter today — the shop has not declared stock yet. */
export function EmptyCounter({ className }: DecorProps) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden focusable="false">
      {/* An empty ice tray / counter, in section. */}
      <path {...STROKE} d="M22 74 h76 l-6 16 h-64 z" />
      <path {...STROKE_SOFT} d="M30 74 q10 -10 20 0 t20 0 t20 0" />
      <path {...STROKE_SOFT} d="M36 58 q10 -10 20 0 t20 0" opacity="0.22" />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * TEXTURE AND SHAPE
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⭐ THE SCALE PATTERN — the one texture in the system, and it exists for the
 * dark brand panels (the footer, the order-tracking status card) which are
 * otherwise large flat rectangles of near-black.
 *
 * ⚠ IT IS DELIBERATELY ALMOST INVISIBLE. At 0.05 opacity it is felt rather
 * than seen, which is the difference between a premium surface and a patterned
 * one. If you can identify the motif at arm's length it is too strong.
 *
 * Rendered as a tiling SVG `<pattern>` rather than a CSS gradient stack
 * because the motif has curves, and rather than a raster because it has to
 * work on a near-black ground in both schemes at any size.
 */
export function ScalePattern({ className }: DecorProps) {
  return (
    <svg
      className={className}
      aria-hidden
      focusable="false"
      preserveAspectRatio="none"
      width="100%"
      height="100%"
    >
      <defs>
        <pattern id="decor-scales" width="28" height="18" patternUnits="userSpaceOnUse">
          <path
            d="M0 18 q7 -14 14 0 q7 -14 14 0 M-14 9 q7 -14 14 0 M14 9 q7 -14 14 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#decor-scales)" opacity="0.05" />
    </svg>
  );
}

/**
 * The decorative disc the reference puts in the corner of a filled stat card.
 *
 * ⚠ IT CARRIES NO TEXT AND MUST NOT. It is drawn in white-alpha over whatever
 * fill the card has, which means its contrast against that fill is by design
 * far below anything readable — that is what makes it recede.
 */
export function StatDisc({ className }: DecorProps) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden focusable="false">
      <circle cx="92" cy="28" r="46" fill="currentColor" opacity="0.10" />
      <circle cx="92" cy="28" r="30" fill="currentColor" opacity="0.10" />
    </svg>
  );
}

/**
 * ⭐ THE SHEET GRAB HANDLE. Four lines of markup, and it is here rather than
 * copied into four sheets because it is the single clearest signal that a
 * panel is draggable-feeling and dismissible — and because four copies is four
 * chances for one of them to be 2px off.
 */
export function GrabHandle({ className }: DecorProps) {
  return (
    <div className={`flex justify-center pb-1 pt-2 ${className ?? ''}`} aria-hidden>
      <span className="h-1 w-10 rounded-full bg-line" />
    </div>
  );
}
