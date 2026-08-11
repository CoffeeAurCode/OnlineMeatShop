import { describe, expect, it } from 'vitest';

import {
  evaluateSlot,
  hasCapacity,
  instantToWallClock,
  isBeforeCutoff,
  selectableSlots,
  slotAllowsBasket,
  slotTimesOrdered,
  wallClockToInstant,
  type SlotView,
} from '@/domain/slots';

/**
 * ⚠ Every time and capacity here is FICTIONAL. The real slots, cutoffs and
 * which of them carry hot food are blocked on the client (DQ-4), and this
 * repository is public — see CLAUDE.md §1.
 */

const HOUR = 3_600_000;

function slotAt(overrides: Partial<SlotView> = {}): SlotView {
  const start = Date.UTC(2026, 6, 15, 21, 0); // arbitrary fixed instant
  return {
    id: 'slot-1',
    startsAtMs: start,
    endsAtMs: start + 2 * HOUR,
    cutoffAtMs: start - 4 * HOUR,
    capacity: 10,
    bookedCount: 0,
    hotEligible: false,
    active: true,
    ...overrides,
  };
}

describe('inv-F5 — cutoff ≤ start < end', () => {
  it('accepts a cutoff equal to the start', () => {
    // Ordering right up to the window opening is legitimate.
    expect(slotTimesOrdered(100, 100, 200)).toBe(true);
  });

  it('refuses a cutoff after the start, and a zero-length window', () => {
    expect(slotTimesOrdered(150, 100, 200)).toBe(false);
    expect(slotTimesOrdered(100, 200, 200)).toBe(false);
  });
});

describe('P2 — the cutoff', () => {
  it('is exclusive at the boundary', () => {
    // "Order by 2pm" means the last order lands at 13:59:59. A rule that
    // admits exactly 14:00:00.000 cannot be explained to the customer refused
    // one millisecond later.
    expect(isBeforeCutoff(999, 1000)).toBe(true);
    expect(isBeforeCutoff(1000, 1000)).toBe(false);
    expect(isBeforeCutoff(1001, 1000)).toBe(false);
  });
});

describe('P3 / inv-F4 — capacity', () => {
  it('allows one more up to but not including capacity', () => {
    expect(hasCapacity(9, 10)).toBe(true);
    expect(hasCapacity(10, 10)).toBe(false);
    expect(hasCapacity(11, 10)).toBe(false);
  });
});

describe('P7 / inv-O3 — the hot-food rule', () => {
  it('refuses a hot basket in a non-hot slot, and permits everything else', () => {
    expect(slotAllowsBasket(true, false)).toBe(false);
    expect(slotAllowsBasket(true, true)).toBe(true);
    // One-directional: a cold basket may use a hot-eligible slot.
    expect(slotAllowsBasket(false, true)).toBe(true);
    expect(slotAllowsBasket(false, false)).toBe(true);
  });
});

describe('evaluateSlot — which reason wins', () => {
  const now = Date.UTC(2026, 6, 15, 12, 0);

  it('accepts an open slot with room', () => {
    expect(evaluateSlot(slotAt(), false, now)).toEqual({ ok: true });
  });

  it('reports the cutoff first when a slot is both closed AND full', () => {
    // Deliberate ordering: the cutoff is the thing the customer can act on by
    // picking another slot, so it is the sentence they should see.
    const s = slotAt({ cutoffAtMs: now - 1, bookedCount: 10 });
    expect(evaluateSlot(s, false, now)).toEqual({ ok: false, reason: 'slotCutoffPassed' });
  });

  it('reports slotFull, then hot-eligibility', () => {
    expect(evaluateSlot(slotAt({ bookedCount: 10 }), true, now)).toEqual({
      ok: false,
      reason: 'slotFull',
    });
    expect(evaluateSlot(slotAt({ hotEligible: false }), true, now)).toEqual({
      ok: false,
      reason: 'hotFoodNotAllowedInSlot',
    });
  });

  it('treats an inactive slot as closed', () => {
    expect(evaluateSlot(slotAt({ active: false }), false, now)).toEqual({
      ok: false,
      reason: 'slotCutoffPassed',
    });
  });
});

