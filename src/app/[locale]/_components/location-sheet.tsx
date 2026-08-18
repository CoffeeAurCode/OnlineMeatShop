'use client';

import { useRef, useState } from 'react';
import {
  CheckCircleIcon,
  CrosshairIcon,
  MapPinIcon,
  SpinnerGapIcon,
  XIcon,
} from '@phosphor-icons/react/dist/ssr';

import { t, type Locale } from '@/i18n';
import { money } from '@/ui/format';
import {
  clearDeliveryLocation,
  requestDeviceLocation,
  setDeliveryLocation,
  useDeliveryLocation,
  type DeliveryLocation,
  type DropOff,
} from '@/ui/location';

import { useDialog, useScrollLock } from './dialog';
import { closeLocationSheet, useLocationSheetOpen } from './drawer-state';

/**
 * ⭐ THE ADDRESS SHEET. The single place a delivery address is entered, opened
 * from the header pill, from the hero, and from checkout.
 *
 * One surface rather than three, because an address typed at checkout and an
 * address typed in the hero have to be the same address. The previous
 * storefront had a postcode box in the hero that told you whether the shop
 * delivered and then threw the answer away, so checkout asked again.
 *
 * ── THE ORDER OF THE CONTROLS IS THE ARGUMENT ─────────────────────────────
 *
 * "Use my current location" is first and is the primary button, because on a
 * phone it is one tap against roughly forty keystrokes, and because the
 * coordinate it returns is better data than anything typed. The lines below it
 * are not an alternative to it: they are the rest of the answer. A coordinate
 * finds the building; the lines say which door.
 *
 * ⚠ NO AUTOCOMPLETE, AND THAT IS A DECISION RATHER THAN AN OMISSION. Address
 * autocomplete means a third-party geocoder: an API key, a per-lookup cost, a
 * script in the critical path, and every keystroke of a customer's home
 * address sent to a company that is not this shop. The device's own
 * coordinate plus two typed lines gets the parcel to the door without any of
 * that. It is written up as a decision, not a gap, in the backend plan.
 */

export function LocationSheet({ locale }: { locale: Locale }) {
  const open = useLocationSheetOpen();
  const { location, ready } = useDeliveryLocation();

  if (!open) return null;
  return <Sheet locale={locale} initial={location} ready={ready} />;
}

