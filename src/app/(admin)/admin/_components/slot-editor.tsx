'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { SlotRow } from '@/db/repositories/admin';

import { PrimaryBar, PrimaryButton, Row, SecondaryButton } from './shell';

/**
 * Delivery windows: see what exists, and make more.
 *
 * ⭐ THIS SCREEN EXISTS TO PREVENT A SCHEDULED OUTAGE. Until it did, the only
 * thing that ever created a slot was a seed script. When the seeded ones ran
 * out, checkout offered no window, the storefront looked broken while being
 * technically correct, and nothing anywhere raised its voice.
 *
 * ⚠ THE OWNER TYPES A WALL CLOCK AND THE SERVER OWNS THE TIMEZONE. "14:00" is
 * a local time in Montreal, not an instant; the conversion goes through the
 * shop's IANA zone on the server, including the two DST cases. Nothing on this
 * screen constructs a `Date` from those strings, deliberately — a browser in
 * another timezone would build the wrong instant and it would look right.
 *
 * ⚠ THE DEFAULT CUTOFF IS THE PREVIOUS EVENING, not the same morning, because
 * fish is bought at market before the shop opens. It is a default and not a
 * rule; the field is editable.
 */

interface Draft {
  startsAt: string;
  endsAt: string;
  cutoffDate: string;
  cutoffAt: string;
  capacity: number;
  hotEligible: boolean;
}

function previousDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function defaultDrafts(date: string): Draft[] {
  const cutoffDate = previousDay(date);
  return [
    { startsAt: '10:00', endsAt: '12:00', cutoffDate, cutoffAt: '20:00', capacity: 6, hotEligible: false },
    { startsAt: '12:00', endsAt: '14:00', cutoffDate, cutoffAt: '20:00', capacity: 6, hotEligible: true },
    { startsAt: '16:00', endsAt: '18:00', cutoffDate, cutoffAt: '20:00', capacity: 6, hotEligible: true },
    { startsAt: '18:00', endsAt: '20:00', cutoffDate, cutoffAt: '20:00', capacity: 6, hotEligible: false },
  ];
}

const REFUSALS: Record<string, string> = {
  endBeforeStart: 'A window has to end after it starts.',
  cutoffAfterStart: 'The cutoff has to be before the window opens.',
  belowBooked: 'That capacity is below what is already booked into the window.',
  notFound: 'That window is gone. Refreshing.',
};

