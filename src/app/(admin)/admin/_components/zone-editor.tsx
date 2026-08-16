'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ZoneRow } from '@/db/repositories/admin';
import { ADMIN_LOCALE, money } from '@/ui/format';

import { PrimaryBar, PrimaryButton, SecondaryButton } from './shell';

/**
 * The delivery area: how far, how much, and free above what.
 *
 * ══ THE TRAP THIS SCREEN IS BUILT AROUND ══════════════════════════════════
 *
 * ⚠ THERE ARE TWO SERVICEABILITY MECHANISMS AND NARROWING ONE DOES NOT NARROW
 * THE OTHER.
 *
 *   1. The CIRCLE, which a customer's GPS coordinate is tested against.
 *   2. The POSTAL CODE table, which currently holds every FSA in Canada.
 *
 * Set a fifteen-kilometre radius here and a customer who declines the location
 * permission is still served in Vancouver, through the second path. The shop
 * finds out when the van is asked to drive to another province.
 *
 * ⭐ SO THE SCREEN REFUSES TO LET THE OWNER DO HALF OF IT QUIETLY. The postal
 * count is shown next to the radius, and while both are open the warning is
 * red and says exactly what will happen. The checkbox that clears the postal
 * codes is separate and explicit, because it destroys 4680 rows and a
 * destructive step that happens as a side effect of a different one is how
 * somebody loses data they did not know they had.
 *
 * ⚠ THE CURRENT RADIUS IS 20 038 km — half the Earth's circumference, which
 * contains every point on the planet. That is a TESTING setting, put there so
 * an order could be placed from India, and it must be narrowed before the shop
 * trades. The banner says so in those words.
 */

const PLANETARY_M = 20_000_000;

export function ZoneEditor({ zones }: { zones: readonly ZoneRow[] }) {
  const router = useRouter();
  const first = zones[0];
  const [zoneId] = useState(first?.id ?? '');
  const [fee, setFee] = useState(String(first?.feeCents ?? 0));
  const [freeAbove, setFreeAbove] = useState(
    first?.freeAboveCents == null ? '' : String(first.freeAboveCents),
  );
  const [lat, setLat] = useState(first?.centreLat == null ? '' : String(first.centreLat));
  const [lng, setLng] = useState(first?.centreLng == null ? '' : String(first.centreLng));
  const [radiusKm, setRadiusKm] = useState(
    first?.radiusM == null ? '' : String(Math.round(first.radiusM / 100) / 10),
  );
  const [clearPostal, setClearPostal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (first === undefined) {
    return (
      <p className="mt-6 rounded-md border border-line bg-raised px-4 py-6 text-body text-muted">
        No delivery zone exists, so the shop cannot quote a fee and cannot take an order. One has to
        be created before anything else on this screen means anything.
      </p>
    );
  }

  const planetary = first.radiusM !== null && first.radiusM >= PLANETARY_M;
  const bothOpen = planetary && first.fsaCount > 0;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);

    const radius = radiusKm.trim() === '' ? null : Math.round(Number(radiusKm) * 1000);
    const circle =
      lat.trim() === '' || lng.trim() === '' || radius === null
        ? null
        : { lat: Number(lat), lng: Number(lng), radiusM: radius };

    try {
      const res = await fetch('/api/admin/delivery-area', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          zoneId,
          feeCents: Number(fee.replace(/\D/g, '')),
          freeAboveCents: freeAbove.trim() === '' ? null : Number(freeAbove.replace(/\D/g, '')),
          circle,
          clearPostalCodes: clearPostal,
        }),
      });
      if (!res.ok) {
        setError('That did not save. Nothing has changed.');
        setBusy(false);
        return;
      }
      setSaved(true);
      setClearPostal(false);
      router.refresh();
      setBusy(false);
    } catch {
      setError('That did not save. Check the connection and try again.');
      setBusy(false);
    }
  }

  return (
    <>
      {planetary && (
        <p className="mt-4 rounded-sm bg-danger-wash px-3 py-2 text-body font-semibold text-danger">
          The delivery radius is currently {Math.round((first.radiusM ?? 0) / 1000).toLocaleString()}{' '}
          km — every coordinate on Earth. This is a testing setting and must be narrowed before the
          shop trades.
        </p>
      )}
      {bothOpen && (
        <p className="mt-2 rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
          {first.fsaCount.toLocaleString()} postal-code prefixes also point at this zone. Narrowing
          the radius alone will NOT narrow the area: anyone who declines the location permission and
          types a postal code is still served. Tick the box below in the same save.
        </p>
      )}

      <div className="mt-8 grid gap-4">
        <label className="grid gap-1">
          <span className="text-meta text-muted">Delivery fee (cents)</span>
          <input
            inputMode="numeric"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className="tap-lg tnum rounded-sm border border-line bg-raised px-3 text-lead text-ink"
          />
          <span className="text-meta text-muted">
            {money(Number(fee.replace(/\D/g, '')) || 0, ADMIN_LOCALE)}
          </span>
        </label>

        <label className="grid gap-1">
          <span className="text-meta text-muted">Free delivery above (cents, blank for never)</span>
          <input
            inputMode="numeric"
            value={freeAbove}
            onChange={(e) => setFreeAbove(e.target.value)}
            className="tap-lg tnum rounded-sm border border-line bg-raised px-3 text-lead text-ink"
          />
          <span className="text-meta text-muted">
            {freeAbove.trim() === ''
              ? 'No free delivery at any basket size.'
              : money(Number(freeAbove.replace(/\D/g, '')) || 0, ADMIN_LOCALE)}
          </span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1">
            <span className="text-meta text-muted">Shop latitude</span>
            <input
              inputMode="decimal"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="tap-lg tnum rounded-sm border border-line bg-raised px-3 text-body text-ink"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-meta text-muted">Shop longitude</span>
            <input
              inputMode="decimal"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              className="tap-lg tnum rounded-sm border border-line bg-raised px-3 text-body text-ink"
            />
          </label>
        </div>

        <label className="grid gap-1">
          <span className="text-meta text-muted">Delivery radius (km)</span>
          <input
            inputMode="decimal"
            value={radiusKm}
            onChange={(e) => setRadiusKm(e.target.value)}
            className="tap-lg tnum rounded-sm border border-line bg-raised px-3 text-lead text-ink"
          />
        </label>

        {first.fsaCount > 0 && (
          <label className="flex items-start gap-3 rounded-sm border border-line bg-soft px-3 py-3 text-body">
            <input
              type="checkbox"
              checked={clearPostal}
              onChange={(e) => setClearPostal(e.target.checked)}
              className="mt-1 size-5"
            />
            <span>
              Also delete the {first.fsaCount.toLocaleString()} postal-code prefixes, so the radius
              is the only rule. This cannot be undone from here.
            </span>
          </label>
        )}

        {error !== null && (
          <p role="alert" className="rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
            {error}
          </p>
        )}
        {saved && <p className="text-body text-muted">Saved.</p>}

        <SecondaryButton type="button" disabled={busy} onClick={() => void save()}>
          Save delivery area
        </SecondaryButton>
      </div>

      <PrimaryBar>
        <PrimaryButton type="button" onClick={() => router.push('/admin')}>
          Done
        </PrimaryButton>
      </PrimaryBar>
    </>
  );
}
