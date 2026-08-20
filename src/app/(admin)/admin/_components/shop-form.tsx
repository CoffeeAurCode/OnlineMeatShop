'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { formatPhone, normalisePhone } from '@/domain/phone';
import { isValidPostalCode } from '@/domain/serviceability';
import {
  PROVINCES,
  addressLines,
  groupHours,
  townSlug,
  weekOf,
  type DayHours,
  type ShopIdentity,
  type Weekday,
} from '@/domain/shop';

import { Empty, PrimaryBar, PrimaryButton, SecondaryButton } from './shell';

/**
 * The shop's own details, edited by the owner.
 *
 * ══ WHY THIS SCREEN EXISTS AT ALL ═════════════════════════════════════════
 *
 * ⭐ EVERY VALUE ON IT USED TO BE AN ENVIRONMENT VARIABLE. Changing the phone
 * number meant editing a hosting dashboard and waiting for a redeploy, which
 * in practice meant it never changed, which is why the live site still called
 * itself by a placeholder name for a week. Opening hours move because a
 * supplier is late; that is a Tuesday, not a deployment.
 *
 * ══ THE THREE DECISIONS THAT SHAPED IT ════════════════════════════════════
 *
 * ⭐ 1. THE PREVIEW AT THE BOTTOM IS THE POINT, not decoration. Same rule as
 * "Test the sound now" on the settings screen: the owner is editing values
 * that appear somewhere they are not looking, so the screen shows the result
 * while they are still standing in front of it. Runs of identical days collapse
 * there exactly as they will in the footer.
 *
 * ⭐ 2. "USE THESE HOURS EVERY DAY" IS ONE TAP INSTEAD OF TWELVE. A fish
 * counter keeps the same hours most days. Fourteen time pickers on a phone at
 * 6am is a form nobody finishes, and a form nobody finishes is a footer that
 * stays empty.
 *
 * ⚠ 3. A TOWN IS A PAGE, AND THE SCREEN SAYS SO. Each name here creates
 * `/delivery/<slug>`, and a page per town with nothing unique on it is the
 * doorway-page pattern Google's guidance targets. The empty state explains
 * that before the list gets long, because the cost of the mistake lands
 * months later on the whole site's ranking.
 *
 * ⚠ NORMALISATION IS THE SERVER'S JOB. This form checks the postal code as it
 * is typed so the owner is not told at save time, but `/api/admin/shop` is
 * what decides. A browser-side canonical form is canonical only until there is
 * a second client.
 */

const DAY_LABEL: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const FIELD =
  'tap-lg w-full rounded-sm border border-line bg-raised px-3 text-lead text-ink placeholder:text-muted';