export function SlotEditor({
  slots,
  today,
  runwayDays,
  timeZone,
}: {
  slots: readonly SlotRow[];
  today: string;
  runwayDays: number;
  /**
   * ⚠ PASSED DOWN FROM THE SERVER, never read from the browser and never
   * hardcoded. The console may be open on a phone that is travelling; the
   * delivery window is not, and `Intl` would otherwise happily render it in
   * whatever zone the device happens to be in.
   */
  timeZone: string;
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [drafts, setDrafts] = useState<Draft[]>(() => defaultDrafts(today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setDay(next: string) {
    setDate(next);
    // The cutoff follows the day, because a cutoff pointing at last Tuesday is
    // the mistake this screen would otherwise make easy.
    const cutoffDate = previousDay(next);
    setDrafts((current) => current.map((d) => ({ ...d, cutoffDate })));
  }

  function patch(i: number, change: Partial<Draft>) {
    setDrafts((current) => current.map((d, j) => (j === i ? { ...d, ...change } : d)));
  }

  async function call(method: 'POST' | 'PATCH', body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/slots', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const parsed = (await res.json()) as { reason?: string };
        setError(REFUSALS[parsed.reason ?? ''] ?? 'That did not save. Nothing has changed.');
        setBusy(false);
        return;
      }
      router.refresh();
      setBusy(false);
    } catch {
      setError('That did not save. Check the connection and try again.');
      setBusy(false);
    }
  }

  const byDate = new Map<string, SlotRow[]>();
  for (const s of slots) {
    const list = byDate.get(s.serviceDate) ?? [];
    list.push(s);
    byDate.set(s.serviceDate, list);
  }

  return (
    <>
      {/*
        ⭐ THE RUNWAY IS THE FIRST THING ON THE SCREEN, and it is a countdown
        rather than a list, because the failure it warns about is silent. Under
        four days it turns red: that is roughly the point at which the booking
        horizon (three days) starts running out of windows to offer.
      */}
      <p
        className={`mt-4 rounded-sm px-3 py-2 text-body ${
          runwayDays <= 3 ? 'bg-danger-wash font-semibold text-danger' : 'bg-soft text-muted'
        }`}
      >
        {runwayDays === 0
          ? 'There are no delivery windows left. Customers cannot check out.'
          : `${runwayDays} day${runwayDays === 1 ? '' : 's'} of delivery windows remain.`}
      </p>

      {[...byDate.entries()].map(([serviceDate, rows]) => (
        <section key={serviceDate} className="mt-8">
          <h2 className="text-section font-semibold tracking-tight">{serviceDate}</h2>
          {rows.map((s) => (
            <Row key={s.id}>
              <span className="min-w-0">
                <span className="tnum block text-body font-semibold">
                  {clock(s.startsAt, timeZone)}–{clock(s.endsAt, timeZone)}
                  {s.hotEligible ? ' · hot' : ''}
                  {s.active ? '' : ' · off'}
                </span>
                <span className="tnum block text-meta text-muted">
                  {s.bookedCount} of {s.capacity} booked · cutoff {clock(s.cutoffAt, timeZone)}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void call('PATCH', { id: s.id, active: !s.active })}
                className="tap shrink-0 text-meta text-muted underline underline-offset-4 disabled:opacity-50"
              >
                {s.active ? 'Turn off' : 'Turn on'}
              </button>
            </Row>
          ))}
        </section>
      ))}

      <section className="mt-10 grid gap-4">
        <h2 className="text-section font-semibold tracking-tight">Add a day of windows</h2>

        <label className="grid gap-1">
          <span className="text-meta text-muted">Delivery date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDay(e.target.value)}
            className="tap-lg tnum rounded-sm border border-line bg-raised px-3 text-lead text-ink"
          />
        </label>

        {drafts.map((d, i) => (
          <div key={i} className="grid gap-2 rounded-sm border border-line bg-raised p-3">
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={d.startsAt}
                onChange={(e) => patch(i, { startsAt: e.target.value })}
                className="tap tnum min-w-0 flex-1 rounded-sm border border-line bg-soft px-2 text-body"
              />
              <span className="text-muted">to</span>
              <input
                type="time"
                value={d.endsAt}
                onChange={(e) => patch(i, { endsAt: e.target.value })}
                className="tap tnum min-w-0 flex-1 rounded-sm border border-line bg-soft px-2 text-body"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-meta text-muted">
                Cutoff
                <input
                  type="time"
                  value={d.cutoffAt}
                  onChange={(e) => patch(i, { cutoffAt: e.target.value })}
                  className="tap tnum min-w-0 flex-1 rounded-sm border border-line bg-soft px-2 text-body"
                />
              </label>
              <label className="flex items-center gap-2 text-meta text-muted">
                Capacity
                <input
                  inputMode="numeric"
                  value={String(d.capacity)}
                  onChange={(e) => patch(i, { capacity: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                  className="tap tnum w-16 rounded-sm border border-line bg-soft px-2 text-body"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-body">
              <input
                type="checkbox"
                checked={d.hotEligible}
                onChange={(e) => patch(i, { hotEligible: e.target.checked })}
                className="size-5"
              />
              {/*
                ⚠ Worded as the food-safety rule it is, not as a feature flag.
                Turning this off on a window removes it from every basket
                containing hot kitchen food — that is the whole of inv-O3 and
                the owner should recognise the consequence from the label.
              */}
              Can carry hot kitchen food
            </label>
          </div>
        ))}

        {error !== null && (
          <p role="alert" className="rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
            {error}
          </p>
        )}

        <SecondaryButton
          type="button"
          disabled={busy}
          onClick={() => void call('POST', { serviceDate: date, windows: drafts })}
        >
          Create {drafts.length} windows on {date}
        </SecondaryButton>
      </section>

      <PrimaryBar>
        <PrimaryButton type="button" onClick={() => router.push('/admin')}>
          Done
        </PrimaryButton>
      </PrimaryBar>
    </>
  );
}

/** Rendered in the shop's zone, from the server-provided `Date`. */
function clock(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(at);
}
