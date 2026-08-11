import { describe, expect, it } from 'vitest';

import {
  canCancel,
  canDeliver,
  canTransition,
  isTerminal,
  nextStatuses,
  notificationsFor,
  requiresFinalTotal,
} from '@/domain/lifecycle';
import type { OrderStatus } from '@/domain/types';

const ALL: readonly OrderStatus[] = [
  'PLACED',
  'PREPARING',
  'WEIGHED',
  'READY',
  'OUT',
  'DELIVERED',
  'CANCELLED',
];

describe('the transition graph', () => {
  it('walks the happy path and nothing else', () => {
    expect(nextStatuses('PLACED')).toEqual(['PREPARING', 'CANCELLED']);
    expect(nextStatuses('PREPARING')).toEqual(['WEIGHED']);
    expect(nextStatuses('WEIGHED')).toEqual(['READY']);
    expect(nextStatuses('READY')).toEqual(['OUT']);
    expect(nextStatuses('OUT')).toEqual(['DELIVERED']);
  });

  it('never goes backwards', () => {
    // Stripe does not guarantee delivery order, so a late event can describe a
    // state already passed. The graph is what stops it being applied.
    const order = ['PLACED', 'PREPARING', 'WEIGHED', 'READY', 'OUT', 'DELIVERED'] as const;
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j <= i; j++) {
        expect(canTransition(order[i]!, order[j]!)).toBe(false);
      }
    }
  });

  it('treats DELIVERED and CANCELLED as terminal', () => {
    expect(isTerminal('DELIVERED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    for (const s of ALL.filter((s) => s !== 'DELIVERED' && s !== 'CANCELLED')) {
      expect(isTerminal(s)).toBe(false);
    }
  });

  it('⭐ has NO shortcut into READY (inv-O4)', () => {
    // inv-O4: an order cannot reach READY until every per-kg line is weighed.
    // The graph enforces it structurally — READY is reachable only from
    // WEIGHED, and WEIGHED only through Finalise, which refuses while any line
    // is unweighed. This test is what stops a "convenience" edge being added.
    const intoReady = ALL.filter((s) => canTransition(s, 'READY'));
    expect(intoReady).toEqual(['WEIGHED']);

    const intoWeighed = ALL.filter((s) => canTransition(s, 'WEIGHED'));
    expect(intoWeighed).toEqual(['PREPARING']);
  });

  it('has no PAID status — payment is a separate machine', () => {
    // DTM §8.3. An order can be READY while its capture is pending, and a
    // capture can succeed against an order cancelled a second earlier. One
    // column cannot express either.
    expect(ALL).not.toContain('PAID');
  });
});

describe('cancellation (spec §5.7)', () => {
  it('is free while merely PLACED', () => {
    expect(canCancel('PLACED')).toBe(true);
    expect(canTransition('PLACED', 'CANCELLED')).toBe(true);
  });

  it('is refused once the butcher has started cutting', () => {
    // The meat is committed. Partial cancellation of uncut lines is v2 (FR-23).
    for (const s of ALL.filter((s) => s !== 'PLACED')) {
      expect(canCancel(s)).toBe(false);
      expect(canTransition(s, 'CANCELLED')).toBe(false);
    }
  });
});

describe('inv-O5 — a final total exists exactly when weighing is done', () => {
  it('is required from WEIGHED onward and forbidden before', () => {
    expect(requiresFinalTotal('PLACED')).toBe(false);
    expect(requiresFinalTotal('PREPARING')).toBe(false);
    expect(requiresFinalTotal('CANCELLED')).toBe(false);
    for (const s of ['WEIGHED', 'READY', 'OUT', 'DELIVERED'] as const) {
      expect(requiresFinalTotal(s)).toBe(true);
    }
  });
});

describe('Deliver (spec §5.8)', () => {
  it('closes a prepaid order that is out for delivery', () => {
    expect(canDeliver('OUT', 'PREPAID', 1580, null)).toBe(true);
  });

  it('requires EXACTLY the final amount for cash on delivery', () => {
    expect(canDeliver('OUT', 'COD', 1580, 1580)).toBe(true);
    // Not "at least". A rider who collects more has taken money the customer
    // never agreed to; one who collects less leaves a shortfall somebody has
    // to account for. Both need catching at the door, not at reconciliation.
    expect(canDeliver('OUT', 'COD', 1580, 1600)).toBe(false);
    expect(canDeliver('OUT', 'COD', 1580, 1500)).toBe(false);
    expect(canDeliver('OUT', 'COD', 1580, null)).toBe(false);
  });

  it('refuses unless the order is actually out', () => {
    for (const s of ALL.filter((s) => s !== 'OUT')) {
      expect(canDeliver(s, 'PREPAID', 1580, null)).toBe(false);
    }
  });
});

describe('notifications (FR-24) — email only at launch', () => {
  it('sends on the transitions the customer cares about', () => {
    expect(notificationsFor('o1', 'PLACED').map((n) => n.kind)).toEqual(['order.accepted']);
    expect(notificationsFor('o1', 'WEIGHED').map((n) => n.kind)).toEqual(['order.weighed']);
    expect(notificationsFor('o1', 'DELIVERED').map((n) => n.kind)).toEqual(['order.delivered']);
    expect(notificationsFor('o1', 'CANCELLED').map((n) => n.kind)).toEqual(['order.cancelled']);
  });

  it('stays SILENT on the ones nobody wants', () => {
    // "We started preparing your order" is a notification nobody asked for,
    // and every unwanted one costs attention on the ones that matter.
    expect(notificationsFor('o1', 'PREPARING')).toEqual([]);
    expect(notificationsFor('o1', 'READY')).toEqual([]);
    expect(notificationsFor('o1', 'OUT')).toEqual([]);
  });

  it('derives a dedupe key per order and kind', () => {
    // A redelivered webhook that correctly declines to repeat its effects must
    // also decline to send a second email.
    expect(notificationsFor('o1', 'PLACED')[0]?.dedupeKey).toBe('order.accepted:o1');
    expect(notificationsFor('o2', 'PLACED')[0]?.dedupeKey).toBe('order.accepted:o2');
  });

  it('is EMAIL only — SMS is cut at launch (D18)', () => {
    for (const s of ALL) {
      for (const n of notificationsFor('o1', s)) expect(n.channel).toBe('EMAIL');
    }
  });
});
