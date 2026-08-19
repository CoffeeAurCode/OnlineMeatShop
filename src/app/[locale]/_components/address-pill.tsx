'use client';

import { CaretDownIcon, MapPinIcon } from '@phosphor-icons/react/dist/ssr';

import { t, type Locale } from '@/i18n';
import { locationLabel, useDeliveryLocation } from '@/ui/location';

import { openLocationSheet } from './drawer-state';

/**
 * ⭐ THE ADDRESS CONTROL IN THE HEADER, and the single most consequential
 * element of this redesign.
 *
 * A delivery-only shop's first question is "do you come to me". Putting the
 * answer in the header rather than at the bottom of checkout means a customer
 * outside the radius finds out before they build a basket, and a customer
 * inside it sees a real delivery fee and a real free-delivery threshold on
 * every screen instead of a promise to be resolved later.
 *
 * ⚠ IT NEVER RENDERS EMPTY. Before an address is set it is an invitation with
 * a verb in it; after, it is the street line. A control that says nothing is a
 * control nobody taps, and this one has to be tapped for the rest of the shop
 * to be honest.
 *
 * ⚠ IT ALSO NEVER RENDERS DIFFERENTLY ON THE SERVER. `ready` is false until
 * `localStorage` has been read, and the prompt is what both the server HTML
 * and the first client render show. Skipping that would flash "Set your
 * address" over a saved one on every page load.
 *
 * ── TWO LINES NOW, NOT A PILL ─────────────────────────────────────────────
 *
 * ⭐ REBUILT 2026-08-19 AGAINST THE DELIVERY-APP TOP BAR. It was a bordered
 * pill sharing a 56px row with a wordmark; it is now the largest text on the
 * screen, sitting directly on the header's colour field with no chrome around
 * it at all. Removing the border is what makes it read as a HEADING that
 * happens to be tappable rather than as one control among five — which is what
 * it actually is, since every price below it is conditional on this value.
 *
 * ⚠ THE SECOND LINE IS NOT DECORATION. A street number alone ("12") is
 * ambiguous across a city; the reference puts the recognisable short name on
 * top and the disambiguating detail underneath, and that is exactly the split
 * this control needs. It also gives the unset state somewhere to say what the
 * shop does, instead of an invitation with no context.
 *
 * ⚠ NO `truncate` WITHOUT `min-w-0` ON EVERY ANCESTOR. This block is the
 * flexible half of a row whose right-hand cluster is `shrink-0`; without the
 * min-width overrides a long street name pushes the basket off the screen
 * rather than ellipsing, which is the overflow this header has had before.
 *
 * ⚠ THE WORDMARK THAT USED TO BE HERE IS GONE. The reference's top bar has no
 * logotype and neither does this one: a customer who has already landed on the
 * site does not need to be told whose site it is on every scroll, and the 90px
 * it cost is most of the room the address line now has. The name still opens
 * every page's `<title>`, the `Store` node and the footer.
 */
export function AddressPill({ locale }: { locale: Locale }) {
  const { location, ready } = useDeliveryLocation();
  const label = ready ? locationLabel(location) : null;

  /*
   * The disambiguating half. `label` is already whichever of these is the most
   * recognisable, so it is filtered back out rather than printed twice — a
   * customer with only a postal code would otherwise see it on both lines.
   */
  const detail = ready
    ? [location.line2, location.city, location.postalCode.toUpperCase()]
        .map((part) => part.trim())
        .filter((part) => part !== '' && part !== label)
        .join(' · ')
    : '';

  const second =
    label === null
      ? t(locale, 'location.headerPrompt')
      : detail === ''
        ? t(locale, 'location.change')
        : detail;

  return (
    <button
      type="button"
      /*
        ⚠ `data-parity` IS A HANDLE FOR `scripts/check-parity.mjs`, and there
        are seven of them in the storefront. The gate presses each control at
        its own centre to prove nothing is painted over it, and it has to find
        the control first: every text-based selector for this one changes with
        the locale, and every structural one changes with the layout. Read the
        script's header before removing one.
      */
      data-parity="address-pill"
      onClick={openLocationSheet}
      /*
        ⚠ `min-h-11`, NOT `h-11`, AND THE HEADER'S HEIGHT BUDGET DEPENDS ON THE
        ROW RATHER THAN ON THIS. 44px is this project's touch-target floor —
        found by `scripts/check-parity.mjs`, which measures every control it
        presses. Two lines at their largest come to about 43px, so the floor is
        what sets the height here and the 56px row absorbs it either way.
      */
      className="group flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-1 text-left"
      // The visible label is the street; the accessible name says what the
      // control does with it, because "12 Rue Sample" alone is not a verb.
      aria-label={
        label === null
          ? t(locale, 'location.setAddress')
          : t(locale, 'location.changeFrom', { address: label })
      }
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <MapPinIcon size={18} weight="fill" aria-hidden className="shrink-0" />
        {/*
          ⚠ PURE WHITE, NOT A MUTED TOKEN, AND THAT IS THE RULE FOR THIS WHOLE
          BAR. `--ink` and `--ink-muted` are derived against the LIGHT ground
          and land near 2:1 on teal. White is 5.36:1 here in both schemes,
          because `--hero-ground` does not flip.
        */}
        <span className="truncate text-lead font-extrabold leading-tight sm:text-display">
          {label ?? t(locale, 'location.setAddress')}
        </span>
        <CaretDownIcon size={14} weight="bold" aria-hidden className="shrink-0 opacity-80" />
      </span>

      {/*
        ⚠ `/90`, AND THE ALPHA IS MEASURED RATHER THAN CHOSEN. White at 0.85 on
        this ground is 4.34:1 and fails AA for body text; 0.90 is 4.67:1 and
        passes. The band's ground does not flip, so that holds in both schemes.
        `tests/domain/palette-contrast.test.ts` asserts the ladder.

        `aria-hidden`: the button's `aria-label` already names the address and
        says what pressing it does, so announcing this line again would read
        the street twice.
      */}
      <span aria-hidden className="truncate text-meta leading-tight text-white/90">{second}</span>
    </button>
  );
}