describe('selectableSlots — what the picker shows', () => {
  const now = Date.UTC(2026, 6, 15, 12, 0);

  it('filters a hot basket down to hot-eligible slots only', () => {
    const slots = [
      slotAt({ id: 'cold', hotEligible: false }),
      slotAt({ id: 'hot', hotEligible: true }),
    ];
    expect(selectableSlots(slots, true, now).map((s) => s.id)).toEqual(['hot']);
    expect(selectableSlots(slots, false, now).map((s) => s.id)).toEqual(['cold', 'hot']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// THE GATE for this increment: DST correctness on cutoffs.
// ─────────────────────────────────────────────────────────────────────────

/**
 * A cutoff that shifts by an hour twice a year is a real, dated bug. These
 * tests pin the behaviour on both transitions, in both directions.
 *
 * `America/Toronto` is used as a stand-in. The shop's actual timezone depends
 * on DQ-1 (province/town) and is configuration, not a constant — but every
 * Canadian zone except most of Saskatchewan observes DST on the same dates,
 * so the arithmetic these tests pin is the arithmetic that will run.
 */
const TZ = 'America/Toronto';

describe('DST — the gate', () => {
  it('holds the wall clock across the SPRING FORWARD boundary', () => {
    // 2026-03-08 02:00 local: clocks jump to 03:00. EST (UTC-5) → EDT (UTC-4).
    const before = wallClockToInstant('2026-03-07', '14:00', TZ);
    const after = wallClockToInstant('2026-03-09', '14:00', TZ);

    // Both are 2pm to the owner...
    expect(instantToWallClock(before, TZ)).toBe('14:00');
    expect(instantToWallClock(after, TZ)).toBe('14:00');

    // ...but they are 19:00Z and 18:00Z. A fixed-offset implementation gets
    // one of these wrong, and the shop stops taking orders an hour early.
    expect(new Date(before).toISOString()).toBe('2026-03-07T19:00:00.000Z');
    expect(new Date(after).toISOString()).toBe('2026-03-09T18:00:00.000Z');

    // The two 2pms are 47 hours apart, not 48. That IS the bug, made visible.
    expect((after - before) / HOUR).toBe(47);
  });

  it('holds the wall clock across the FALL BACK boundary', () => {
    // 2026-11-01 02:00 local: clocks repeat 01:00. EDT (UTC-4) → EST (UTC-5).
    const before = wallClockToInstant('2026-10-31', '14:00', TZ);
    const after = wallClockToInstant('2026-11-02', '14:00', TZ);

    expect(instantToWallClock(before, TZ)).toBe('14:00');
    expect(instantToWallClock(after, TZ)).toBe('14:00');
    expect(new Date(before).toISOString()).toBe('2026-10-31T18:00:00.000Z');
    expect(new Date(after).toISOString()).toBe('2026-11-02T19:00:00.000Z');

    // 49 hours, in the other direction.
    expect((after - before) / HOUR).toBe(49);
  });

  it('a cutoff and its slot stay in the right order across a transition', () => {
    // The failure this guards: a cutoff computed with one offset and a start
    // computed with another, inverting inv-F5 on exactly two days a year.
    for (const date of ['2026-03-07', '2026-03-08', '2026-03-09', '2026-10-31', '2026-11-01', '2026-11-02']) {
      const cutoff = wallClockToInstant(date, '12:00', TZ);
      const start = wallClockToInstant(date, '17:00', TZ);
      const end = wallClockToInstant(date, '19:00', TZ);
      expect(slotTimesOrdered(cutoff, start, end)).toBe(true);
    }
  });

  it('is stable for a zone that does NOT observe DST', () => {
    // Most of Saskatchewan stays on CST year-round. If the two-pass conversion
    // were wrong, this is where it would show as an off-by-one-hour.
    const SASK = 'America/Regina';
    const winter = wallClockToInstant('2026-01-15', '14:00', SASK);
    const summer = wallClockToInstant('2026-07-15', '14:00', SASK);
    expect(new Date(winter).toISOString()).toBe('2026-01-15T20:00:00.000Z');
    expect(new Date(summer).toISOString()).toBe('2026-07-15T20:00:00.000Z');
  });

  it('round-trips every hour of a transition day without losing the wall clock', () => {
    for (const date of ['2026-03-08', '2026-11-01']) {
      for (let h = 4; h < 24; h++) {
        const hhmm = `${String(h).padStart(2, '0')}:30`;
        const instant = wallClockToInstant(date, hhmm, TZ);
        expect(instantToWallClock(instant, TZ)).toBe(hhmm);
      }
    }
  });
});
