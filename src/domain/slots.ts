/**
 * Slots — cutoffs, capacity, hot-food eligibility, and the wall-clock ↔
 * instant conversion that DST makes non-trivial.
 *
 * PURE. No I/O, no clock. `now` is always a parameter — see CLAUDE.md.
 *
 * Spec §4 (Fulfilment, inv-F3…inv-F5), §5.3 preconditions P2/P3/P7, inv-O3.
 */

// ── inv-F5, P2, P3, P7 as predicates ─────────────────────────────────────

/**
 * inv-F5 — `cutoff ≤ start < end`.
 *
 * `cutoff ≤ start`, not `<`: a slot whose cutoff is its own start time is
 * legitimate (order right up to the window opening). `start < end` is strict
 * because a zero-length window is not a window.
 */
export function slotTimesOrdered(cutoffMs: number, startMs: number, endMs: number): boolean {
  return cutoffMs <= startMs && startMs < endMs;
}

/**
 * P2 — the slot is still open.
 *
 * Strictly before. At exactly the cutoff instant the slot is closed: the
 * owner's "order by 2pm" means the last order lands at 13:59:59, and a rule
 * that admits 14:00:00.000 exactly is a rule nobody can explain to a customer
 * whose order was refused one millisecond later.
 */
export function isBeforeCutoff(nowMs: number, cutoffMs: number): boolean {
  return nowMs < cutoffMs;
}

/** P3 / inv-F4 — the slot has room for one more order. */
export function hasCapacity(bookedCount: number, capacity: number): boolean {
  return bookedCount < capacity;
}

/**
 * P7 / inv-O3 — the hot-food rule.
 *
 * If ANY line in the basket is hot cooked-to-order, the whole order must go in
 * a hot-eligible slot. Not the hot lines — the whole order, because it travels
 * as one delivery.
 *
 * A basket with no hot lines may use any slot, including a hot-eligible one.
 * The constraint is one-directional and it is a food-safety rule, not a
 * preference to be relaxed when a customer complains.
 */
export function slotAllowsBasket(basketHasHotLine: boolean, slotIsHotEligible: boolean): boolean {
  return !basketHasHotLine || slotIsHotEligible;
}

// ── Wall clock ↔ instant, across DST ─────────────────────────────────────

/**
 * The offset, in minutes, that `timeZone` was at on a given UTC instant.
 *
 * WHY `Intl` IS PERMITTED IN THE DOMAIN
 * -------------------------------------
 * The domain rule is "no I/O, no ambient state, no clock". `Intl` is none of
 * those: it reads the ICU timezone database, which is static data compiled
 * into the runtime, and the result is a pure function of (instant, zone). No
 * clock is read — the instant is an argument. Reimplementing DST rules by hand
 * to avoid it would be strictly worse: the tz database changes several times a
 * year as governments change their minds, and a hand-rolled table would be
 * wrong within months.
 */
function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }

  // `hour12: false` yields hour 24 for midnight in some ICU versions. Measured
  // rather than assumed to be safe: normalise it.
  const hour = parts.hour === 24 ? 0 : (parts.hour ?? 0);

  const asIfUtc = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    hour,
    parts.minute ?? 0,
    parts.second ?? 0,
  );

  return (asIfUtc - utcMs) / 60_000;
}

/**
 * The instant at which a wall-clock time occurs in a given IANA timezone.
 *
 * This is the function that stops slot cutoffs drifting by an hour twice a
 * year. The naive alternative — take a fixed UTC offset for the shop and add
 * it — is correct for about ten months and wrong for the other two, in
 * opposite directions, and the symptom is that the shop stops taking orders an
 * hour early every spring.
 *
 * TWO PASSES, AND THE SECOND ONE IS THE POINT. The offset depends on the
 * instant, and the instant is what we are solving for. Pass one guesses using
 * the offset at the naive timestamp; pass two re-reads the offset at that
 * guess. One iteration is sufficient for every real zone, because offsets
 * change by at most a couple of hours and never twice within that window.
 *
 * @param isoDate `YYYY-MM-DD` in the shop's local calendar
 * @param hhmm    `HH:MM`, 24-hour, the owner's wall clock
 */
export function wallClockToInstant(isoDate: string, hhmm: string, timeZone: string): number {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  const tm = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!dm || !tm) throw new Error(`Bad wall clock: ${isoDate} ${hhmm}`);

  const naive = Date.UTC(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]),
  );

  const firstGuess = naive - zoneOffsetMinutes(naive, timeZone) * 60_000;
  return naive - zoneOffsetMinutes(firstGuess, timeZone) * 60_000;
}

/**
 * The wall-clock hour and minute a given instant lands on, in a zone.
 * The inverse of the above, and what the admin console renders.
 */
export function instantToWallClock(utcMs: number, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const hour = parts.hour === '24' ? '00' : (parts.hour ?? '00');
  return `${hour}:${parts.minute ?? '00'}`;
}

// ── Slot selection ───────────────────────────────────────────────────────

export interface SlotView {
  readonly id: string;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
  readonly cutoffAtMs: number;
  readonly capacity: number;
  readonly bookedCount: number;
  readonly hotEligible: boolean;
  readonly active: boolean;
}

export type SlotRejection = 'slotCutoffPassed' | 'slotFull' | 'hotFoodNotAllowedInSlot';

/**
 * Whether this basket may use this slot, and if not, precisely why.
 *
 * The order of the checks is the order of the preconditions, and it is
 * load-bearing for the error message: a slot that is both past its cutoff and
 * full should say "that slot just closed", because that is the thing the
 * customer can do something about.
 */
export function evaluateSlot(
  slot: SlotView,
  basketHasHotLine: boolean,
  nowMs: number,
): { ok: true } | { ok: false; reason: SlotRejection } {
  if (!slot.active || !isBeforeCutoff(nowMs, slot.cutoffAtMs)) {
    return { ok: false, reason: 'slotCutoffPassed' };
  }
  if (!hasCapacity(slot.bookedCount, slot.capacity)) {
    return { ok: false, reason: 'slotFull' };
  }
  if (!slotAllowsBasket(basketHasHotLine, slot.hotEligible)) {
    return { ok: false, reason: 'hotFoodNotAllowedInSlot' };
  }
  return { ok: true };
}

/** The slots a customer may actually pick, for the picker. */
export function selectableSlots(
  slots: readonly SlotView[],
  basketHasHotLine: boolean,
  nowMs: number,
): readonly SlotView[] {
  return slots.filter((s) => evaluateSlot(s, basketHasHotLine, nowMs).ok);
}
