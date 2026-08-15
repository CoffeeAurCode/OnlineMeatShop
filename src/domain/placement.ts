/**
 * `PlaceOrder` — the eight preconditions, as pure predicates.
 *
 * PURE. No I/O, no clock, no database. `now` is a parameter. This file decides
 * whether an order may be accepted and what it costs; `db/repositories/
 * placement.ts` is responsible for locking the rows, calling this once, and
 * writing the result. Nothing here can read a row, and nothing there decides a
 * rule.
 *
 * That split is the reason this is testable. Every failure path below is
 * reachable from a plain object, with no database, in microseconds — which is
 * what makes it affordable to have a test for each of them.
 *
 * Spec §5.3 (P1–P7) and DTM §7.3 (P8).
 */

import { available, demandByProduct } from './availability';
import { isLegalQuantity, lineEst, sumCents } from './pricing';
import {
  deliveryFee,
  resolveDestinationZone,
  type GeoPoint,
  type GeoZone,
  type ZoneFee,
} from './serviceability';
import { evaluateSlot, type SlotView } from './slots';
import { cents, grams, type Cents, type Grams, type Handling, type PlacementFailure, type Pricing } from './types';

// ── Inputs ───────────────────────────────────────────────────────────────

/** A product as read INSIDE the placement transaction — never passed in. */
export interface ProductView {
  readonly id: string;
  readonly name: string;
  readonly handling: Handling;
  readonly pricing: Pricing;
  readonly taxCode: string;
  readonly active: boolean;
}

export interface StockView {
  readonly stockedG: Grams;
  readonly reservedG: Grams;
}

export interface RequestedLine {
  readonly productId: string;
  readonly prepOptionId: string | null;
  /** Grams for a per-kg line; ignored for a pack line, which sells by unit. */
  readonly requestedG: Grams;
}

/**
 * What the customer authorised, from the `checkout_attempt` row.
 *
 * `null` for a placement with no payment stage (an admin-entered order, or a
 * COD flow if DQ-5 turns out to want one), in which case P8 does not apply —
 * there is no earlier quote to have gone stale.
 */
export interface AuthorisedQuote {
  readonly quotedEstCents: Cents;
  readonly quoteVersion: number;
  readonly authorisedCeilingCents: Cents;
}

export interface PlacementInput {
  /**
   * ⚠ NULLABLE SINCE COORDINATES BECAME AN ADDRESS. An order located by GPS
   * has no postal code to check, and inventing one to satisfy the old shape
   * would put a fictional postal code on a real order row.
   */
  readonly postalCode: string | null;
  /**
   * Where the customer's device says they are. Takes precedence over the
   * postal code when both are present — see `resolveDestinationZone`.
   */
  readonly point: GeoPoint | null;
  readonly lines: readonly RequestedLine[];
  readonly nowMs: number;
  readonly catalogVersion: number;
  readonly quote: AuthorisedQuote | null;
}

export interface PlacementContext {
  /** `null` when the slot ID did not resolve to a row. */
  readonly slot: SlotView | null;
  readonly zones: ReadonlyMap<string, ZoneFee>;
  /** Zones expressed as circles. Empty until the shop declares one. */
  readonly geoZones: readonly GeoZone[];
  readonly products: ReadonlyMap<string, ProductView>;
  readonly stock: ReadonlyMap<string, StockView>;
}

// ── Outputs ──────────────────────────────────────────────────────────────

/** A line, priced. The snapshot that goes onto `order_line`. */
export interface PricedLine {
  readonly productId: string;
  readonly prepOptionId: string | null;
  readonly productName: string;
  readonly handling: Handling;
  readonly pricing: Pricing;
  readonly taxCode: string;
  readonly requestedG: Grams;
  readonly estAmountCents: Cents;
}

export interface PlacementAccepted {
  readonly ok: true;
  readonly lines: readonly PricedLine[];
  readonly estLineTotalCents: Cents;
  readonly deliveryFeeCents: Cents;
  readonly estTotalCents: Cents;
  readonly demandByProduct: ReadonlyMap<string, Grams>;
  readonly hasHotLine: boolean;
  readonly zoneId: string;
}

