import Link from 'next/link';
import { redirect } from 'next/navigation';

import { currentBusinessDay } from '@/db/repositories/availability';
import { orderQueue } from '@/db/repositories/orders';
import { shopTimeZone, slotWindow } from '@/ui/business-date';
import { money, weight } from '@/ui/format';

import { Empty, Screen } from '../_components/shell';
import { RefreshButton } from '../_components/refresh-button';

/**
 * The day's orders, grouped by delivery slot.
 *
 * Grouped by slot rather than by time of placement because the slot is what
 * the owner actually works to: everything in the 14:00 window is cut together,
 * bagged together and handed to one driver.
 *
 * There is no live board. It was cut at launch, and at two to six orders a day
 * an explicit refresh is honest about when the numbers were read. A live board
 * that silently reconnects is a board that can show a stale number while
 * looking current, which is the failure this console exists to avoid.
 */
export default async function OrdersPage() {
  const day = await currentBusinessDay();
  if (day === null) redirect('/admin/open');

  const queue = await orderQueue(day.id);
  const tz = shopTimeZone();

  return (
    <Screen title="Orders" back={{ href: '/admin', label: 'Today' }}>
      <div className="mt-2 flex items-center justify-between gap-4">
        <p className="text-body text-muted">Read just now. Nothing here updates on its own.</p>
        <RefreshButton />
      </div>

      {queue.length === 0 ? (
        <Empty
          title="No orders yet"
          body="Orders appear here as customers place them, grouped by the delivery slot they chose."
        />
      ) : null}

      {queue.map((slot) => (
        <section key={slot.id} className="mt-8">
          <h2 className="flex items-baseline gap-3 text-section font-semibold tracking-tight">
            <span className="tnum">{slotWindow(tz, slot.startsAt, slot.endsAt)}</span>
            {slot.hotEligible ? (
              <span className="rounded-sm bg-hot-wash px-2 py-0.5 text-meta font-semibold text-hot">
                Hot food
              </span>
            ) : null}
          </h2>

          <ul className="mt-2">
            {slot.orders.map((order) => {
              const unweighed = order.lines.filter(
                (l) => l.pricingMode === 'perKg' && l.actWeightG === null,
              ).length;
              return (
                <li key={order.id} className="border-b border-line">
                  <Link href={`/admin/orders/${order.id}`} className="block py-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-lead font-semibold">{order.postalCode}</span>
                      <span className="tnum text-lead">
                        {order.finalTotalCents === null
                          ? `${money(order.estTotalCents)} est.`
                          : money(order.finalTotalCents)}
                      </span>
                    </div>
                    <p className="mt-1 text-meta text-muted">
                      {order.status.toLowerCase()}
                      {order.hasHotLine ? ' · hot food' : ''}
                      {unweighed > 0 ? `, ${unweighed} to weigh` : ''}
                    </p>
                    <p className="mt-1 text-meta text-muted">
                      {order.lines
                        .map((l) => `${l.productName} ${weight(l.requestedG)}`)
                        .join(', ')}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Screen>
  );
}
