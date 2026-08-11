import Link from 'next/link';
import { notFound } from 'next/navigation';

import { orderForWeighing } from '@/db/repositories/orders';
import { money, weight } from '@/ui/format';

import { Screen } from '../../_components/shell';
import { AdvanceButton } from '../../_components/advance-button';

/**
 * One order.
 *
 * The list is the task list: every per-kg line that still has no weight is a
 * job, and tapping it opens the screen that does that one job. Weighing is not
 * done inline here because doing four weighings on one scrolling screen means
 * the confirm button moves between taps, and it moves while a hand that is
 * holding meat is already travelling toward where it used to be.
 */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await orderForWeighing(id);
  if (order === null) notFound();

  const unweighed = order.lines.filter((l) => l.pricingMode === 'perKg' && l.actWeightG === null);
  const linesTotal = order.lines.reduce(
    (sum, l) => sum + (l.actAmountCents ?? l.estAmountCents),
    0,
  );

  return (
    <Screen title={order.postalCode} back={{ href: '/admin/orders', label: 'Orders' }}>
      <p className="mt-1 text-body text-muted">
        {order.status.toLowerCase()}
        {order.hasHotLine ? ' · hot food' : ''}
      </p>

      <ul className="mt-6">
        {order.lines.map((line) => {
          const done = line.actWeightG !== null;
          const weighable = line.pricingMode === 'perKg';
          return (
            <li key={line.id} className="border-b border-line py-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-body font-semibold">{line.productName}</span>
                <span className="tnum text-body">
                  {money(line.actAmountCents ?? line.estAmountCents)}
                  {done || !weighable ? '' : ' est.'}
                </span>
              </div>

              <p className="mt-1 text-meta text-muted">
                {weighable ? 'Ordered ' : ''}
                {weight(line.requestedG)}
                {done ? `, weighed ${weight(line.actWeightG ?? 0)}` : ''}
                {line.varianceApproved ? ', variance approved' : ''}
              </p>

              {weighable && !done ? (
                <Link
                  href={`/admin/orders/${order.id}/weigh/${line.id}`}
                  className="tap mt-2 inline-flex items-center rounded-sm border border-line bg-raised px-4 text-body font-semibold"
                >
                  Weigh this
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex items-baseline justify-between gap-4 border-b border-line py-3">
        <span className="text-body">Delivery</span>
        <span className="tnum text-body">{money(order.deliveryFeeCents)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-4 py-3">
        <span className="text-lead font-semibold">
          {order.finalTotalCents === null ? 'Estimated total' : 'Final total'}
        </span>
        <span className="tnum text-lead font-semibold">
          {money(order.finalTotalCents ?? linesTotal + order.deliveryFeeCents)}
        </span>
      </div>

      {unweighed.length > 0 ? (
        <p className="mt-4 text-body text-muted">
          {unweighed.length} {unweighed.length === 1 ? 'item' : 'items'} still to weigh before this
          order can be charged.
        </p>
      ) : null}

      <AdvanceButton orderId={order.id} status={order.status} readyToFinalise={unweighed.length === 0} />
    </Screen>
  );
}
