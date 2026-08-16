'use client';

import { useSyncExternalStore } from 'react';

/**
 * ⭐ WHERE THE CUSTOMER IS. The storefront is organised around this the way a
 * delivery app is, rather than around a postal-code box at the end of
 * checkout.
 *
 * That inversion is the point of the redesign. A delivery-only shop's first
 * question is "do you come to me", and asking it in the header moves an
 * `outsideDeliveryArea` refusal from after a filled-in form to before a
 * basket. It is also what makes the delivery fee, the free-delivery progress
 * and the slot list truthful while somebody is still browsing.
 *
 * ── WHY A COORDINATE AND NOT A POSTAL CODE ────────────────────────────────
 *
 * A postal code is a string somebody typed, and one wrong character is
 * indistinguishable from living somewhere else. A coordinate is where the
 * device says they are standing. The parcel goes to the second one, so the
 * second one decides serviceability and the fee. See
 * `resolveDestinationZone`.
 *
 * ⚠ THE COORDINATE DOES NOT REPLACE THE ADDRESS LINES. It locates the
 * BUILDING; the lines say which door, which buzzer, which floor. GPS on a
 * phone in a stairwell is routinely 30 m out, which is the difference between
 * two addresses on a terrace. Both are captured and both are stored.
 *
 * ── WHY THIS IS AN EXTERNAL STORE ─────────────────────────────────────────
 *
 * Same reason as `src/ui/cart.tsx`: a value that lives in `localStorage`, is
 * unavailable during the server render, and must not differ between the
 * server's HTML and the client's first render. `getServerSnapshot` returns the
 * empty location, so hydration agrees and the real value arrives in the commit
 * that follows.
 */

/**
 * How the parcel should be handed over. Uber's three, minus the ones that make
 * no sense for a fishmonger: raw fish left on a doorstep in July is a
 * food-safety problem, so `LEAVE_AT_DOOR` carries a warning at the point of
 * choosing rather than being quietly offered as an equal option.
 */
export type DropOff = 'HAND_TO_ME' | 'LEAVE_AT_DOOR' | 'MEET_OUTSIDE';

export interface DeliveryLocation {
  /** Null until the device shares one, or the customer pins it by hand. */
  readonly lat: number | null;
  readonly lng: number | null;
  /** Metres, as reported by the browser. Null when hand-entered. */
  readonly accuracyM: number | null;
  /** How the coordinate was obtained. Shown, because it changes how much to trust it. */
  readonly source: 'device' | 'manual' | null;

  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  /** Province, state, or whatever it is called there. Free text. */
  readonly region: string;
  /** Optional now. Kept because a desktop visitor may have nothing else. */
  readonly postalCode: string;

  readonly notes: string;
  readonly dropOff: DropOff;
}

export interface LocationSnapshot {
  readonly location: DeliveryLocation;
  /** False until storage has been read. "Empty" and "unknown" read differently. */
  readonly ready: boolean;
}

const STORAGE_KEY = 'delivery.v1';

const BLANK: DeliveryLocation = {
  lat: null,
  lng: null,
  accuracyM: null,
  source: null,
  line1: '',
  line2: '',
  city: '',
  region: '',
  postalCode: '',
  notes: '',
  dropOff: 'HAND_TO_ME',
};

// Stable reference, or `useSyncExternalStore` loops.
const EMPTY: LocationSnapshot = { location: BLANK, ready: false };

let snapshot: LocationSnapshot = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;

  let location = BLANK;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== null) location = parse(raw);
  } catch {
    // Private browsing, or a corrupt value. A blank location is recoverable by
    // the customer; a throw here takes the whole header down with it.
  }
  snapshot = { location, ready: true };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  hydrate();
  return () => {
    listeners.delete(listener);
  };
}

export function useDeliveryLocation(): LocationSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
}

export function setDeliveryLocation(next: Partial<DeliveryLocation>): void {
  const location = { ...snapshot.location, ...next };
  snapshot = { location, ready: true };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
  } catch {
    // Quota or blocked. It still works for this page view.
  }
  emit();
}

export function clearDeliveryLocation(): void {
  setDeliveryLocation(BLANK);
}

/** True once there is something the server can resolve to a zone. */
export function hasDestination(l: DeliveryLocation): boolean {
  return (l.lat !== null && l.lng !== null) || l.postalCode.trim() !== '';
}

/** True once there is enough to actually deliver to. */
export function isDeliverable(l: DeliveryLocation): boolean {
  return hasDestination(l) && l.line1.trim() !== '' && l.city.trim() !== '';
}

/**
 * What the header pill says.
 *
 * The street line if there is one, because that is what a person recognises.
 * Falling back to the postal code, then to the coordinate, then to an
 * invitation. Never "Unknown" or a blank pill: an empty control with no label
 * is the one that never gets tapped.
 */
export function locationLabel(l: DeliveryLocation): string | null {
  if (l.line1.trim() !== '') return l.line1.trim();
  if (l.postalCode.trim() !== '') return l.postalCode.trim().toUpperCase();
  if (l.lat !== null && l.lng !== null) return `${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}`;
  return null;
}

