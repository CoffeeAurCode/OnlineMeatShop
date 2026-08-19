import Image from 'next/image';

import { t, type Locale } from '@/i18n';

/**
 * ⭐ THE LANDING BAND. The immersive coloured surface the storefront opens on.
 *
 * ── WHAT WAS TAKEN FROM THE REFERENCE, AND WHAT WAS REFUSED ───────────────
 *
 * The client supplied a food-delivery home screen (2026-08-19) and asked for
 * that feeling: a saturated colour field across the top third, search sitting
 * ON it rather than under it, and small illustrated things scattered through
 * the field so the screen feels inhabited rather than laid out.
 *
 * All three are here. What is NOT here is everything the reference puts in
 * that field: a "60% OFF up to ₹120" banner, an ORDER NOW badge, star ratings
 * on every card below. 🔴 §3 BANS INVENTING A NUMBER THE SHOP DOES NOT HAVE,
 * and a hero is the most believable place on the site to put a false one — a
 * customer who reads a discount here and does not get it at checkout has been
 * lied to by the first thing they saw. This shop has no promotions domain, no
 * reviews and no delivery estimate, so the band sells the one thing that IS
 * true and IS unusual: the fish is cut and weighed after you order it.
 *
 * ── WHY THERE IS NO SEARCH FIELD AND NO ADDRESS HERE ──────────────────────
 *
 * ⚠ BOTH ARE IN THE HEADER, AND THE HEADER IS THE SAME COLOUR FIELD AS THIS.
 * The band DID carry its own search box, and the reason was real at the time:
 * the header's was `hidden lg:block`, so below 1024px the home page had no
 * search field at all. Rebuilding the header as a band (2026-08-19) gave it a
 * full-width search row at every width, 60px above this one — so the band's
 * copy was deleted rather than left to be the second of two fields that must
 * agree, one of which scrolls away. The same argument always applied to the
 * address control, which is why that one was never drawn here.
 *
 * ⭐ WHAT THIS MEANS FOR THE SEAM. The header is `--hero-ground` with a glow
 * and this is `--hero-ground` with a texture, so the two meet as one field
 * with no rule between them. Nothing here may paint its own background colour
 * near the top edge, and the header's glow is anchored above its own top edge
 * for the same reason.
 *
 * ── THE SCATTERED ELEMENTS ────────────────────────────────────────────────
 *
 * Seven transparent gouache cut-outs. They are `aria-hidden` decoration: each
 * one is a thing this shop sells, but none of them is a product a customer can
 * act on here, and a screen reader announcing "lemon, oyster, dill" before the
 * heading would be describing wallpaper.
 *
 * ⚠ THEY ARE CUT-OUTS WITH REAL ALPHA, NOT SQUARES PAINTED ON THE BAND COLOUR.
 * The first attempt asked the model for a flat #0E7490 ground to match the
 * band exactly; it returned #006786, which is close enough to look deliberate
 * in a thumbnail and obvious as a rectangle at full size. The asset pipeline
 * now flood-fills the background to transparency from the borders inward, so
 * the exact colour the model chose stopped mattering — and the same cut-outs
 * would work on any ground.
 *
 * ⚠ COUNT IS RESPONSIVE ON PURPOSE. Three below `sm`, seven above. All seven
 * on a 375px band is not a mood, it is a collage, and the heading has to win.
 */

/**
 * One scattered element. `width`/`height` are the intrinsic size the asset
 * pipeline wrote, so the browser reserves the box and the band never shifts.
 *
 * ⚠ NO `sizes` AND NO `fill`. `images.unoptimized` is set, so `sizes` buys
 * nothing (see `src/ui/art.ts`); these are already small files and are drawn at
 * a fixed CSS size.
 */
