'use client';

import { useRef, useState } from 'react';
import {
  CheckCircleIcon,
  NavigationArrowIcon,
  NotePencilIcon,
  SpinnerGapIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react/dist/ssr';

import { isValidPostalCode } from '@/domain/serviceability';
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
 * from the header pill, from the basket and from checkout.
 *
 * One surface rather than three, because an address typed at checkout and an
 * address typed in the header have to be the same address. The previous
 * storefront had a postcode box in the hero that told you whether the shop
 * delivered and then threw the answer away, so checkout asked again.
 *
 * ── THE COMPOSITION IS THE REFERENCE'S, THE BEHAVIOUR IS OURS ─────────────
 *
 * Figma parity, Phase 3, against `254:1768` Change Address Screen. What was
 * taken is the ROW ANATOMY and the section banding: a leading icon, a title
 * with a quiet second line under it, and the action as a pill on the right —
 * repeated for the destination, the saved address and the delivery note, with
 * an 8px band between groups instead of a rule.
 *
 * What was NOT taken is the reference's content. It offers a search box wired
 * to a third-party geocoder, a "Nearby" list and a "Recent locations" list;
 * we have one saved address, no geocoder (see below) and no recents domain.
 * Rendering an empty "Recent locations" heading to match a picture would be
 * the decorative backfill `08-PLAN` Phase 2 bans.
 *
 * ── THE ORDER OF THE CONTROLS IS THE ARGUMENT ─────────────────────────────
 *
 * "Use my current location" is first and is the primary action, because on a
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

/**
 * ⭐ EVERY STATE THE SERVICEABILITY QUESTION HAS. Phase 3 names six and they
 * are six different sentences, because the customer can act on exactly one
 * thing in each.
 *
 * ⚠ `failed` IS NOT `outside`, AND CONFLATING THEM IS THE EXPENSIVE BUG. A
 * request that never arrived rendered as "we do not deliver to you" is a lie
 * the shop cannot take back, and it is the version that loses an order to a
 * cold instance. `invalid` is separate again: a malformed postal code comes
 * back from the server as `served: false`, which is indistinguishable from a
 * real address outside the radius unless it is caught before the round trip.
 */
type Check =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'invalid' }
  | { state: 'failed' }
  | {
      state: 'answer';
      served: boolean;
      feeCents?: number;
      freeAboveCents?: number | null;
      distanceM?: number;
    };

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
  const [check, setCheck] = useState<Check>({ state: 'idle' });

  const set = <K extends keyof DeliveryLocation>(key: K, value: DeliveryLocation[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  /*
   * Escape, the Tab trap, and putting focus back where it came from.
   *
   * ⚠ THE LAST ONE MATTERS MORE HERE THAN ANYWHERE ELSE IN THE STOREFRONT,
   * because this sheet is opened from FOUR places — the header pill, the
   * delivery strip, the basket strip and the checkout review card — and the
   * checkout one is the expensive case. A customer who opens it to fix a typo
   * in their street and closes it used to land back at the top of the
   * document, having to walk a form they had already filled in.
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

  /*
   * ⭐ THE TYPED POSTAL CODE IS CHECKED TOO, AND IT DID NOT USED TO BE.
   *
   * Only the GPS path asked the server, so a desktop visitor who declined the
   * permission and typed `H2X 1Y4` got no answer at all in this sheet — the
   * first word on whether the shop delivers to them arrived on a different
   * screen. Phase 3 lists the outside-area and invalid-address states as
   * required here, and neither was reachable.
   *
   * On blur rather than per keystroke: a partial postal code is invalid by
   * construction, so validating while it is being typed shows an error for
   * every character up to the last one.
   */
  function checkPostal(): void {
    const code = draft.postalCode.trim();
    // A pin beats a typed code — `resolveDestinationZone` uses the coordinate
    // — so there is nothing to re-ask when one is already set.
    if (code === '' || (draft.lat !== null && draft.lng !== null)) return;
    if (!isValidPostalCode(code)) {
      setCheck({ state: 'invalid' });
      return;
    }
    void ask({ lat: null, lng: null, postalCode: code }, setCheck);
  }

  function save() {
    setDeliveryLocation(draft);
    closeLocationSheet();
  }

  const hasPin = draft.lat !== null && draft.lng !== null;
  const canSave = hasPin || draft.postalCode.trim() !== '';

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

        <div className="overflow-y-auto">
          {/*
            ⭐ SECTION ONE: THE DESTINATION, AS THE REFERENCE'S "NEARBY" ROW.
            Leading icon, title, quiet second line, action as a pill on the
            right. The pill's label changes with the state rather than the row
            appearing and disappearing, so the control keeps its position.
          */}
          <Section label={t(locale, 'location.destinationHeading')}>
            <Row
              icon={<NavigationArrowIcon size={20} weight="fill" aria-hidden className="text-accent" />}
              title={t(locale, 'location.currentLocation')}
              subtitle={
                hasPin
                  ? `${draft.lat?.toFixed(5)}, ${draft.lng?.toFixed(5)}${
                      draft.accuracyM === null
                        ? ''
                        : ` · ${t(locale, 'location.accuracy', { m: draft.accuracyM })}`
                    }`
                  : t(locale, 'location.currentLocationHelp')
              }
              action={
                <button
                  ref={firstField}
                  type="button"
                  onClick={() => void locate()}
                  disabled={locating}
                  className="
                    tap inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-4
                    text-meta font-semibold text-accent-ink transition-[transform,background-color]
                    duration-(--duration-fast) ease-brand hover:bg-accent-hover active:scale-[0.98]
                    disabled:opacity-60
                  "
                >
                  {locating && (
                    <SpinnerGapIcon
                      size={14}
                      aria-hidden
                      className="animate-spin motion-reduce:animate-none"
                    />
                  )}
                  {locating
                    ? t(locale, 'location.locating')
                    : hasPin
                      ? t(locale, 'location.updatePin')
                      : t(locale, 'location.enable')}
                </button>
              }
            />

            {locateError !== null && (
              <p role="alert" className="px-5 pb-3 text-meta font-semibold text-danger">
                {locateError}
              </p>
            )}

            {hasPin && (
              <div className="px-5 pb-3">
                <button
                  type="button"
                  onClick={() => {
                    setDraft((d) => ({
                      ...d,
                      lat: null,
                      lng: null,
                      accuracyM: null,
                      source: null,
                    }));
                    setCheck({ state: 'idle' });
                  }}
                  className="tap text-meta text-muted underline underline-offset-4 hover:text-ink"
                >
                  {t(locale, 'location.clearPin')}
                </button>
              </div>
            )}

          </Section>

          <Band />

          <Section label={t(locale, 'location.addressHeading')}>
            <div className="grid gap-4 px-5 pb-5">
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
                fallback for a visitor who declined the location permission —
                and it is the one field in here that is CHECKED against the
                delivery area as soon as it is filled in.
              */}
              <Field
                id="loc-postal"
                label={t(locale, 'checkout.postalLabel')}
                help={
                  hasPin
                    ? t(locale, 'location.postalRedundant')
                    : t(locale, 'location.postalFallback')
                }
                value={draft.postalCode}
                onChange={(v) => {
                  set('postalCode', v);
                  // Any edit invalidates the previous answer. Leaving a green
                  // "we deliver to you" under a half-retyped code is worse
                  // than showing nothing.
                  if (check.state !== 'idle') setCheck({ state: 'idle' });
                }}
                onBlur={checkPostal}
                autoComplete="postal-code"
              />
            </div>
          </Section>

          <Band />

          {/*
            ⭐ SECTION THREE: THE DOOR. The reference's "Meet at the door /
            Add delivery note" row, expanded to our three hand-over options —
            which are a real domain choice here rather than a label, because
            one of them is a food-safety decision.
          */}
          <Section label={t(locale, 'location.handoverHeading')}>
            <div className="grid gap-4 px-5 pb-5">
              <fieldset className="grid gap-2">
                <legend className="text-body font-semibold">
                  {t(locale, 'location.dropOffLabel')}
                </legend>
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
                icon={<NotePencilIcon size={16} aria-hidden className="text-muted" />}
                value={draft.notes}
                onChange={(v) => set('notes', v)}
              />
            </div>
          </Section>
        </div>

        <footer className="grid gap-2 border-t border-line bg-raised px-5 py-4">
          {/*
            ⭐ THE VERDICT LIVES WITH THE SAVE BUTTON, NOT WITH THE CONTROL
            THAT PRODUCED IT.

            ⚠ IT WAS UNDER THE "CURRENT LOCATION" ROW AT THE TOP, WHICH IS
            WRONG FOR HALF THE CASES AND INVISIBLE FOR THE OTHER HALF. Two
            different controls ask the same question: the GPS button at the top,
            and the postal code near the bottom of a scrolling sheet. Answering
            the second one at the top means the answer renders off-screen, on
            the phone, for the visitor who declined the location permission —
            which is precisely the visitor who most needs to be told whether
            this shop comes to them. Photographed and caught by
            `scripts/check-parity.mjs`.

            `aria-live` so it is announced rather than only painted.
          */}
          <div aria-live="polite" className="empty:hidden">
            <Verdict check={check} locale={locale} />
          </div>

          <button
            type="button"
            data-parity="location-save"
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
 * A titled group. The label is the reference's small section heading; the
 * band between groups is `Band` below.
 */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="!font-sans !text-meta !pb-0 !tracking-normal px-5 pb-1 pt-4 font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </h3>
      {children}
    </section>
  );
}