/**
 * Ask the browser where we are.
 *
 * ⚠ EVERY FAILURE IS DISTINGUISHED, because they need different sentences. A
 * customer who DENIED the permission needs to be told how to change it; one
 * whose device could not get a fix needs to be told to try again or type it;
 * and a page served over plain HTTP gets no geolocation at all, which is a
 * developer's problem and not the customer's.
 *
 * ⭐ TWO ATTEMPTS, AND THE SECOND ONE IS A WATCH. High accuracy first, because
 * this is a street address and a network fix can be a kilometre out in a city,
 * which is several delivery zones wide. On a phone that first attempt succeeds
 * and nothing else runs.
 *
 * A desktop has no GPS radio, and there Chrome fails the precise request with
 * POSITION_UNAVAILABLE instead of falling back to the network provider on its
 * own. The retry is therefore coarse — but it is also a `watchPosition`, not a
 * second `getCurrentPosition`, and that difference is the whole fix. Observed
 * on the deployed site: repeated `getCurrentPosition` calls failed while
 * browserleaks.com obtained a 97 m fix in the same browser in the same minute
 * through a watch. `getCurrentPosition` gives up on the provider's first miss;
 * a watch stays subscribed and takes the fix when it lands a moment later.
 * The watch is cleared the instant it yields anything, so it costs one reading,
 * not a running subscription.
 *
 * A REFUSAL IS NEVER RETRIED. Asking twice cannot change the answer, and on a
 * browser that prompts per call it asks the customer twice.
 *
 * The 15 second precise timeout is generous because a cold GPS fix indoors
 * genuinely takes that long. The watch gets 10, which is long enough for a
 * network lookup that is going to answer at all.
 */
export type LocationError = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export type LocationFix = { ok: true; lat: number; lng: number; accuracyM: number };
export type LocationFailure = { ok: false; error: LocationError };

function toFix(pos: GeolocationPosition): LocationFix {
  return {
    ok: true,
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracyM: Math.round(pos.coords.accuracy),
  };
}

function toFailure(err: GeolocationPositionError): LocationFailure {
  return {
    ok: false,
    error:
      err.code === err.PERMISSION_DENIED
        ? 'denied'
        : err.code === err.TIMEOUT
          ? 'timeout'
          : 'unavailable',
  };
}

function getPosition(options: PositionOptions): Promise<LocationFix | LocationFailure> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(toFix(pos)),
      (err) => resolve(toFailure(err)),
      options,
    );
  });
}

/**
 * One reading via `watchPosition`. Resolves on the first position or the first
 * error and unsubscribes either way, so a caller cannot leak a live watch.
 * `settled` guards against a provider that reports an error and then delivers
 * a fix anyway, which would otherwise resolve the promise twice and clear a
 * watch id that no longer exists.
 */
function watchOnce(options: PositionOptions): Promise<LocationFix | LocationFailure> {
  return new Promise((resolve) => {
    let settled = false;
    const stop = (result: LocationFix | LocationFailure) => {
      if (settled) return;
      settled = true;
      navigator.geolocation.clearWatch(id);
      resolve(result);
    };
    const id = navigator.geolocation.watchPosition(
      (pos) => stop(toFix(pos)),
      (err) => stop(toFailure(err)),
      options,
    );
  });
}

export async function requestDeviceLocation(): Promise<LocationFix | LocationFailure> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return { ok: false, error: 'unsupported' };
  }

  const precise = await getPosition({
    enableHighAccuracy: true,
    timeout: 15_000,
    maximumAge: 60_000,
  });
  if (precise.ok || precise.error === 'denied') return precise;

  const watched = await watchOnce({
    enableHighAccuracy: false,
    timeout: 10_000,
    maximumAge: 60_000,
  });
  // The precise attempt's error is the more informative of the two when both
  // fail — a GPS timeout followed by a network timeout is still a timeout, but
  // a genuine "no provider at all" should not be reported as one.
  return watched.ok ? watched : precise;
}

/*
 * ⚠ THE MAPS LINK BUILDERS USED TO LIVE HERE, AND MOVED TO `src/ui/maps.ts`.
 * They are pure functions, but this module is `'use client'`, so a server
 * component that imported them got a client reference and threw the moment it
 * CALLED one. Do not move them back. `maps.ts` explains the failure in full.
 */

/**
 * Parse stored JSON defensively. The value came from a previous version of
 * this application in a browser that may not have reloaded for weeks, so
 * anything unrecognised falls back to blank rather than being trusted.
 */
function parse(raw: string): DeliveryLocation {
  const data: unknown = JSON.parse(raw);
  if (typeof data !== 'object' || data === null) return BLANK;
  const e = data as Record<string, unknown>;

  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');

  const lat = num(e.lat);
  const lng = num(e.lng);
  // Half a coordinate is not a coordinate. Keeping one of the pair would send
  // `lat` with a null `lng` to the server, which refuses it anyway, but does so
  // as a validation error rather than as "no location given".
  const paired = lat !== null && lng !== null;

  return {
    lat: paired ? lat : null,
    lng: paired ? lng : null,
    accuracyM: paired ? num(e.accuracyM) : null,
    source: e.source === 'device' || e.source === 'manual' ? e.source : paired ? 'manual' : null,
    line1: str(e.line1),
    line2: str(e.line2),
    city: str(e.city),
    region: str(e.region),
    postalCode: str(e.postalCode),
    notes: str(e.notes),
    dropOff:
      e.dropOff === 'LEAVE_AT_DOOR' || e.dropOff === 'MEET_OUTSIDE' ? e.dropOff : 'HAND_TO_ME',
  };
}
