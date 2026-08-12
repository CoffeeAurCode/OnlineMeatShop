import Link from 'next/link';
import type { Metadata } from 'next';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog } from '@/db/repositories/catalog';
import { weight } from '@/ui/format';
import type { Handling } from '@/domain/types';

import { PriceLine, ProductTile, handlingLabel } from '../_components/shop-shell';

/**
 * Everything the shop sells, grouped by how it is handled.
 *
 * Handling is the right grouping because it is what changes the customer's
 * experience: a hot cooked item constrains the delivery slot for the whole
 * order, and raw versus marinated is the actual decision being made at the
 * counter. Grouping by species would look tidier and tell the customer less.
 */
export const metadata: Metadata = {
  title: 'Everything we sell',
  description:
    'Raw cuts, marinated meat, cooked and packed, and hot cooked-to-order food. Availability is per trading day.',
};

export const revalidate = 60;

const ORDER: readonly Handling[] = ['RAW', 'MARINATED', 'COOKED_CHILLED', 'COOKED_HOT'];

export default async function ShopPage() {
  const day = await currentBusinessDay();
  const catalog = await listCatalog(day?.id ?? null);

  return (
    <main className="mx-auto max-w-[68rem] px-4 py-12">
      <h1 className="text-display font-semibold tracking-tight">Everything we sell</h1>
      <p className="mt-3 max-w-[60ch] text-lead text-muted">
        Stock is declared fresh each trading day. Anything without a quantity today has not been put
        out.
      </p>

      {catalog.length === 0 ? (
        <p className="mt-12 rounded-md border border-line bg-raised px-4 py-8 text-body text-muted">
          There is nothing in the catalog yet.
        </p>
      ) : null}

      {ORDER.filter((h) => catalog.some((c) => c.handling === h)).map((handling) => (
        <section key={handling} id={handling.toLowerCase()} className="mt-14 scroll-mt-20">
          <h2 className="text-section font-semibold tracking-tight">{handlingLabel(handling)}</h2>
          {handling === 'COOKED_HOT' ? (
            <p className="mt-2 max-w-[60ch] text-body text-muted">
              Anything from here limits your order to a delivery slot we can get it to you hot in.
            </p>
          ) : null}

          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {catalog
              .filter((c) => c.handling === handling)
              .map((item) => {
                const soldOut = item.availableG !== null && item.availableG === 0;
                const notToday = item.availableG === null;
                return (
                  <li key={item.id}>
                    <Link href={`/p/${item.slug}`} className="block">
                      <ProductTile name={item.name} handling={item.handling} />
                      <div className="mt-3">
                        <p className="text-body font-semibold">{item.name}</p>
                        <div className="mt-1">
                          <PriceLine pricing={item.pricing} />
                        </div>
                        <p className="mt-1 text-meta text-muted">
                          {notToday
                            ? 'Not out today'
                            : soldOut
                              ? 'Gone for today'
                              : `${weight(item.availableG ?? 0)} left today`}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </main>
  );
}