function Sheet({
  locale,
  initial,
  ready,
}: {
  locale: Locale;
  initial: DeliveryLocation;
  ready: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLButtonElement>(null);

  // Edited locally and committed on save, so abandoning the sheet leaves the
  // stored address exactly as it was. Editing the store live would mean
  // closing the sheet half way through typing silently changed the delivery
  // fee shown behind it.
  const [draft, setDraft] = useState<DeliveryLocation>(initial);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [check, setCheck] = useState<ServiceabilityAnswer | null>(null);

  const set = <K extends keyof DeliveryLocation>(key: K, value: DeliveryLocation[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  /*
   * Escape, the Tab trap, and putting focus back where it came from.
   *
   * ⚠ THE LAST ONE MATTERS MORE HERE THAN ANYWHERE ELSE IN THE STOREFRONT,
   * because this sheet is opened from FOUR places — the header pill, the hero,
   * the basket strip and the checkout review card — and the checkout one is
   * the expensive case. A customer who opens it to fix a typo in their street
   * and closes it used to land back at the top of the document, having to walk
   * a form they had already filled in.
   */
  useDialog(panel, closeLocationSheet, firstField);
  useScrollLock();

  async function locate() {
    setLocating(true);
    setLocateError(null);
    const result = await requestDeviceLocation();
    setLocating(false);

    if (!result.ok) {
      setLocateError(t(locale, `location.error.${result.error}`));
      return;
    }
    setDraft((d) => ({
      ...d,
      lat: result.lat,
      lng: result.lng,
      accuracyM: result.accuracyM,
      source: 'device',
    }));
    void ask({ lat: result.lat, lng: result.lng, postalCode: null }, setCheck);
  }

  function save() {
    setDeliveryLocation(draft);
    closeLocationSheet();
  }

  const hasPoint = draft.lat !== null && draft.lng !== null;
  const canSave = hasPoint || draft.postalCode.trim() !== '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-sheet-title"
    >
      <button
        type="button"
        onClick={closeLocationSheet}
        aria-label={t(locale, 'nav.close')}
        className="absolute inset-0 animate-[fade-in_var(--duration-standard)_ease-out] bg-midnight/60"
      />

      {/*
        Bottom sheet on a phone, centred dialog on a laptop. The phone form is
        not a styling preference: this is reachable one-handed at the bottom of
        the screen, and a centred modal on a 360px viewport is a full-screen
        overlay with wasted margins.
      */}
      <div
        ref={panel}
        className="
          relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-md border
          border-line bg-surface elev-sheet
          animate-[slide-up_var(--duration-standard)_var(--ease-brand)]
          sm:max-h-[86dvh] sm:max-w-[34rem] sm:rounded-md
          sm:animate-[fade-in_var(--duration-standard)_ease-out]
        "
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2
              id="location-sheet-title"
              className="!font-sans !text-section !pb-0 !tracking-normal font-semibold"
            >
              {t(locale, 'location.title')}
            </h2>
            <p className="mt-1 text-meta text-muted">{t(locale, 'location.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={closeLocationSheet}
            aria-label={t(locale, 'nav.close')}
            className="tap -mr-2 grid w-11 shrink-0 place-items-center rounded-sm text-muted hover:text-ink"
          >
            <XIcon size={20} aria-hidden />
          </button>
        </header>

        <div className="grid gap-5 overflow-y-auto px-5 py-5">
          <div className="grid gap-2">
            <button
              ref={firstField}
              type="button"
              onClick={() => void locate()}
              disabled={locating}
              className="
                tap-lg inline-flex items-center justify-center gap-2 rounded-sm bg-accent px-5
                text-body font-semibold text-accent-ink transition-[transform,background-color]
                duration-(--duration-fast) ease-brand hover:bg-accent-hover active:scale-[0.99]
                disabled:opacity-60
              "
            >
              {locating ? (
                <SpinnerGapIcon
                  size={18}
                  aria-hidden
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <CrosshairIcon size={18} weight="bold" aria-hidden />
              )}
              {locating ? t(locale, 'location.locating') : t(locale, 'location.useDevice')}
            </button>

            {locateError !== null && (
              <p role="alert" className="text-meta font-semibold text-danger">
                {locateError}
              </p>
            )}

            {hasPoint && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-line bg-soft px-3 py-2 text-meta">
                <MapPinIcon size={15} weight="fill" aria-hidden className="text-accent" />
                <span className="tnum font-semibold">
                  {draft.lat?.toFixed(5)}, {draft.lng?.toFixed(5)}
                </span>
                {/*
                  Accuracy is shown because it is the difference between "we
                  know your building" and "we know your block", and the
                  customer is the only one who can tell which by looking at the
                  address lines below.
                */}
                {draft.accuracyM !== null && (
                  <span className="text-ink/70">
                    {t(locale, 'location.accuracy', { m: draft.accuracyM })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({ ...d, lat: null, lng: null, accuracyM: null, source: null }))
                  }
                  className="ml-auto underline underline-offset-2 hover:no-underline"
                >
                  {t(locale, 'location.clearPin')}
                </button>
              </p>
            )}

            {check !== null && <Verdict answer={check} locale={locale} />}
          </div>

          <hr className="border-line" />

          <Field
            id="loc-line1"
            label={t(locale, 'checkout.line1Label')}
            value={draft.line1}
            onChange={(v) => set('line1', v)}
            autoComplete="address-line1"
          />
          <Field
            id="loc-line2"
            label={t(locale, 'checkout.line2Label')}
            help={t(locale, 'checkout.line2Optional')}
            value={draft.line2}
            onChange={(v) => set('line2', v)}
            autoComplete="address-line2"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="loc-city"
              label={t(locale, 'checkout.cityLabel')}
              value={draft.city}
              onChange={(v) => set('city', v)}
              autoComplete="address-level2"
            />
            <Field
              id="loc-region"
              label={t(locale, 'checkout.regionLabel')}
              value={draft.region}
              onChange={(v) => set('region', v)}
              autoComplete="address-level1"
            />
          </div>

          {/*
            ⚠ OPTIONAL NOW, AND LABELLED AS SUCH. It used to be the whole
            address mechanism and the only required field; it is now the
            fallback for a visitor who declined the location permission.
          */}
          <Field
            id="loc-postal"
            label={t(locale, 'checkout.postalLabel')}
            help={
              hasPoint
                ? t(locale, 'location.postalRedundant')
                : t(locale, 'location.postalFallback')
            }
            value={draft.postalCode}
            onChange={(v) => set('postalCode', v)}
            autoComplete="postal-code"
          />

          <fieldset className="grid gap-2">
            <legend className="text-body font-semibold">{t(locale, 'location.dropOffLabel')}</legend>
            <div className="grid gap-2">
              {(['HAND_TO_ME', 'MEET_OUTSIDE', 'LEAVE_AT_DOOR'] as const).map((option) => (
                <DropOffChoice
                  key={option}
                  option={option}
                  chosen={draft.dropOff}
                  onChoose={(v) => set('dropOff', v)}
                  locale={locale}
                />
              ))}
            </div>
          </fieldset>

          <Field
            id="loc-notes"
            label={t(locale, 'checkout.notesLabel')}
            help={t(locale, 'checkout.notesHelp')}
            value={draft.notes}
            onChange={(v) => set('notes', v)}
          />
        </div>

        <footer className="grid gap-2 border-t border-line bg-raised px-5 py-4">
          <button
            type="button"
            onClick={save}
            disabled={!canSave || !ready}
            className="
              tap-lg inline-flex items-center justify-center rounded-sm bg-accent px-6 text-body
              font-semibold text-accent-ink transition-colors duration-(--duration-fast) hover:bg-accent-hover
              disabled:opacity-50
            "
          >
            {t(locale, 'location.save')}
          </button>
          {!canSave && <p className="text-meta text-muted">{t(locale, 'location.needOne')}</p>}
          {canSave && (
            <button
              type="button"
              onClick={() => {
                clearDeliveryLocation();
                closeLocationSheet();
              }}
              className="tap text-meta text-muted underline underline-offset-4 hover:text-ink"
            >
              {t(locale, 'location.forget')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/**
 * The three hand-over options.
 *
 * ⚠ "LEAVE AT DOOR" CARRIES A WARNING AND THE OTHERS DO NOT. This shop sells
 * raw fish. An unattended box on a step in July is a food-safety outcome, not
 * a preference, and offering the three as equals would be the shop implying
 * otherwise. The option stays available because the customer may well be
 * standing behind the door.
 */
function DropOffChoice({
  option,
  chosen,
  onChoose,
  locale,
}: {
  option: DropOff;
  chosen: DropOff;
  onChoose: (v: DropOff) => void;
  locale: Locale;
}) {
  const active = chosen === option;
  return (
    <label
      className={`tap flex cursor-pointer items-center gap-3 rounded-sm border px-4 py-2 transition-colors duration-(--duration-fast) ${
        active ? 'border-accent bg-soft' : 'border-line bg-raised hover:border-accent'
      }`}
    >
      <input
        type="radio"
        name="dropOff"
        value={option}
        checked={active}
        onChange={() => onChoose(option)}
        className="size-4 accent-[var(--accent)]"
      />
      <span className="grid">
        <span className="text-body font-semibold">{t(locale, `location.dropOff.${option}`)}</span>
        {option === 'LEAVE_AT_DOOR' && (
          <span className="text-meta text-muted">{t(locale, 'location.dropOffColdWarning')}</span>
        )}
      </span>
    </label>
  );
}

interface ServiceabilityAnswer {
  served: boolean;
  feeCents?: number;
  freeAboveCents?: number | null;
  distanceM?: number;
}

function Verdict({ answer, locale }: { answer: ServiceabilityAnswer; locale: Locale }) {
  if (!answer.served) {
    return (
      <p className="rounded-sm border border-danger bg-danger-wash px-3 py-2 text-meta font-semibold text-danger">
        {t(locale, 'errors.outsideDeliveryAreaGps')}
      </p>
    );
  }

  const fee = answer.feeCents ?? 0;
  return (
    <p className="flex items-start gap-2 rounded-sm border border-line bg-soft px-3 py-2 text-meta">
      <CheckCircleIcon size={16} weight="fill" aria-hidden className="mt-0.5 shrink-0 text-accent" />
      <span>
        {fee === 0
          ? t(locale, 'location.servedFree')
          : t(locale, 'location.served', { fee: money(fee, locale) })}
        {answer.distanceM !== undefined && (
          <>
            {' '}
            <span className="text-ink/70">
              {t(locale, 'location.distance', { km: (answer.distanceM / 1000).toFixed(1) })}
            </span>
          </>
        )}
      </span>
    </p>
  );
}

/** Ask the server. Failure is silent here: the verdict is a courtesy, and the
 *  precondition is enforced at checkout regardless. */
async function ask(
  body: { lat: number | null; lng: number | null; postalCode: string | null },
  onAnswer: (a: ServiceabilityAnswer) => void,
): Promise<void> {
  try {
    const res = await fetch('/api/serviceable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
    onAnswer((await res.json()) as ServiceabilityAnswer);
  } catch {
    /* offline. The header pill still saves; checkout will say so. */
  }
}

function Field({
  id,
  label,
  help,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  help?: string | undefined;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string | undefined;
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-body font-semibold">
        {label}
      </label>
      {help !== undefined && (
        <p id={`${id}-help`} className="text-meta text-muted">
          {help}
        </p>
      )}
      <input
        id={id}
        name={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-describedby={help === undefined ? undefined : `${id}-help`}
        className="tap rounded-sm border border-line bg-raised px-3 text-body text-ink placeholder:text-muted"
      />
    </div>
  );
}
