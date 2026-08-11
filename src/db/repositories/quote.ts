import 'server-only';

import { db, type Tx } from '@/db/client';
import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog, currentCatalogVersion, type CatalogItem } from '@/db/repositories/catalog';
import { zoneFeesByFsa } from '@/db/repositories/fulfilment';
import { demandByProduct } from '@/domain/availability';
import { isLegalQuantity, lineEst, sumCents } from '@/domain/pricing';
import { checkServiceability, deliveryFee, amountToFreeDelivery } from '@/domain/serviceability';
import { cents, grams, type Cents } from '@/domain/types';

/**
 * The basket, priced by the server.
 *
 * ⭐ THE CLIENT NEVER COMPUTES A TOTAL. It sends product IDs, weights and prep
 * choices; everything with a dollar sign on it comes back from here, recomputed
 * from the catalog. The identical arithmetic runs again inside the placement
 * transaction, and P8 compares the two — so this function is the quote, not the
 * decision.
 *
 * Availability is checked with demand AGGREGATED ACROSS LINES, not per line.
 * Cut preferences deliberately do not create separate products (FR-4), so "1 kg
 * curry cut + 1 kg biryani cut" is one product on two lines. Checking each line
 * against stock separately sees 1 ≤ 1.5 twice and accepts; against 1.5 kg of
 * stock that oversells, on an ordinary basket rather than a contrived one.
 */

export interface QuoteRequestLine {
  readonly productId: string;
  readonly requestedG: number;
  readonly prepOptionId: string | null;
}

export type LineProblem = 'productUnavailable' | 'invalidQuantity' | 'insufficientStock';

export interface QuotedLine {
  readonly productId: string;
  readonly slug: string;
  readonly name: string;
  readonly requestedG: number;
  readonly prepOptionId: string | null;
  readonly pricingMode: 'pack' | 'perKg';
  readonly isEstimate: boolean;
  readonly amountCents: Cents;
  readonly problem: LineProblem | null;
  /** Set only for `insufficientStock`, so the screen can show a real number. */
  readonly availableG: number | null;
}

export interface Quote {
  readonly lines: readonly QuotedLine[];
  readonly lineSubtotalCents: Cents;
  readonly deliveryFeeCents: Cents | null;
  readonly estTotalCents: Cents | null;
  readonly toFreeDeliveryCents: Cents | null;
  readonly catalogVersion: number;
  readonly hasHotLine: boolean;
  readonly hasEstimate: boolean;
  readonly serviceable: boolean | null;
  readonly businessDayId: string | null;
  readonly problems: readonly LineProblem[];
}

export async function quoteBasket(
  request: readonly QuoteRequestLine[],
  postalCode: string | null,
  tx: Tx | typeof db = db,
): Promise<Quote> {
  const day = await currentBusinessDay(tx);
  const [catalog, version] = await Promise.all([
    listCatalog(day?.id ?? null, {}, tx),
    currentCatalogVersion(tx),
  ]);

  const byId = new Map<string, CatalogItem>(catalog.map((c) => [c.id, c]));

  // Aggregated first, so the stock verdict for a product is the same on every
  // line that mentions it.
  const demand = demandByProduct(
    request
      .filter((l) => byId.has(l.productId))
      .map((l) => ({ productId: l.productId, requestedG: grams(l.requestedG) })),
  );

  const lines: QuotedLine[] = request.map((l) => {
    const item = byId.get(l.productId);

    if (item === undefined) {
      return {
        productId: l.productId,
        slug: '',
        name: 'No longer available',
        requestedG: l.requestedG,
        prepOptionId: l.prepOptionId,
        pricingMode: 'pack' as const,
        isEstimate: false,
        amountCents: cents(0),
        problem: 'productUnavailable' as const,
        availableG: null,
      };
    }

    const wanted = demand.get(l.productId) ?? grams(0);
    const available = item.availableG;

    const problem: LineProblem | null = !isLegalQuantity(item.pricing, grams(l.requestedG))
      ? 'invalidQuantity'
      : available === null || wanted > available
        ? 'insufficientStock'
        : null;

    return {
      productId: item.id,
      slug: item.slug,
      name: item.name,
      requestedG: l.requestedG,
      prepOptionId: l.prepOptionId,
      pricingMode: item.pricing.mode,
      // A per-kg line has no final amount until it is weighed, and saying so
      // on the line is the whole difference between this shop and one that
      // charges an estimate.
      isEstimate: item.pricing.mode === 'perKg',
      amountCents: lineEst(item.pricing, grams(l.requestedG)),
      problem,
      availableG: available,
    };
  });

  const priceable = lines.filter((l) => l.problem === null);
  const lineSubtotal = sumCents(priceable.map((l) => l.amountCents));

  let serviceable: boolean | null = null;
  let fee: Cents | null = null;
  let toFree: Cents | null = null;

  if (postalCode !== null && postalCode.trim() !== '') {
    const zones = await zoneFeesByFsa(tx);
    const check = checkServiceability(postalCode, zones);
    serviceable = check.ok;
    if (check.ok) {
      fee = deliveryFee(check.zone, lineSubtotal);
      toFree = amountToFreeDelivery(check.zone, lineSubtotal);
    }
  }

  const hotIds = new Set(catalog.filter((c) => c.handling === 'COOKED_HOT').map((c) => c.id));

  return {
    lines,
    lineSubtotalCents: lineSubtotal,
    deliveryFeeCents: fee,
    estTotalCents: fee === null ? null : cents(lineSubtotal + fee),
    toFreeDeliveryCents: toFree,
    catalogVersion: version,
    hasHotLine: lines.some((l) => hotIds.has(l.productId)),
    hasEstimate: priceable.some((l) => l.isEstimate),
    serviceable,
    businessDayId: day?.id ?? null,
    problems: [...new Set(lines.flatMap((l) => (l.problem === null ? [] : [l.problem])))],
  };
}