export interface PlacementRejected {
  readonly ok: false;
  readonly reason: PlacementFailure;
  /**
   * Enough for the frontend to say something specific — the product's name,
   * the quantity actually left. Never a raw database error, and never a
   * customer-facing sentence: the copy belongs to the frontend, the facts
   * belong here.
   */
  //
  // `| undefined` rather than only `?`. tsconfig sets
  // `exactOptionalPropertyTypes`, under which "absent" and "present but
  // undefined" are different types — and a product whose name we could not
  // resolve genuinely is the second one.
  readonly detail?: {
    readonly productId?: string | undefined;
    readonly productName?: string | undefined;
    readonly availableG?: number | undefined;
    readonly minOrderG?: number | undefined;
    readonly stepG?: number | undefined;
    readonly recomputedEstCents?: number | undefined;
  };
}

export type PlacementDecision = PlacementAccepted | PlacementRejected;

// ── The decision ─────────────────────────────────────────────────────────

/**
 * All eight preconditions, evaluated together, all-or-nothing.
 *
 * ORDER MATTERS, and not only for the error message. The cheap, whole-basket
 * refusals come first (is this address even served? is the slot open?) so a
 * customer outside the delivery area is told that rather than being told the
 * chicken is sold out. Within the per-line checks the order follows the spec's
 * numbering, which is also least-surprising: a deactivated product is reported
 * before an illegal quantity of it.
 *
 * P6 is deliberately LAST of the line checks, because it is the only one that
 * needs the aggregate rather than the line.
 */
export function evaluatePlacement(
  input: PlacementInput,
  context: PlacementContext,
): PlacementDecision {
  // ── P1 — serviceable address ──────────────────────────────────────────
  //
  // A coordinate or a postal code, whichever the customer gave us. The choice
  // between them, including which wins when both are present, is made once in
  // `resolveDestinationZone` rather than branched here.
  const serviceability = resolveDestinationZone(
    { point: input.point, postalCode: input.postalCode },
    { byFsa: context.zones, geo: context.geoZones },
  );
  if (!serviceability.ok) return { ok: false, reason: 'outsideDeliveryArea' };
  const zone = serviceability.zone;

  // An empty basket is not a placement failure code in the spec, because the
  // spec does not model it. It cannot be accepted either — reserving nothing
  // and booking a slot would consume capacity for no order.
  if (input.lines.length === 0) {
    return { ok: false, reason: 'invalidQuantity' };
  }

  // ── P4 — every product exists and is active ───────────────────────────
  //
  // Before the slot checks, because "the chicken is gone" is more useful than
  // "that slot is full" when both are true and the basket cannot be placed at
  // any slot.
  const priced: PricedLine[] = [];
  for (const line of input.lines) {
    const p = context.products.get(line.productId);
    if (!p || !p.active) {
      return {
        ok: false,
        reason: 'productUnavailable',
        detail: { productId: line.productId, productName: p?.name },
      };
    }

    // ── P5 — the quantity is one the butcher can actually cut ───────────
    if (!isLegalQuantity(p.pricing, line.requestedG)) {
      return {
        ok: false,
        reason: 'invalidQuantity',
        detail: {
          productId: p.id,
          productName: p.name,
          minOrderG: p.pricing.mode === 'perKg' ? p.pricing.minOrder : undefined,
          stepG: p.pricing.mode === 'perKg' ? p.pricing.step : undefined,
        },
      };
    }

    priced.push({
      productId: p.id,
      prepOptionId: line.prepOptionId,
      productName: p.name,
      handling: p.handling,
      pricing: p.pricing,
      taxCode: p.taxCode,
      requestedG: line.requestedG,
      estAmountCents: lineEst(p.pricing, line.requestedG),
    });
  }

  const hasHotLine = priced.some((l) => l.handling === 'COOKED_HOT');

  // ── P2, P3, P7 — the slot ─────────────────────────────────────────────
  //
  // `hasHotLine` is needed for P7, which is why the slot is evaluated after
  // the lines rather than first.
  if (context.slot === null) return { ok: false, reason: 'slotCutoffPassed' };
  const slotDecision = evaluateSlot(context.slot, hasHotLine, input.nowMs);
  if (!slotDecision.ok) return { ok: false, reason: slotDecision.reason };

  // ── P6 — enough unreserved stock, AGGREGATED ACROSS LINES ─────────────
  //
  // The aggregation is the whole point. Per-line checking accepts
  // "1kg + 1kg" against 1.5kg of stock, and this is the ordinary basket
  // rather than a contrived one — prep options do not create separate
  // products. See `demandByProduct`.
  const demand = demandByProduct(
    priced.map((l) => ({ productId: l.productId, requestedG: l.requestedG })),
  );

  for (const [productId, wanted] of demand) {
    // A pack product's stock is counted in grams too, using its declared
    // maximum weight, so the two modes share one stock table. A pack line with
    // no stock row is unstocked today.
    const s = context.stock.get(productId);
    const have = s ? available(s.stockedG, s.reservedG) : grams(0);
    if (wanted > have) {
      return {
        ok: false,
        reason: 'insufficientStock',
        detail: {
          productId,
          productName: context.products.get(productId)?.name,
          availableG: have,
        },
      };
    }
  }

  // ── Totals ────────────────────────────────────────────────────────────
  const estLineTotal = sumCents(priced.map((l) => l.estAmountCents));
  const fee = deliveryFee(zone, estLineTotal);
  const estTotal = cents(estLineTotal + fee);

  // ── P8 — the quote the customer authorised is still the right one ─────
  //
  // The precondition the formal spec does not have, because the spec models
  // placement as instantaneous. Real checkout spans a Stripe round trip, and
  // an admin can reprice or deactivate a product inside that window.
  //
  // Both halves are needed. The version catches a change that happens to leave
  // the total identical (two products repriced in opposite directions); the
  // total catches a change the version missed. Cheap, and this is not the
  // place to be clever about which one is redundant.
  if (input.quote !== null) {
    if (
      input.quote.quoteVersion !== input.catalogVersion ||
      input.quote.quotedEstCents !== estTotal ||
      estTotal > input.quote.authorisedCeilingCents
    ) {
      return {
        ok: false,
        reason: 'priceChanged',
        detail: { recomputedEstCents: estTotal },
      };
    }
  }

  return {
    ok: true,
    lines: priced,
    estLineTotalCents: estLineTotal,
    deliveryFeeCents: fee,
    estTotalCents: estTotal,
    demandByProduct: demand,
    hasHotLine,
    zoneId: zone.zoneId,
  };
}

