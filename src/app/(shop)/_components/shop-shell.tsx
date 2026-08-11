import Link from 'next/link';

import type { Handling } from '@/domain/types';
import { money, weight } from '@/ui/format';
import { shopName } from '@/ui/shop-config';

import { BasketCount } from './basket-count';

/**
 * The storefront's shared furniture.
 *
 * Density 3 out here, unlike the console's 6: this half of the app is read
 * once by someone deciding whether to trust the shop, not operated forty times
 * a day by someone who already has.
 */

export function ShopHeader() {
  return (
    <header className="border-b border-line">
      {/* Single line at desktop, height under 80px. */}
      <nav className="mx-auto flex h-16 max-w-[68rem] items-center justify-between gap-6 px-4">
        <Link href="/" className="text-lead font-semibold tracking-tight">
          {shopName()}
        </Link>
        <div className="flex items-center gap-5">
          <Link href="/shop" className="text-body">
            Shop
          </Link>
          <Link href="/delivery" className="hidden text-body sm:inline">
            Delivery
          </Link>
          <Link href="/basket" className="flex items-center gap-2 text-body">
            Basket
            <BasketCount />
          </Link>
        </div>
      </nav>
    </header>
  );
}

export function ShopFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-[68rem] gap-8 px-4 py-12 sm:grid-cols-3">
        <div>
          <p className="text-body font-semibold">{shopName()}</p>
          <p className="mt-2 max-w-[40ch] text-meta text-muted">
            Home delivery only, within our local radius. Everything is cut the day it goes out.
          </p>
        </div>
        <nav className="grid content-start gap-2 text-body">
          <Link href="/shop">Everything we sell</Link>
          <Link href="/delivery">Where we deliver</Link>
          <Link href="/how-weighing-works">How weighing and charging work</Link>
        </nav>
        <p className="text-meta text-muted">
          Prices in Canadian dollars. Per-kilogram items are cut to order, so the amount you see at
          checkout is an estimate until they are weighed.
        </p>
      </div>
    </footer>
  );
}

/**
 * A product's picture, or the absence of one.
 *
 * ⚠ There is no photography yet (DQ-16), and `04-PLAN` §9.8 is explicit about
 * what to do meanwhile: a designed typographic tile, NOT stock photography.
 * Stock meat photos on a single-location butcher's site are provably not that
 * shop's product, on a page whose entire job is to be trusted about weight and
 * freshness. A missing photo costs less than a borrowed one.
 *
 * The aspect ratio is fixed here rather than left to the image, so the grid
 * cannot be broken later by a badly cropped upload, and so swapping in real
 * photography changes no layout.
 */
export function ProductTile({
  name,
  handling,
  ratio = 'square',
}: {
  name: string;
  handling: Handling;
  ratio?: 'square' | 'wide';
}) {
  return (
    <div
      className={`flex items-end rounded-md border border-line bg-raised p-4 ${
        ratio === 'square' ? 'aspect-square' : 'aspect-[4/3]'
      }`}
    >
      <div>
        <p className="text-meta text-muted">{handlingLabel(handling)}</p>
        <p className="mt-1 text-section font-semibold tracking-tight">{name}</p>
      </div>
    </div>
  );
}

export function handlingLabel(h: Handling): string {
  switch (h) {
    case 'RAW':
      return 'Raw';
    case 'MARINATED':
      return 'Marinated';
    case 'COOKED_CHILLED':
      return 'Cooked, chilled';
    case 'COOKED_HOT':
      return 'Cooked to order, hot';
  }
}

/**
 * The price line for a catalog item.
 *
 * A per-kg item shows a rate, never a total, because it has no total until it
 * is weighed. Saying "$18.40" next to something sold by weight is the single
 * most common way this kind of shop misleads people by accident.
 */
export function PriceLine({
  pricing,
}: {
  pricing:
    | { mode: 'pack'; price: number; wMin: number; wMax: number }
    | { mode: 'perKg'; ratePerKg: number; minOrder: number; step: number };
}) {
  if (pricing.mode === 'pack') {
    return (
      <p className="tnum text-body">
        {money(pricing.price)}{' '}
        <span className="text-muted">
          for {weight(pricing.wMin)} to {weight(pricing.wMax)}
        </span>
      </p>
    );
  }
  return (
    <p className="tnum text-body">
      {money(pricing.ratePerKg)}
      <span className="text-muted">/kg, cut to order</span>
    </p>
  );
}
