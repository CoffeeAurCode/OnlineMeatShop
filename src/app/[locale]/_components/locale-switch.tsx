'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { LOCALES, pathForLocale, t, type Locale } from '@/i18n';

/**
 * The language toggle.
 *
 * ⚠ IT IS A LINK, NOT A BUTTON, and that is not a detail. `/fr/shop` and
 * `/en/shop` are two real URLs; a button that swapped strings in place would
 * leave the address bar lying, break the back button, make the page
 * unshareable in the language it is being read in, and hide half the site from
 * a crawler. Bill 96 asks for French to be available and at least as prominent
 * as English, and "available" means at an address.
 *
 * Both locales are always rendered rather than showing only the other one. Two
 * items with the current one marked is how someone confirms which language
 * they are already in, which matters most to the person who landed in the
 * wrong one.
 *
 * `prefetch={false}`: prefetching the whole other-language page for a control
 * that most visitors never touch is a lot of bytes on a phone for nothing.
 *
 * ── ON THE BAND ───────────────────────────────────────────────────────────
 *
 * ⭐ IT KEEPS THE TRAILING SLOT OF THE SEARCH ROW, which is where the
 * reference top bar puts its one two-state toggle. That is a better home than
 * the crowded right-hand cluster it came from: this control already IS a
 * segmented toggle, so it is in the position its own shape describes, and Bill
 * 96's "at least as prominent" is easier to argue for a control sitting beside
 * the search field than for the smallest thing in a row of five.
 *
 * ⚠ THE TRACK IS A RING, NOT A FILL, AND THAT IS A CONTRAST DECISION. White
 * composited at 0.14 over the band is a surface on which white TEXT measures
 * 4.12:1 — fine for a glyph, under AA for words. Leaving the track transparent
 * puts `EN` and `FR` on the band itself at 5.36:1. Filled chips on this bar
 * are icon-only for the same reason; see `.band-chip` in `globals.css`.
 */
export function LocaleSwitch({ current }: { current: Locale }) {
  const pathname = usePathname();

  return (
    <div
      /*
        44px tall: 40px items plus the 2px track on each side. That is this
        project's touch-target floor, and it matches the search field's row
        exactly so the two read as one control strip rather than as a field
        with something parked next to it.
      */
      className="band-outline inline-flex shrink-0 items-center gap-0.5 rounded-full p-0.5"
      role="group"
      aria-label={t(current, 'meta.switchTo')}
    >
      {LOCALES.map((locale) => {
        const active = locale === current;
        return (
          <Link
            key={locale}
            href={pathForLocale(pathname, locale)}
            prefetch={false}
            hrefLang={locale}
            aria-current={active ? 'true' : undefined}
            /*
              ⚠ THE ACTIVE STATE IS WHITE-ON-TEAL, NOT `bg-accent`. In light
              mode `--accent` and `--hero-ground` are the same colour, so an
              accent-filled segment on this band marks the current language
              with nothing at all.
            */
            className={`grid min-h-10 min-w-10 place-items-center rounded-full px-2 text-[0.6875rem] font-bold uppercase tracking-[0.06em] transition-colors duration-(--duration-fast) ${
              active ? 'bg-white text-hero-ground' : 'text-white hover:bg-white/15'
            }`}
          >
            {locale}
            <span className="sr-only">{t(locale, 'meta.localeName')}</span>
          </Link>
        );
      })}
    </div>
  );
}
