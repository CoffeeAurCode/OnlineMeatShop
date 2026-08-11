import { redirect } from 'next/navigation';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog } from '@/db/repositories/catalog';
import { businessDateIn, shopTimeZone } from '@/ui/business-date';

import { Screen } from '../_components/shell';
import { StockForm } from '../_components/stock-form';

/**
 * Open the day.
 *
 * Nothing rolls over, and that is the point rather than a limitation: the
 * quantities are a physical question the owner answers by looking at the
 * counter, and a system that pre-filled yesterday's numbers would be inviting
 * them to confirm a guess.
 *
 * Every field therefore starts empty, and a field left empty stays undeclared
 * rather than becoming zero.
 */
export default async function OpenDayPage() {
  const day = await currentBusinessDay();
  if (day !== null) redirect('/admin/stock');

  const items = await listCatalog(null);
  const today = businessDateIn(shopTimeZone(), new Date());

  return (
    <Screen title={`Open ${today}`} back={{ href: '/admin', label: 'Today' }}>
      <p className="mt-2 max-w-[65ch] text-body text-muted">
        Enter what is on the counter, in kilograms. Leave a product blank to keep it off the shop
        today. Nothing carries over from yesterday.
      </p>
      <StockForm
        lines={items.map((i) => ({
          productId: i.id,
          name: i.name,
          stockedG: null,
          reservedG: null,
        }))}
        endpoint="/api/admin/day"
        submitLabel="Open the day"
        businessDate={today}
      />
    </Screen>
  );
}
