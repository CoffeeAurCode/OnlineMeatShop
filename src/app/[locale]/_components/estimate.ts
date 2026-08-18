/**
 * The one client-side estimate, and the one place it is allowed to exist.
 *
 * ⚠ DISPLAY ONLY, AND IT NEVER LEAVES THE COMPONENT THAT RENDERS IT.
 *
 * The rule everywhere else in this application is that the client never
 * computes a price. This looks like a violation and is not, because of what
 * happens to the number: it is rendered on a button and then discarded. The
 * basket stores INTENT — a product, a weight, a cut — and `/api/quote` prices
 * it from the catalog the moment the sheet closes, so every amount the
 * customer sees anywhere that matters came from the server.
 *
 * What it buys is that the estimate tracks the stepper. A round trip per tap
 * on a phone with one bar of signal is a number that lags behind the thumb
 * moving it, which reads as the shop being unsure what it charges.
 *
 * ⚠ IT EXISTS AS A FUNCTION BECAUSE IT WAS WRITTEN TWICE. The item sheet and
 * the product page both showed an amount on their add button and each did its
 * own arithmetic. Two implementations of a price are two answers, and the one
 * the customer sees is the one that would be wrong.
 *
 * ⚠ `Math.ceil` MATCHES `lineEst`, WHICH ROUNDS UP. Rounding differently here
 * would show an estimate a cent under the one that appears in the basket two
 * seconds later, which reads as the shop quietly adding a cent.
 */
export function displayEstimateCents(
  pricingMode: 'pack' | 'perKg',
  /** perKg: the rate per kilogram. pack: the fixed price of one pack. */
  unitPriceCents: number,
  grams: number,
  packQty: number,
): number {
  return pricingMode === 'perKg'
    ? Math.ceil((unitPriceCents * grams) / 1000)
    : unitPriceCents * packQty;
}
