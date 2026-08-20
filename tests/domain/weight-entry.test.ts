import { describe, expect, it } from 'vitest';

import { weightFromEntry } from '@/ui/weight-entry';

describe('typed product weights', () => {
  it('accepts only whole gram values on the catalog step', () => {
    expect(weightFromEntry('750', 500, 250, 2_000)).toBe(750);
    expect(weightFromEntry('625', 500, 250, 2_000)).toBeNull();
    expect(weightFromEntry('750.5', 500, 250, 2_000)).toBeNull();
    expect(weightFromEntry(' 750 ', 500, 250, 2_000)).toBeNull();
  });

  it('enforces both the product minimum and the available-stock ceiling', () => {
    expect(weightFromEntry('250', 500, 250, 2_000)).toBeNull();
    expect(weightFromEntry('2000', 500, 250, 2_000)).toBe(2_000);
    expect(weightFromEntry('2250', 500, 250, 2_000)).toBeNull();
  });

  it('allows legal weights when no stock ceiling has been declared', () => {
    expect(weightFromEntry('3000', 500, 250, null)).toBe(3_000);
    expect(weightFromEntry('', 500, 250, null)).toBeNull();
    expect(weightFromEntry('-500', 500, 250, null)).toBeNull();
  });
});