/**
 * The 8px grey band the reference puts between groups instead of a hairline.
 * `aria-hidden` because it is a picture of a gap.
 */
function Band() {
  return <div aria-hidden className="h-2 bg-soft" />;
}

/** Leading icon · title · quiet second line · action pill. The reference's row. */
function Row({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <span className="grid size-6 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold">{title}</span>
        <span className="tnum block truncate text-meta text-muted">{subtitle}</span>
      </span>
      {action}
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

/** Five renderings of one question, and the sixth — `idle` — is nothing at all. */
function Verdict({ check, locale }: { check: Check; locale: Locale }) {
  if (check.state === 'idle') return null;

  if (check.state === 'checking') {
    return (
      <p className="flex items-center gap-2 rounded-sm border border-line bg-soft px-3 py-2 text-meta text-muted">
        <SpinnerGapIcon
          size={15}
          aria-hidden
          className="shrink-0 animate-spin motion-reduce:animate-none"
        />
        {t(locale, 'location.checking')}
      </p>
    );
  }

  if (check.state === 'invalid') {
    return (
      <p className="flex items-start gap-2 rounded-sm border border-danger bg-danger-wash px-3 py-2 text-meta font-semibold text-danger">
        <WarningIcon size={15} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
        {t(locale, 'errors.invalidPostalCode')}
      </p>
    );
  }

  /*
   * ⚠ A FAILED CHECK IS NOT A REFUSAL. Offline, a cold instance and a route
   * that is down all land here, and "we do not deliver to you" would be a lie
   * the shop cannot take back. The address still saves; checkout is where the
   * question is actually decided, by P1, inside the placement transaction.
   */
  if (check.state === 'failed') {
    return (
      <p className="flex items-start gap-2 rounded-sm border border-line bg-soft px-3 py-2 text-meta">
        <WarningIcon size={15} weight="fill" aria-hidden className="mt-0.5 shrink-0 text-muted" />
        {t(locale, 'location.checkFailed')}
      </p>
    );
  }

  if (!check.served) {
    return (
      <p className="flex items-start gap-2 rounded-sm border border-danger bg-danger-wash px-3 py-2 text-meta font-semibold text-danger">
        <WarningIcon size={15} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
        {t(locale, 'errors.outsideDeliveryAreaGps')}
      </p>
    );
  }

  const fee = check.feeCents ?? 0;
  return (
    <p className="flex items-start gap-2 rounded-sm border border-line bg-soft px-3 py-2 text-meta">
      <CheckCircleIcon size={16} weight="fill" aria-hidden className="mt-0.5 shrink-0 text-accent" />
      <span>
        {fee === 0
          ? t(locale, 'location.servedFree')
          : t(locale, 'location.served', { fee: money(fee, locale) })}
        {check.freeAboveCents != null && fee > 0 && (
          <> {t(locale, 'location.freeAbove', { amount: money(check.freeAboveCents, locale) })}</>
        )}
        {check.distanceM !== undefined && (
          <>
            {' '}
            <span className="text-ink/70">
              {t(locale, 'location.distance', { km: (check.distanceM / 1000).toFixed(1) })}
            </span>
          </>
        )}
      </span>
    </p>
  );
}

/**
 * Ask the server.
 *
 * ⚠ A FAILURE IS REPORTED NOW, WHERE IT USED TO BE SWALLOWED. The old version
 * caught and discarded, on the reasoning that the verdict is a courtesy and P1
 * enforces the rule regardless. That is true of the RULE and false of the
 * SCREEN: a customer who taps "Enable", shares their location and sees nothing
 * appear cannot tell a broken shop from a shop that has not answered yet.
 */
async function ask(
  body: { lat: number | null; lng: number | null; postalCode: string | null },
  onAnswer: (c: Check) => void,
): Promise<void> {
  onAnswer({ state: 'checking' });
  try {
    const res = await fetch('/api/serviceable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      onAnswer({ state: 'failed' });
      return;
    }
    const answer = (await res.json()) as {
      served: boolean;
      feeCents?: number;
      freeAboveCents?: number | null;
      distanceM?: number;
    };
    onAnswer({ state: 'answer', ...answer });
  } catch {
    onAnswer({ state: 'failed' });
  }
}

function Field({
  id,
  label,
  help,
  icon,
  value,
  onChange,
  onBlur,
  autoComplete,
}: {
  id: string;
  label: string;
  help?: string | undefined;
  icon?: React.ReactNode | undefined;
  value: string;
  onChange: (v: string) => void;
  onBlur?: (() => void) | undefined;
  autoComplete?: string | undefined;
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="flex items-center gap-1.5 text-body font-semibold">
        {icon}
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
        onBlur={onBlur}
        autoComplete={autoComplete}
        aria-describedby={help === undefined ? undefined : `${id}-help`}
        className="tap rounded-sm border border-line bg-raised px-3 text-body text-ink placeholder:text-muted"
      />
    </div>
  );
}
