import Link from 'next/link';
import { HouseIcon, UserCircleIcon } from '@phosphor-icons/react/dist/ssr';

import { t, type Locale } from '@/i18n';

import { AddressPill } from './address-pill';
import { BasketButton } from './basket-button';
import { LocaleSwitch } from './locale-switch';
import { VoiceSearch } from './voice-search';

/**
 * The storefront's shared furniture.
 *
 * ⭐ REBUILT AROUND THE ADDRESS. The header used to be a wordmark and four nav
 * links; it is now a delivery toolbar, in the order a delivery app puts one:
 * where the order is going, what is in the basket, and what you are looking
 * for.
 *
 * ⚠ THE ORDER IS THE ARGUMENT, and the address is FIRST. This shop cannot sell
 * anything to somebody outside its radius, so the address is not a checkout
 * field that happens to appear early: it is the qualifier for everything below
 * it. Every fee, every free-delivery nudge and every slot on the site is
 * either honest or hypothetical depending on whether that control is filled
 * in.
 *
 * ── THE BAND (2026-08-19) ─────────────────────────────────────────────────
 *
 * ⭐ THE BAR IS AN IMMERSIVE COLOUR FIELD NOW, not a white strip. The client
 * supplied a delivery-app top bar and asked for that layout: a saturated
 * ground with the location set large in the top-left, a cluster of round
 * controls in the top-right, and a full-width search pill on its own row
 * underneath. All three are here, in `--hero-ground` — the same pinned teal
 * the landing band uses, so on the home page the header and the band read as
 * ONE field rather than as two stacked panels.
 *
 * ⚠ WHAT WAS MAPPED ONTO THE REFERENCE'S SLOTS, AND WHAT WAS REFUSED. The
 * reference fills its cluster with a partner-brand pill, a wallet and an
 * avatar, and its search row with a voice-search mic and a dietary toggle.
 * This shop has no partners, no stored balance and no customer avatar. Voice
 * search now occupies the reference's microphone slot with a real cart flow.
 * So each slot took a control this app actually has and that a customer
 * actually needs:
 *
 *   reference          here                     why
 *   ─────────────────  ───────────────────────  ─────────────────────────────
 *   brand pill         (dropped)                nothing true to put in it
 *   wallet circle      order history            the same "what I have already
 *                                               done here" slot
 *   avatar circle      basket, filled white     the end of every path, and the
 *                                               cluster's one focal control
 *   search pill        search pill              unchanged, and now at every
 *                                               width — see below
 *   mic circle         voice order              searches the live catalog and
 *                                               adds one legal basket line
 *   VEG toggle         EN/FR                    a two-state toggle in a
 *                                               two-state toggle's position
 *
 * ⭐ THE SEARCH FIELD IS NOW REAL AT EVERY WIDTH, and that closes a gap rather
 * than adding a row. It used to be `hidden lg:block`, so below 1024px — which
 * is where this shop is actually used — the header offered an icon that
 * navigated to a page with the same input on it. The landing band grew its own
 * search field to cover that, and the two would now be 60px apart on the home
 * page, so THE BAND'S COPY HAS BEEN REMOVED and this one is the only search
 * field on the screen. One control, one place, every page.
 *
 * ⚠ THE WORDMARK IS GONE. The reference top bar has no logotype; a customer
 * who has already landed does not need to be told whose site it is on every
 * scroll, and the ~90px it cost is most of the room the address line now has.
 * The name still opens every page's `<title>`, the `Store` node in the layout
 * and the footer.
 *
 * ── THE HEIGHT IS A CONTRACT ──────────────────────────────────────────────
 *
 * ⚠ 116px, AT EVERY BREAKPOINT: a 56px control row, a 48px search field, and
 * 12px under it. `shop/page.tsx` and `shop/[category]/page.tsx` hard-code the
 * sum as `top-[7.25rem]` for their sticky filter strips, WITH NO `sm:`
 * VARIANT, because this bar no longer changes height at one — only its type
 * sizes and its search cap do. That is deliberate: the old bar was 108px on a
 * phone and 72px above `sm`, which was two numbers three files had to agree
 * on, and they did not always. Change the rows here and change that one
 * number there.
 */

export function ShopHeader({ locale }: { locale: Locale }) {
  const home = `/${locale}`;

  return (
    <header className="storefront-header sticky top-0 z-40">
      <div className="mx-auto max-w-[80rem] px-4 sm:px-6">
        {/* ── Row one: where it goes, and what you have here. 56px. ───────── */}
        <div className="flex h-14 items-center gap-3">
          <AddressPill locale={locale} />

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={home}
              className="band-outline hidden h-11 items-center gap-1.5 rounded-full px-4 text-meta font-semibold text-white lg:inline-flex"
            >
              <HouseIcon size={18} aria-hidden />
              {t(locale, 'nav.home')}
            </Link>
            {/*
              Desktop needs a visible route back to both the landing page and
              catalog because the mobile tab bar disappears at `lg`.
            */}
            <Link
              href={`${home}/shop`}
              className="band-outline hidden h-11 items-center rounded-full px-4 text-meta font-semibold text-white lg:inline-flex"
            >
              {t(locale, 'nav.shop')}
            </Link>

            {/*
              ⚠ FILLED CHIP, GLYPH ONLY. White composited at 0.14 over the band
              is a surface white text measures 4.12:1 on — over the 3:1 a glyph
              needs and under the 4.5:1 a word needs. Anything on this bar
              carrying words gets `.band-outline` instead. See `globals.css`.
            */}
            <Link
              href={`${home}/account`}
              aria-label={t(locale, 'nav.account')}
              className="band-chip press grid size-11 shrink-0 place-items-center rounded-full text-white"
            >
              <UserCircleIcon size={21} aria-hidden />
            </Link>

            <BasketButton locale={locale} />
          </div>
        </div>

        {/* ── Row two: the search field, and the language toggle. 48+12px. ── */}
        <div className="flex items-center gap-2 pb-3">
          <VoiceSearch locale={locale} />

          <LocaleSwitch current={locale} />
        </div>
      </div>
    </header>
  );
}