const SPECKS = [
  // ── Always visible, including on a 375px phone. ──────────────────────────
  { src: 'hero-lemon', w: 394, h: 420, cls: 'right-[-1.5rem] top-4 w-24 sm:right-8 sm:top-8 sm:w-32 lg:w-40', drift: 'hero-drift' },
  { src: 'hero-fish', w: 420, h: 184, cls: 'bottom-6 right-6 w-28 sm:bottom-10 sm:right-40 sm:w-36 lg:w-44', drift: 'hero-drift-slow' },
  { src: 'hero-ice', w: 420, h: 346, cls: 'bottom-[-1rem] left-[-1.5rem] w-24 opacity-70 sm:bottom-4 sm:left-4 sm:w-28', drift: 'hero-drift-slow' },
  // ── `sm` and up, where there is room for them to read as separate objects. ─
  { src: 'hero-oyster', w: 420, h: 348, cls: 'hidden sm:block sm:right-[13rem] sm:top-6 sm:w-28 lg:right-[22rem] lg:w-36', drift: 'hero-drift' },
  { src: 'hero-dill', w: 306, h: 420, cls: 'hidden sm:block sm:bottom-[-2rem] sm:right-[6rem] sm:w-32 lg:w-40', drift: 'hero-drift-slow' },
  // ⚠ Kept clear of the band's top edge. At `top-[-1rem]` it was sliced by the
  // band's own `overflow: hidden` and read as a pale blob rather than a
  // scallop — a cut-out only survives cropping if the crop looks deliberate.
  { src: 'hero-scallop', w: 420, h: 415, cls: 'hidden lg:block lg:left-[30rem] lg:top-8 lg:w-20', drift: 'hero-drift' },
  { src: 'hero-prawn', w: 420, h: 290, cls: 'hidden lg:block lg:bottom-8 lg:right-[3rem] lg:w-32', drift: 'hero-drift-slow' },
] as const;

export function Hero({ locale }: { locale: Locale }) {
  return (
    <section className="hero-band">
      {SPECKS.map((s) => (
        <Image
          key={s.src}
          src={`/painted/${s.src}.webp`}
          alt=""
          aria-hidden
          width={s.w}
          height={s.h}
          priority={false}
          className={`hero-speck ${s.drift} ${s.cls}`}
        />
      ))}

      {/*
        ⚠ THE BOTTOM PADDING IS DOUBLE THE TOP, AND IT IS NOT A RHYTHM CHOICE.
        `page.tsx` pulls the counter tiles UP into this band by `-mt-8` so the
        two read as one surface. While the search field sat at the bottom of
        this column that 32px landed on empty padding; with the field moved to
        the header, THE LEAD PARAGRAPH IS THE LAST THING HERE and the card was
        arriving 8px under its descenders. The padding below has to cover the
        overlap plus a gap — change one of these two numbers and check the
        other.
      */}
      <div className="mx-auto max-w-[80rem] px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-14 lg:pb-28 lg:pt-20">
        {/*
          ⚠ THE COLUMN IS CAPPED WELL SHORT OF THE BAND. Everything to the
          right of it is where the elements live; letting the heading run the
          full 80rem would put "at your door" underneath a lemon.
        */}
        <div className="max-w-[34rem]">
          <h1 className="!text-display-xl !pb-0 text-balance">{t(locale, 'home.heroHeading')}</h1>

          {/*
            ⚠ `text-white/90`, NOT A MUTED TOKEN. `--ink-muted` is derived
            against the LIGHT ground and is 2.3:1 on teal. Every muted thing on
            this band is a white alpha, and the band's ground does not flip, so
            those ratios hold in both schemes.

            🔴 IT WAS `/85`, WHICH IS 4.34:1 AND FAILS AA. This is body copy at
            17px regular — not large text, so 3:1 does not apply to it. 0.90 is
            4.67:1 and is the first step on the ladder that passes. The ladder
            is asserted in `tests/domain/palette-contrast.test.ts` now, which
            is what found this.
          */}
          <p className="mt-4 max-w-[46ch] text-lead text-white/90">
            {t(locale, 'home.heroBody')}
          </p>
        </div>
      </div>
    </section>
  );
}
