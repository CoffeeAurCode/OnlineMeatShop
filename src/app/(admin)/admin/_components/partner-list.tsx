'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Partner } from '@/db/repositories/partners';

import { PrimaryBar, PrimaryButton, Row, SecondaryButton } from './shell';

/**
 * The delivery partner roster, edited from a phone.
 *
 * ⭐ THE GOAL IS THIRTY SECONDS: name, number, save. Everything that is not
 * one of those two fields is optional and below them.
 *
 * ⚠ "REMOVE" IS DEACTIVATE, AND THE BUTTON SAYS SO. There is no delete on this
 * screen and no endpoint behind one. Orders reference these rows; deleting
 * somebody would strip the live reference off every delivery they ever made.
 * The wording matters because "Delete" would set an expectation the system
 * deliberately does not meet — a deactivated partner still appears on their
 * old orders, and the owner should not be surprised by that.
 */

const REFUSALS: Record<string, string> = {
  invalidPhone: 'That is not a phone number the shop can text. Include the country code.',
  duplicatePhone: 'Somebody active already has that number.',
  notFound: 'That partner is no longer here. Refreshing.',
};

export function PartnerList({ partners }: { partners: readonly Partner[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: 'POST' | 'PATCH', body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/partners', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const parsed = (await res.json()) as { reason?: string };
        setError(REFUSALS[parsed.reason ?? ''] ?? 'That did not save. Nothing has changed.');
        setBusy(false);
        return false;
      }
      router.refresh();
      setBusy(false);
      return true;
    } catch {
      setError('That did not save. Check the connection and try again.');
      setBusy(false);
      return false;
    }
  }

  async function add() {
    const ok = await call('POST', {
      name: name.trim(),
      phone: phone.trim(),
      notes: notes.trim() === '' ? null : notes.trim(),
      sortOrder: partners.length,
    });
    if (ok) {
      setName('');
      setPhone('');
      setNotes('');
    }
  }

  const active = partners.filter((p) => p.active);
  const inactive = partners.filter((p) => !p.active);

  return (
    <>
      <div className="mt-6">
        {active.length === 0 && (
          <p className="rounded-md border border-line bg-raised px-4 py-6 text-body text-muted">
            Nobody is on the roster, so no order can be sent out. Add whoever is driving today.
          </p>
        )}
        {active.map((p) => (
          <Row key={p.id}>
            <span className="min-w-0">
              <span className="block text-body font-semibold">{p.name}</span>
              <span className="tnum block text-meta text-muted">{p.phone}</span>
              {p.notes !== null && <span className="block text-meta text-muted">{p.notes}</span>}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void call('PATCH', { id: p.id, active: false })}
              className="tap shrink-0 text-meta text-muted underline underline-offset-4 disabled:opacity-50"
            >
              Remove
            </button>
          </Row>
        ))}
      </div>

      {inactive.length > 0 && (
        <div className="mt-8">
          <h2 className="text-section font-semibold tracking-tight">No longer driving</h2>
          <p className="mt-1 max-w-[60ch] text-meta text-muted">
            Kept so past orders still say who delivered them. Bringing somebody back re-uses their
            number, unless somebody else has it now.
          </p>
          {inactive.map((p) => (
            <Row key={p.id}>
              <span className="min-w-0">
                <span className="block text-body">{p.name}</span>
                <span className="tnum block text-meta text-muted">{p.phone}</span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void call('PATCH', { id: p.id, active: true })}
                className="tap shrink-0 text-meta text-muted underline underline-offset-4 disabled:opacity-50"
              >
                Bring back
              </button>
            </Row>
          ))}
        </div>
      )}

      <div className="mt-10 grid gap-4">
        <h2 className="text-section font-semibold tracking-tight">Add somebody</h2>

        <label className="grid gap-1">
          <span className="text-meta text-muted">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            className="tap-lg rounded-sm border border-line bg-raised px-3 text-lead text-ink"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-meta text-muted">Mobile number</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            /*
             * `type="tel"` and `inputmode="tel"` together: the first is what
             * the browser stores and autofills, the second is what actually
             * decides which keypad appears on a phone. They are not the same
             * thing and only having one of them costs the owner a keyboard
             * switch on every partner they add.
             */
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="+1 514 555 0142"
            className="tap-lg tnum rounded-sm border border-line bg-raised px-3 text-lead text-ink"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-meta text-muted">Notes (optional)</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="van · weekends only"
            className="tap-lg rounded-sm border border-line bg-raised px-3 text-body text-ink"
          />
        </label>

        {error !== null && (
          <p role="alert" className="rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
            {error}
          </p>
        )}

        <SecondaryButton
          type="button"
          disabled={busy || name.trim() === '' || phone.trim() === ''}
          onClick={() => void add()}
        >
          Add to roster
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