// ── The cart hash ────────────────────────────────────────────────────────

/**
 * A stable fingerprint of what is being bought, for the checkout attempt's
 * unique index.
 *
 * A CHANGED CART MUST BE A NEW ATTEMPT. If the hash ignored a field, editing
 * that field would reuse the existing hold — and the customer would be
 * authorised for one basket and charged for another.
 *
 * Lines are sorted before hashing so that reordering the basket is not a new
 * cart. Quantity and prep option ARE part of the identity; the prep option
 * because it changes what is physically produced even though it does not
 * change the price.
 *
 * This returns the canonical STRING, not a digest — hashing needs a crypto
 * primitive, which is I/O-adjacent and belongs outside the domain. The caller
 * digests it. Keeping the canonicalisation here is what makes it testable.
 */
export function cartFingerprint(input: {
  readonly postalCode: string | null;
  readonly point: GeoPoint | null;
  readonly slotId: string;
  readonly payMode: string;
  readonly lines: readonly RequestedLine[];
}): string {
  const lines = [...input.lines]
    .map((l) => `${l.productId}:${l.prepOptionId ?? '-'}:${l.requestedG}`)
    .sort();
  /*
   * ⚠ THE DESTINATION IS PART OF THE FINGERPRINT, so moving the pin has to
   * change it. Coordinates are rounded to five decimals, about a metre: finer
   * than that and GPS jitter alone would invalidate the attempt while the
   * customer sat still, which is a re-authorisation for no reason.
   */
  const destination =
    input.point !== null
      ? `at=${input.point.lat.toFixed(5)},${input.point.lng.toFixed(5)}`
      : `postal=${(input.postalCode ?? '').replace(/\s+/g, '').toUpperCase()}`;

  return [
    destination,
    `slot=${input.slotId}`,
    `pay=${input.payMode}`,
    `lines=${lines.join(',')}`,
  ].join('|');
}
