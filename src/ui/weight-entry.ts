/**
 * Validate a customer-entered weight against the same shape the domain uses.
 *
 * This helper deliberately returns integer grams only. The browser control is
 * presentation; `isLegalQuantity` remains the server-side authority, and the
 * quote/placement paths still re-check the value before stock or money moves.
 */
export function weightFromEntry(raw: string, minG: number, stepG: number, maxG: number | null): number | null {
  if (!/^\d+$/.test(raw)) return null;

  const grams = Number(raw);
  if (!Number.isSafeInteger(grams) || grams < minG || grams % stepG !== 0) return null;
  if (maxG !== null && grams > maxG) return null;
  return grams;
}
