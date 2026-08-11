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
    <header className="storefront-header sticky top-0 z-40 border-b border-line">
      <nav className="mx-auto flex h-[4.5rem] max-w-[76rem] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="group flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-sm bg-accent-solid text-meta font-semibold text-accent-solid-ink transition-transform group-hover:-rotate-3"
          >
            {shopName().trim().charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 max-w-[8.5rem] sm:max-w-none">
            <span className="block truncate text-body font-semibold tracking-tight">{shopName()}</span>
            <span className="hidden text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted sm:block">
              Local butcher delivery
            </span>
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-2 sm:gap-5">
          <Link href="/shop" className="tap inline-flex items-center text-body font-semibold sm:font-normal">
            Shop
          </Link>
          <Link href="/delivery" className="tap hidden items-center text-body sm:inline-flex">
            Delivery
          </Link>
          <Link
            href="/basket"
            className="tap inline-flex items-center gap-2 rounded-sm border border-line bg-raised px-3 text-body font-semibold transition-colors hover:border-accent"
          >
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
    <footer className="mt-24 bg-accent-solid text-accent-solid-ink">
      <div className="mx-auto max-w-[76rem] px-4 py-14 sm:px-6 sm:py-20">
        <div className="grid gap-12 border-b border-white/25 pb-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="max-w-[13ch] text-[clamp(2rem,5vw,4.5rem)] font-semibold leading-[0.95] tracking-[-0.05em]">
              Cut here. Delivered nearby.
            </p>
            <p className="mt-5 max-w-[46ch] text-body text-white/75">
              Home delivery only, within our local radius. Everything is cut the day it goes out.
            </p>
          </div>
          <nav className="grid content-start gap-4 text-body lg:justify-self-end">
            <Link className="underline-offset-4 hover:underline" href="/shop">Everything we sell</Link>
            <Link className="underline-offset-4 hover:underline" href="/delivery">Where we deliver</Link>
            <Link className="underline-offset-4 hover:underline" href="/how-weighing-works">
              How weighing and payment work
            </Link>
          </nav>
        </div>
        <div className="grid gap-4 pt-6 text-meta text-white/65 sm:grid-cols-2">
          <p className="font-semibold text-white">{shopName()}</p>
          <p className="sm:text-right">
            Prices in Canadian dollars. Per-kilogram prices stay estimated until your order is cut and weighed.
          </p>
        </div>
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
      className={`product-tile flex items-end rounded-md border border-line bg-raised p-5 transition-[transform,border-color] duration-300 hover:-translate-y-1 hover:border-accent ${
        ratio === 'square' ? 'aspect-square' : 'aspect-[4/3]'
      }`}
    >
      <span aria-hidden="true" className="product-mark">
        {name.trim().charAt(0).toUpperCase()}
      </span>
      <div>
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted">
          {handlingLabel(handling)}
        </p>
        <p className="mt-2 max-w-[14ch] text-section font-semibold leading-tight tracking-tight">{name}</p>
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
