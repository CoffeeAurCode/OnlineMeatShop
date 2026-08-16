/**
 * Google Maps links. Pure string construction — no I/O, no browser, no clock.
 *
 * ══ WHY THESE ARE IN `domain/` AND NOT IN `ui/` ═══════════════════════════
 *
 * They were in `src/ui/maps.ts`, which was already the SECOND home they had
 * (see that file's header for the 500 that moved them out of `ui/location.ts`).
 * They move once more because `src/domain/dispatch.ts` needs the route link,
 * and `src/domain/**` may not import `@/ui/**` — the ESLint allowlist refuses
 * it, correctly.
 *
 * The alternative was to build the URL a second time inside `dispatch.ts`, and
 * `07-PLAN` §4.2 names that specific outcome as the thing to avoid: the
 * customer's "view on the map" link and the partner's route link must not
 * drift apart, because the day they do, one of them is pointing at the wrong
 * building and nobody finds out from a test.
 *
 * `src/ui/maps.ts` now re-exports these, so every existing import still works
 * and there is still exactly one construction of each URL.
 */

/**
 * Drop a pin on the destination. What the CUSTOMER gets: "is this actually my
 * building?", answered without handing anyone their position.
 */
export function mapsPinUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * Route to the destination. What the DELIVERY PARTNER's message carries.
 *
 * ⭐ NO `origin` PARAMETER, DELIBERATELY. Omitting it makes Maps route from
 * wherever the device actually is when the link is opened, which is strictly
 * better than a stored origin: a partner halfway across town when they read
 * the message gets the route from where they are, not from the shop.
 */
export function mapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

/**
 * Route to a typed address, for an order placed by someone who declined the
 * location permission.
 *
 * ⚠ STRICTLY WORSE THAN THE COORDINATE and only ever the fallback. Maps
 * geocodes the string, and a geocoder that cannot find "Apt 3, 4200 Sample
 * Street" silently routes to the middle of the street — which looks like a
 * working link right up until the driver is standing outside the wrong door.
 */
export function mapsDirectionsUrlForAddress(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}
