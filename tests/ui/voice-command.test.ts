import { describe, expect, it } from 'vitest';

import { parseVoiceCommand, resolveVoiceOrder } from '@/ui/voice-command';

describe('voice shopping commands', () => {
  it('extracts English weights and leaves a clean product query', () => {
    expect(parseVoiceCommand('Please add 1.5 kg of Atlantic salmon', 'en')).toEqual({
      query: 'atlantic salmon',
      quantity: { kind: 'weight', grams: 1500 },
    });
  });

  it('extracts French counts', () => {
    expect(parseVoiceCommand('Ajoute deux paquets de bisque de homard', 'fr')).toEqual({
      query: 'bisque de homard',
      quantity: { kind: 'count', value: 2 },
    });
  });

  it('accepts a bare quantity at either edge', () => {
    expect(parseVoiceCommand('three lobster rolls', 'en').quantity).toEqual({
      kind: 'count',
      value: 3,
    });
    expect(parseVoiceCommand('lobster rolls 3', 'en').query).toBe('lobster rolls');
  });

  it('does not remove an embedded number from a product name', () => {
    expect(parseVoiceCommand('caviar 30g tin', 'en')).toEqual({
      query: 'caviar tin',
      quantity: { kind: 'weight', grams: 30 },
    });
    expect(parseVoiceCommand('caviar reserve 30 tin', 'en')).toEqual({
      query: 'caviar reserve 30 tin',
      quantity: null,
    });
  });
});

describe('spoken quantities become legal cart weights', () => {
  const weighed = { pricingMode: 'perKg' as const, minOrderG: 500, stepG: 250, availableG: 3000 };
  const pack = { pricingMode: 'pack' as const, minOrderG: 300, stepG: 300, availableG: 1200 };

  it('uses the catalog minimum when no quantity was spoken', () => {
    expect(resolveVoiceOrder(weighed, null)).toEqual({ ok: true, requestedG: 500 });
  });

  it('treats a count as multiples of the product unit', () => {
    expect(resolveVoiceOrder(pack, { kind: 'count', value: 3 })).toEqual({
      ok: true,
      requestedG: 900,
    });
    expect(resolveVoiceOrder(weighed, { kind: 'count', value: 2 })).toEqual({
      ok: true,
      requestedG: 1000,
    });
  });

  it('rejects weight for a fixed pack and invalid weighed steps', () => {
    expect(resolveVoiceOrder(pack, { kind: 'weight', grams: 500 })).toEqual({
      ok: false,
      reason: 'wrongUnit',
    });
    expect(resolveVoiceOrder(weighed, { kind: 'weight', grams: 600 })).toEqual({
      ok: false,
      reason: 'invalidQuantity',
    });
  });

  it("does not add more than today's stock", () => {
    expect(resolveVoiceOrder(weighed, { kind: 'weight', grams: 4000 })).toEqual({
      ok: false,
      reason: 'insufficientStock',
    });
  });
});
