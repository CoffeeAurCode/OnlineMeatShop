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
 */
/*
 * ⚠ THE `hero` VARIANT IS GONE, with the hero that was its only caller.
 * It was a large white-on-brand form for the home page's brand panel; Phase 2
 * of the Figma parity plan deleted that panel, and the header pill — which was
 * always visible on the same screen — is the one that survived. One control,
 * one appearance.
 */
export function AddressPill({
  locale,
  full = false,
}: {
  locale: Locale;
  /** Fills its container instead of capping. The phone row uses this. */
  full?: boolean;
}) {
  const { location, ready } = useDeliveryLocation();
  const label = ready ? locationLabel(location) : null;

  return (
    <button
      type="button"
      onClick={openLocationSheet}
      className={`
        flex h-10 min-w-0 items-center gap-1.5 rounded-full border border-line bg-raised px-3
        text-meta transition-colors duration-(--duration-fast) hover:border-accent
        ${full ? 'w-full' : 'max-w-[13rem] sm:max-w-[18rem]'}
      `}
      // The visible label is the street; the accessible name says what the
      // control does with it, because "12 Rue Sample" alone is not a verb.
      aria-label={
        label === null
          ? t(locale, 'location.setAddress')
          : t(locale, 'location.changeFrom', { address: label })
      }
    >
      <MapPinIcon size={15} weight="fill" aria-hidden className="shrink-0 text-accent" />
      <span className="truncate font-semibold">{label ?? t(locale, 'location.setAddress')}</span>
      <CaretDownIcon size={12} weight="bold" aria-hidden className="shrink-0 text-muted" />
    </button>
  );
}
