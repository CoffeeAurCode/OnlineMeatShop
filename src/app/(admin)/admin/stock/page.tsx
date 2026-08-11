import { redirect } from 'next/navigation';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog } from '@/db/repositories/catalog';

import { Screen } from '../_components/shell';
import { StockForm } from '../_components/stock-form';

/**
 * Correct today's quantities.
 *
 * Distinct from opening the day, and deliberately so: this writes `stocked_g`
 * and never touches `reserved_g`, because resetting reservations would unfund
 * every order already placed against them, invisibly and all at once.
 *
 * Fields are pre-filled here, unlike the open-the-day screen, because the
 * owner is correcting a number they already entered rather than answering a
 * physical question for the first time.
 */
export default async function StockPage() {
  const day = await currentBusinessDay();
  if (day === null) redirect('/admin/open');

  const items = await listCatalog(day.id, { includeInactive: true });

  return (
    <Screen title="Stock" back={{ href: '/admin', label: 'Today' }}>
      <p className="mt-2 max-w-[65ch] text-body text-muted">
        What is left on the counter, in kilograms. Quantities already promised to orders are shown
        underneath, and you cannot go below them.
      </p>
      <StockForm
        lines={items.map((i) => ({
          productId: i.id,
          name: i.active ? i.name : `${i.name} (not on sale)`,
          stockedG: i.stockedG,
          reservedG: i.stockedG === null ? null : (i.stockedG ?? 0) - (i.availableG ?? 0),
        }))}
        endpoint="/api/admin/stock"
        submitLabel="Save stock"
      />
    </Screen>
  );
}