export function ShopForm({ identity }: { identity: ShopIdentity }) {
  const router = useRouter();

  const [street, setStreet] = useState(identity.street);
  const [locality, setLocality] = useState(identity.locality);
  const [region, setRegion] = useState(identity.region);
  const [postalCode, setPostalCode] = useState(identity.postalCode);
  const [phone, setPhone] = useState(identity.phone);
  const [hours, setHours] = useState<DayHours[]>(weekOf(identity.hours));
  const [towns, setTowns] = useState<string[]>(identity.towns.map((t) => t.name));
  const [newTown, setNewTown] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const postalLooksWrong = postalCode.trim() !== '' && !isValidPostalCode(postalCode);
  const phoneLooksWrong = phone.trim() !== '' && normalisePhone(phone) === null;
  const firstOpen = hours.find((d) => d.opens !== null && d.closes !== null);

  function setDay(day: Weekday, patch: Partial<DayHours>) {
    setSaved(false);
    setHours((current) => current.map((d) => (d.day === day ? { ...d, ...patch } : d)));
  }

  function addTown() {
    const name = newTown.trim().replace(/\s+/g, ' ');
    if (name === '' || townSlug(name) === '') return;
    // The slug is the identity, here as well as on the server: two spellings
    // of one town would be two URLs serving the same page.
    if (towns.some((t) => townSlug(t) === townSlug(name))) {
      setNewTown('');
      return;
    }
    setTowns((current) => [...current, name]);
    setNewTown('');
    setSaved(false);
  }

  async function save() {
    /*
     * ⚠ CAUGHT HERE RATHER THAN AT THE SERVER, because the server's answer for
     * a half-filled day is `invalidBody`, which is true and useless. The owner
     * needs to know WHICH day.
     */
    const halfFilled = hours.find(
      (d) => (d.opens === null) !== (d.closes === null) || d.opens === '' || d.closes === '',
    );
    if (halfFilled !== undefined) {
      setError(`${DAY_LABEL[halfFilled.day]} needs both an opening and a closing time.`);
      return;
    }
    const backwards = hours.find((d) => d.opens !== null && d.closes !== null && d.closes <= d.opens);
    if (backwards !== undefined) {
      setError(`${DAY_LABEL[backwards.day]} closes before it opens.`);
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/admin/shop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ street, locality, region, postalCode, phone, hours, towns }),
      });
      const body: unknown = await res.json();
      if (!res.ok) {
        const reason =
          typeof body === 'object' && body !== null && 'reason' in body
            ? String((body as { reason: unknown }).reason)
            : '';
        setError(
          reason === 'invalidPostalCode'
            ? 'That postal code is not a Canadian postal code. Nothing was saved.'
            : reason === 'invalidPhone'
              ? 'That phone number cannot be dialled as written. Include the area code. Nothing was saved.'
              : 'That did not save. Nothing has changed.',
        );
        setBusy(false);
        return;
      }
      setSaved(true);
      setBusy(false);
      router.refresh();
    } catch {
      setError('That did not save. Check the connection and try again.');
      setBusy(false);
    }
  }

  const preview = {
    address: addressLines({
      ...identity,
      street: street.trim(),
      locality: locality.trim(),
      region,
      postalCode: postalLooksWrong ? '' : postalCode.trim().replace(/\s+/g, '').toUpperCase(),
    }),
    week: groupHours(hours),
  };

  return (
    <>
      <div className="mt-6 grid gap-5">
        <h2 className="text-section font-semibold tracking-tight">Where the shop is</h2>
        <p className="-mt-3 text-meta text-muted">
          This is the address customers see, and the one search engines read. Leave a field empty
          and it is shown nowhere rather than shown blank.
        </p>

        <label className="grid gap-1">
          <span className="text-meta text-muted">Street and number</span>
          <input
            value={street}
            maxLength={120}
            autoComplete="off"
            onChange={(e) => {
              setStreet(e.target.value);
              setSaved(false);
            }}
            className={FIELD}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-meta text-muted">Town or city</span>
          <input
            value={locality}
            maxLength={120}
            autoComplete="off"
            onChange={(e) => {
              setLocality(e.target.value);
              setSaved(false);
            }}
            className={FIELD}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-meta text-muted">Province</span>
          <select
            value={region}
            onChange={(e) => {
              setRegion(e.target.value);
              setSaved(false);
            }}
            className={FIELD}
          >
            <option value="">Not set</option>
            {Object.entries(PROVINCES).map(([code, name]) => (
              <option key={code} value={code}>
                {code} · {name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-meta text-muted">Postal code</span>
          <input
            value={postalCode}
            maxLength={10}
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(e) => {
              setPostalCode(e.target.value);
              setSaved(false);
            }}
            className={FIELD}
          />
          {postalLooksWrong && (
            <span className="text-meta text-danger">
              A Canadian postal code looks like A1A 1A1.
            </span>
          )}
        </label>

        <label className="grid gap-1">
          <span className="text-meta text-muted">Phone customers can call</span>
          <input
            value={phone}
            type="tel"
            maxLength={24}
            autoComplete="off"
            onChange={(e) => {
              setPhone(e.target.value);
              setSaved(false);
            }}
            className={FIELD}
          />
          <span className={phoneLooksWrong ? 'text-meta text-danger' : 'text-meta text-muted'}>
            {phoneLooksWrong
              ? 'That number cannot be dialled as written. Include the area code.'
              : 'The shop’s own number. A driver’s number lives on the Drivers screen.'}
          </span>
        </label>

        <h2 className="mt-8 text-section font-semibold tracking-tight">Opening hours</h2>
        <p className="-mt-3 text-meta text-muted">
          When the counter is open to the public. These do not decide delivery windows, which are
          set on the Delivery windows screen.
        </p>

        <div className="grid">
          {hours.map((day) => {
            const open = day.opens !== null;
            return (
              <div key={day.day} className="grid gap-2 border-b border-line py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-body font-semibold">{DAY_LABEL[day.day]}</span>
                  <label className="flex items-center gap-2 text-meta text-muted">
                    <input
                      type="checkbox"
                      checked={open}
                      onChange={(e) =>
                        setDay(
                          day.day,
                          e.target.checked
                            ? {
                                opens: firstOpen?.opens ?? '09:00',
                                closes: firstOpen?.closes ?? '18:00',
                              }
                            : { opens: null, closes: null },
                        )
                      }
                      className="size-5"
                    />
                    {open ? 'Open' : 'Closed'}
                  </label>
                </div>

                {open && (
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={day.opens ?? ''}
                      onChange={(e) => setDay(day.day, { opens: e.target.value })}
                      aria-label={`${DAY_LABEL[day.day]} opens`}
                      className="tap tnum flex-1 rounded-sm border border-line bg-raised px-3 text-body text-ink"
                    />
                    <span className="text-meta text-muted">to</span>
                    <input
                      type="time"
                      value={day.closes ?? ''}
                      onChange={(e) => setDay(day.day, { closes: e.target.value })}
                      aria-label={`${DAY_LABEL[day.day]} closes`}
                      className="tap tnum flex-1 rounded-sm border border-line bg-raised px-3 text-body text-ink"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {firstOpen !== undefined && (
          <SecondaryButton
            type="button"
            onClick={() => {
              setHours((current) =>
                current.map((d) =>
                  d.opens === null ? d : { ...d, opens: firstOpen.opens, closes: firstOpen.closes },
                ),
              );
              setSaved(false);
            }}
          >
            Use {firstOpen.opens} to {firstOpen.closes} on every open day
          </SecondaryButton>
        )}

        <h2 className="mt-8 text-section font-semibold tracking-tight">Delivery towns</h2>

        {towns.length === 0 ? (
          <div className="mt-3">
            <Empty
              title="No town pages"
              body="Each town added here gets its own page. Add one only when there is something true to say about delivering there that is not true everywhere else. This is not the delivery area, which is set on the Delivery area screen."
            />
          </div>
        ) : (
          <ul className="grid">
            {towns.map((town) => (
              <li
                key={town}
                className="flex items-center justify-between gap-3 border-b border-line py-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-body">{town}</span>
                  <span className="block truncate text-meta text-muted">
                    /delivery/{townSlug(town)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setTowns((current) => current.filter((t) => t !== town));
                    setSaved(false);
                  }}
                  className="tap shrink-0 text-meta text-danger underline underline-offset-4"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {/*
          ⚠ THE BUTTON IS FULL WIDTH AND BELOW THE FIELD, not beside it. The
          console's buttons are all full width by construction, and a phone
          keyboard covers the bottom half of the screen while this field has
          focus. Enter adds the town too, for the same reason.
        */}
        <label className="grid gap-1">
          <span className="text-meta text-muted">Add a town</span>
          <input
            value={newTown}
            maxLength={60}
            autoComplete="off"
            onChange={(e) => setNewTown(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              addTown();
            }}
            className={FIELD}
          />
          {towns.length >= 20 && (
            <span className="text-meta text-muted">
              Twenty town pages is the limit. That is an editorial limit, not a technical one.
            </span>
          )}
        </label>
        <SecondaryButton
          type="button"
          onClick={addTown}
          disabled={newTown.trim() === '' || towns.length >= 20}
        >
          Add this town
        </SecondaryButton>

        <h2 className="mt-8 text-section font-semibold tracking-tight">What customers see</h2>

        <div className="grid gap-4 rounded-sm border border-line bg-raised px-4 py-4">
          {preview.address.length === 0 && preview.week.length === 0 && phone.trim() === '' ? (
            <p className="text-body text-muted">
              Nothing yet. The footer of every page shows this block once there is something in it.
            </p>
          ) : (
            <>
              {preview.address.length > 0 && (
                <div className="grid gap-1 text-body">
                  {preview.address.map((l) => (
                    <span key={l}>{l}</span>
                  ))}
                </div>
              )}
              {phone.trim() !== '' && !phoneLooksWrong && (
                <p className="text-body">{formatPhone(normalisePhone(phone) ?? phone)}</p>
              )}
              {preview.week.length > 0 && (
                <dl className="grid gap-1 text-body">
                  {preview.week.map((run) => (
                    <div key={run.from} className="flex justify-between gap-6">
                      <dt>
                        {run.from === run.to
                          ? DAY_LABEL[run.from]
                          : `${DAY_LABEL[run.from]} to ${DAY_LABEL[run.to]}`}
                      </dt>
                      <dd className="tnum">
                        {run.opens}-{run.closes}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </div>

        {error !== null && (
          <p role="alert" className="rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
            {error}
          </p>
        )}
        {saved && (
          <p className="text-body text-muted">
            Saved. The storefront picks it up on its next request.
          </p>
        )}
      </div>

      <PrimaryBar>
        <PrimaryButton type="button" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving' : 'Save'}
        </PrimaryButton>
      </PrimaryBar>
    </>
  );
}
