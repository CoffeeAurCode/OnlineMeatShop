import { describe, expect, it } from 'vitest';

import {
  amountDueAtDoor,
  canReportDelivery,
  cashOutcome,
  driverStage,
  isOpenJob,
} from '@/domain/driver';
import type { OrderStatus } from '@/domain/types';

const ALL_STATUSES: readonly OrderStatus[] = [
  'PLACED',
  'PREPARING',
  'WEIGHED',
  'READY',
  'OUT',
  'DELIVERED',
  'CANCELLED',
];

describe('driverStage', () => {
  it('collapses the three shop-side statuses into one "not yet"', () => {
    expect(driverStage('PLACED')).toBe('preparing');
    expect(driverStage('PREPARING')).toBe('preparing');
    expect(driverStage('WEIGHED')).toBe('preparing');
  });

  it('only says "ready for pickup" at READY', () => {
    // The failure this guards against is a driver standing in the shop waiting
    // for a box that is still on the scale.
    for (const status of ALL_STATUSES) {
      expect(driverStage(status) === 'readyForPickup').toBe(status === 'READY');
    }
  });

  it('keeps cancelled visibly distinct — a driver must not deliver it', () => {
    expect(driverStage('CANCELLED')).toBe('cancelled');
    expect(driverStage('DELIVERED')).toBe('delivered');
  });

  it('has an answer for every status', () => {
    for (const status of ALL_STATUSES) {
      expect(typeof driverStage(status)).toBe('string');
    }
  });
});

describe('isOpenJob', () => {
  it('counts everything that still needs the driver, and nothing that does not', () => {
    expect(ALL_STATUSES.filter(isOpenJob)).toEqual([
      'PLACED',
      'PREPARING',
      'WEIGHED',
      'READY',
      'OUT',
    ]);
  });
});

describe('amountDueAtDoor', () => {
  it('is null on a prepaid order however much it is worth', () => {
    expect(amountDueAtDoor('PREPAID', 4620)).toBeNull();
    expect(amountDueAtDoor('PREPAID', null)).toBeNull();
  });

  it('⭐ is null on a cash order that has not been weighed', () => {
    // The important one. There is genuinely no amount yet, and showing the
    // estimate "for now" would put a number in a driver's head that the scale
    // is about to change.
    expect(amountDueAtDoor('COD', null)).toBeNull();
  });

  it('is the FINAL total on a weighed cash order', () => {
    expect(amountDueAtDoor('COD', 4620)).toBe(4620);
  });
});

describe('cashOutcome', () => {
  it('is notDue whenever nothing is owed at the door', () => {
    expect(cashOutcome('PREPAID', 4620, 4620)).toBe('notDue');
    expect(cashOutcome('COD', null, 4620)).toBe('notDue');
  });

  it('⭐ demands EXACTLY, not at least', () => {
    expect(cashOutcome('COD', 4620, 4620)).toBe('exact');
    expect(cashOutcome('COD', 4620, 4619)).toBe('short');
    // The one an "at least" check would wave through: the customer has been
    // charged more than they agreed to.
    expect(cashOutcome('COD', 4620, 4621)).toBe('over');
  });

  it('treats a one-cent difference as a difference', () => {
    expect(cashOutcome('COD', 1, 0)).toBe('short');
    expect(cashOutcome('COD', 0, 1)).toBe('over');
    expect(cashOutcome('COD', 0, 0)).toBe('exact');
  });
});

describe('canReportDelivery', () => {
  it('is OUT and nothing else', () => {
    for (const status of ALL_STATUSES) {
      expect(canReportDelivery(status)).toBe(status === 'OUT');
    }
  });

  it('⭐ refuses a second report, which is what a double tap looks like', () => {
    // A driver on one bar of signal taps twice. The first tap moves the order
    // to DELIVERED; the second must not be able to rewrite a settled cash
    // figure with a fresh keystroke.
    expect(canReportDelivery('DELIVERED')).toBe(false);
  });

  it('refuses before the counter has handed the order over', () => {
    // The client chose "counter marks shipped, driver marks delivered", so an
    // order the driver has not been given cannot be closed by them.
    expect(canReportDelivery('READY')).toBe(false);
  });
});
