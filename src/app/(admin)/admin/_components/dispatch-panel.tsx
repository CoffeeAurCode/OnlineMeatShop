'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Assignment } from '@/db/repositories/orders';
import type { Partner } from '@/db/repositories/partners';
import type { OrderStatus } from '@/domain/types';

import { SecondaryButton } from './shell';

/**
 * Who is taking this order, and telling them.
 *
 * ══ WHY ASSIGN AND DISPATCH ARE TWO BUTTONS AND NOT ONE ═══════════════════
 *
 * ⭐ ASSIGNING IS FREE; DISPATCHING SPENDS SOMETHING THAT CANNOT BE UNSPENT.
 *
 * The owner often knows who is driving before the fish is cut, and changes
 * their mind when somebody calls in sick. Assignment is a single-row update
 * and reversing it costs nothing. Sending the message puts a customer's home
 * address on somebody's phone; there is no un-sending it, and doing it
 * automatically on assignment would mean every reassignment texted the wrong
 * person first.
 *
 * ⚠ REASSIGNING CLEARS THE DISPATCH FLAG on the server, so the panel goes back
 * to "not told yet" by itself. That is the behaviour to preserve if this is
 * ever rewritten — an order that still reads as dispatched after the driver
 * changed is one nobody sends a second message about.
 *
 * ⚠ A SECOND TAP OF "SEND" IS A REPLAY, NOT AN ERROR. Same rule as the payment
 * capture. The server answers `replay: true` with the original time and this
 * shows that, rather than an error that would invite a third tap.
 */

const REFUSALS: Record<string, string> = {
  notAssigned: 'Nobody is assigned to this order any more. Refreshing.',
  inactivePartner: 'That driver is no longer on the roster.',
  noCustomerPhone: 'This order has no customer phone number, so the message would be useless.',
  sendFailed: 'The message did not send.',
  forbiddenContent: 'The message was blocked because it contained something a driver must not see.',
  finished: 'This order is already finished.',
  alreadyInPreparation: 'This order is already being prepared, so it cannot be cancelled here.',
};

export function DispatchPanel({
  orderId,
  status,
  assignment,
  partners,
  suggestedPartnerId,
}: {
  orderId: string;
  status: OrderStatus;
  assignment: Assignment;
  partners: readonly Partner[];
  suggestedPartnerId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const finished = status === 'DELIVERED' || status === 'CANCELLED';

  async function post(url: string, body: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const parsed = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const reason = String(parsed.reason ?? '');
        setError(
          (REFUSALS[reason] ?? 'That did not work. Nothing has changed.') +
            (reason === 'sendFailed' && typeof parsed.detail === 'string'
              ? ` (${parsed.detail.slice(0, 120)})`
              : ''),
        );
        setBusy(false);
        router.refresh();
        return null;
      }
      setBusy(false);
      router.refresh();
      return parsed;
    } catch {
      setError('That did not work. Check the connection and try again.');
      setBusy(false);
      return null;
    }
  }

  if (finished) {
    return assignment.partnerName === null ? null : (
      <section className="mt-8 border-t border-line pt-4">
        <h2 className="text-section font-semibold tracking-tight">Driver</h2>
        <p className="mt-1 text-body text-muted">
          {assignment.partnerName} · {assignment.partnerPhone}
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 border-t border-line pt-4">
      <h2 className="text-section font-semibold tracking-tight">Driver</h2>

      {partners.length === 0 ? (
        <p className="mt-2 rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
          Nobody is on the roster, so this order cannot go out. Add a driver first.
        </p>
      ) : (
        <div className="mt-3 grid gap-2">
          {partners.map((p) => {
            const chosen = assignment.partnerId === p.id;
            const suggested = !chosen && assignment.partnerId === null && suggestedPartnerId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() => void post('/api/admin/assign', { orderId, partnerId: p.id })}
                className={`tap-lg flex items-center justify-between rounded-sm border px-4 text-left text-body disabled:opacity-50 ${
                  chosen ? 'border-accent bg-soft font-semibold' : 'border-line bg-raised'
                }`}
              >
                <span className="min-w-0 truncate">
                  {p.name}
                  {p.notes === null ? '' : ` · ${p.notes}`}
                </span>
                <span className="shrink-0 text-meta text-muted">
                  {chosen ? 'assigned' : suggested ? 'last used' : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {assignment.partnerId !== null && (
        <div className="mt-4 grid gap-3">
          <p className="text-body text-muted">
            {assignment.dispatchedAtMs === null
              ? `${assignment.partnerName} has not been told yet.`
              : `Sent to ${assignment.partnerName} at ${new Date(assignment.dispatchedAtMs).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false })}.`}
          </p>

          <SecondaryButton
            type="button"
            disabled={busy}
            onClick={() =>
              void post('/api/admin/dispatch', {
                orderId,
                resend: assignment.dispatchedAtMs !== null,
              }).then((body) => {
                if (body === null) return;
                if (body.replay === true) {
                  setNote('That message had already gone. Nothing was sent twice.');
                  return;
                }
                setNote(
                  `Sent by ${String(body.provider ?? 'unknown')} · ${String(body.segments ?? '?')} SMS segment(s).`,
                );
                if (typeof body.preview === 'string') setPreview(body.preview);
              })
            }
          >
            {assignment.dispatchedAtMs === null ? 'Send the job to the driver' : 'Send it again'}
          </SecondaryButton>

          <button
            type="button"
            disabled={busy}
            onClick={() => void post('/api/admin/assign', { orderId, partnerId: null })}
            className="tap justify-self-start text-meta text-muted underline underline-offset-4 disabled:opacity-50"
          >
            Take this order off {assignment.partnerName}
          </button>
        </div>
      )}

      {note !== null && <p className="mt-3 text-body text-muted">{note}</p>}

      {preview !== null && (
        <details className="mt-3 rounded-sm border border-line bg-soft px-3 py-2">
          <summary className="cursor-pointer text-meta text-muted">
            What the driver received
          </summary>
          {/*
            Shown because the owner is the only person who sees both this and
            the driver's phone, and therefore the only one who can notice that
            an address line is wrong.
          */}
          <pre className="mt-2 whitespace-pre-wrap text-meta">{preview}</pre>
        </details>
      )}

      {error !== null && (
        <p role="alert" className="mt-3 rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
          {error}
        </p>
      )}

      {status === 'PLACED' && (
        <div className="mt-8 border-t border-line pt-4">
          {/*
            ⚠ CANCELLING IS NOT A STATUS CHANGE. It returns the stock and
            unbooks the slot inside one transaction. It is offered only while
            the order is PLACED, because once the fish is cut the meat is
            committed (spec §5.7) — and the button disappearing after that is
            the rule being visible rather than explained.
          */}
          <button
            type="button"
            disabled={busy}
            onClick={() => void post('/api/admin/cancel', { orderId })}
            className="tap text-meta text-danger underline underline-offset-4 disabled:opacity-50"
          >
            Cancel this order and put the stock back
          </button>
        </div>
      )}
    </section>
  );
}
