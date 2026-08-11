import type { Metadata } from 'next';

import { BasketView } from '../_components/basket-view';

/**
 * The basket.
 *
 * A client component, and this is the one place on the storefront where that
 * is right: the basket is per-customer, is not indexable, and lives in the
 * browser's storage. Everything a crawler needs is on the catalog pages, which
 * are server rendered.
 */
export const metadata: Metadata = {
  title: 'Your basket',
  robots: { index: false, follow: true },
};

export default function BasketPage() {
  return (
    <main className="mx-auto max-w-[46rem] px-4 py-12">
      <h1 className="text-display font-semibold tracking-tight">Your basket</h1>
      <BasketView />
    </main>
  );
}
