/**
 * Google Maps links, built from a coordinate. Pure string construction, no I/O,
 * no browser.
 *
 * ⚠ THIS FILE EXISTS BECAUSE THESE TWO FUNCTIONS CANNOT LIVE IN
 * `src/ui/location.ts`, AND THE REASON IS NOT TIDINESS.
 *
 * `location.ts` is `'use client'`. Every export of a `'use client'` module —
 * including a plain function that touches nothing — becomes a CLIENT REFERENCE
 * when a server component imports it. Rendering it is fine; CALLING it is not:
 *
 *     Error: Attempted to call mapsPinUrl() from the server but mapsPinUrl is
 *     on the client.
 *
 * That is a RUNTIME error on the rendered page. `next build`, `tsc` and the
 * linter all pass, so the first thing that notices is a customer opening the
 * tracking page for their own order. It is exactly what happened on
 * 2026-08-16: every order placed with a GPS coordinate — which is now the
 * normal path — rendered a 500, because the map link is the one thing on that
 * page gated on `lat !== null`.
 *
 * So: anything a SERVER component calls has to live outside a `'use client'`
 * module. Putting a helper next to the state it relates to is the instinct that
 * caused this; resist it here.
 *
 * ⚠ THE MAP IS ALWAYS A LINK, NEVER AN EMBED. See the tracking page for why —
 * an embed puts a third-party script and a tile request on a page showing a
 * customer's home address.
 */

/**
 * Drop a pin on the destination. What the CUSTOMER gets: "is this actually my
 * building?", answered without handing anyone their position.
 */
export function mapsPinUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * Route to the destination. What the DELIVERY PARTNER's message will carry.
 * `dir` with no origin lets Maps use the viewer's own position, which is right
 * for a driver and harmless for a customer checking their own pin.
 *
 * Kept beside `mapsPinUrl` so the two constructions cannot drift apart.
 */
export function mapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}
