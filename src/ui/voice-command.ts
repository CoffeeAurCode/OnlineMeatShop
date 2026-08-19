import type { Locale } from '@/i18n';

export type VoiceQuantity =
  | { readonly kind: 'count'; readonly value: number }
  | { readonly kind: 'weight'; readonly grams: number };

export interface VoiceCommand {
  readonly query: string;
  readonly quantity: VoiceQuantity | null;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
};

const NUMBER_TOKEN =
  '(?:\\d+(?:[.,]\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze)';

const WEIGHT_UNIT =
  '(?:kg|kgs|kilogram|kilograms|kilogramme|kilogrammes|kilo|kilos|g|gram|grams|gramme|grammes|lb|lbs|pound|pounds|livre|livres)';
const COUNT_UNIT =
  '(?:x|pack|packs|packet|packets|package|packages|portion|portions|piece|pieces|item|items|paquet|paquets|unite|unites)';

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberFromToken(token: string): number | null {
  const numeric = Number(token.replace(',', '.'));
  if (Number.isFinite(numeric)) return numeric;
  return NUMBER_WORDS[token] ?? null;
}

function cleanQuery(value: string, locale: Locale): string {
  const commands =
    locale === 'fr'
      ? /^(?:(?:s il vous plait|svp)\s+)?(?:(?:ajoute|ajouter|cherche|chercher|recherche|rechercher|trouve|trouver|je veux|je voudrais|donne moi)\s+)+/
      : /^(?:please\s+)?(?:(?:add|find|search(?: for)?|look for|get me|i want|i would like|give me|show me)\s+)+/;

  return value
    .replace(commands, '')
    .replace(/^(?:of|de|du|des|d)\s+/, '')
    .replace(/\s+(?:please|s il vous plait|svp)$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Turn a short spoken shopping request into a product query and an optional
 * quantity. Product matching remains the search page's job, where the live
 * bilingual catalog and today's stock are available.
 */
export function parseVoiceCommand(transcript: string, locale: Locale): VoiceCommand {
  let phrase = cleanQuery(fold(transcript), locale);
  let quantity: VoiceQuantity | null = null;

  const weight = new RegExp(`\\b(${NUMBER_TOKEN})\\s*(${WEIGHT_UNIT})\\b`, 'i').exec(phrase);
  if (weight !== null) {
    const amount = numberFromToken(weight[1] ?? '');
    const unit = weight[2] ?? '';
    if (amount !== null && amount > 0) {
      const grams = /^(?:kg|kgs|kilogram|kilograms|kilogramme|kilogrammes|kilo|kilos)$/.test(
        unit,
      )
        ? amount * 1000
        : /^(?:lb|lbs|pound|pounds|livre|livres)$/.test(unit)
          ? amount * 453.59237
          : amount;
      const rounded = Math.round(grams);
      if (Number.isSafeInteger(rounded) && rounded > 0) {
        quantity = { kind: 'weight', grams: rounded };
        phrase = `${phrase.slice(0, weight.index)} ${phrase.slice(weight.index + weight[0].length)}`;
      }
    }
  }

  if (quantity === null) {
    const countWithUnit = new RegExp(`\\b(${NUMBER_TOKEN})\\s*(${COUNT_UNIT})\\b`, 'i').exec(
      phrase,
    );
    if (countWithUnit !== null) {
      const count = numberFromToken(countWithUnit[1] ?? '');
      if (count !== null && Number.isSafeInteger(count) && count > 0) {
        quantity = { kind: 'count', value: count };
        phrase = `${phrase.slice(0, countWithUnit.index)} ${phrase.slice(countWithUnit.index + countWithUnit[0].length)}`;
      }
    }
  }

  // A bare number is accepted only at an edge. This handles "two salmon" and
  // "salmon two" without stripping numbers that are part of a product name.
  if (quantity === null) {
    const bare = new RegExp(`^(?:(${NUMBER_TOKEN})\\s+(.+)|(.+?)\\s+(${NUMBER_TOKEN}))$`, 'i').exec(
      phrase,
    );
    const token = bare?.[1] ?? bare?.[4];
    const rest = bare?.[2] ?? bare?.[3];
    if (token !== undefined && rest !== undefined) {
      const count = numberFromToken(token);
      if (count !== null && Number.isSafeInteger(count) && count > 0) {
        quantity = { kind: 'count', value: count };
        phrase = rest;
      }
    }
  }

  return {
    query: cleanQuery(phrase.trim().replace(/^(?:of|de|du|des|d)\s+/, ''), locale),
    quantity,
  };
}

export interface VoiceOrderProduct {
  readonly pricingMode: 'pack' | 'perKg';
  readonly minOrderG: number;
  readonly stepG: number;
  readonly availableG: number | null;
}

export type VoiceOrderResolution =
  | { readonly ok: true; readonly requestedG: number }
  | { readonly ok: false; readonly reason: 'wrongUnit' | 'invalidQuantity' | 'insufficientStock' };

/** Resolve spoken units through the same gram-based contract used by the cart. */
export function resolveVoiceOrder(
  product: VoiceOrderProduct,
  quantity: VoiceQuantity | null,
): VoiceOrderResolution {
  let requestedG: number;

  if (quantity === null) {
    requestedG = product.minOrderG;
  } else if (quantity.kind === 'weight') {
    if (product.pricingMode === 'pack') return { ok: false, reason: 'wrongUnit' };
    requestedG = quantity.grams;
  } else {
    requestedG = product.minOrderG * quantity.value;
  }

  if (
    !Number.isSafeInteger(requestedG) ||
    requestedG < product.minOrderG ||
    requestedG % product.stepG !== 0
  ) {
    return { ok: false, reason: 'invalidQuantity' };
  }
  if (product.availableG !== null && requestedG > product.availableG) {
    return { ok: false, reason: 'insufficientStock' };
  }
  return { ok: true, requestedG };
}
