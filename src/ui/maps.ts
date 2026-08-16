/**
 * Google Maps links — re-exported from the domain, which is where they live.
 *
 * ⚠ THIS FILE IS A RE-EXPORT AND THAT IS THE WHOLE POINT. Do not paste an
 * implementation back in here.
 *
 * These functions have had three homes and the history is the documentation:
 *
 *   1. `src/ui/location.ts` — which is `'use client'`. Every export of a
 *      `'use client'` module becomes a CLIENT REFERENCE when a server module
 *      imports it, including a plain function that touches nothing. Rendering
 *      one is fine; CALLING one throws:
 *
 *          Error: Attempted to call mapsPinUrl() from the server but
 *          mapsPinUrl is on the client.
 *
 *      A RUNTIME error on the rendered page. `next build`, `tsc` and the
 *      linter all passed, so the first thing that noticed was a customer
 *      opening the tracking page for their own order — every GPS order 500'd
 *      (2026-08-16).
 *
 *   2. `src/ui/maps.ts` — outside any client module, which fixed that.
 *
 *   3. `src/domain/maps.ts` — because `src/domain/dispatch.ts` builds the
 *      delivery partner's route link, and the domain may not import `@/ui/**`.
 *      Duplicating the URL there would let the customer's pin and the
 *      partner's route drift apart (`07-PLAN` §4.2).
 *
 * The rule that survives all three: anything a SERVER component calls must not
 * live in a `'use client'` module. Putting a helper next to the state it
 * relates to is the instinct that caused the 500; resist it here.
 *
 * ⚠ THE MAP IS ALWAYS A LINK, NEVER AN EMBED. An embed puts a third-party
 * script and a tile request on a page showing a customer's home address.
 */

export { mapsPinUrl, mapsDirectionsUrl, mapsDirectionsUrlForAddress } from '@/domain/maps';
