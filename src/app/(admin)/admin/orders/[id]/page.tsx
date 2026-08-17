import Link from 'next/link';
import { notFound } from 'next/navigation';

import { assignmentOf, orderForWeighing, orderRef } from '@/db/repositories/orders';
import { lastAssignedPartnerId, listPartners } from '@/db/repositories/partners';
import { ADMIN_LOCALE, money, weight } from '@/ui/format';

import { Screen } from '../../_components/shell';
import { AdvanceButton } from '../../_components/advance-button';
import { DispatchPanel } from '../../_components/dispatch-panel';

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

  /*
   * Fetched in parallel with each other but AFTER the order, because two of
   * the three are pointless if it does not exist. At 2-6 orders a day the
   * round trips are free; the readability is not.
   */
  const [assignment, partners, suggestedPartnerId] = await Promise.all([
    assignmentOf(order.id),
    listPartners(true),
    lastAssignedPartnerId(),
  ]);

  const unweighed = order.lines.filter((l) => l.pricingMode === 'perKg' && l.actWeightG === null);
  const linesTotal = order.lines.reduce(
    (sum, l) => sum + (l.actAmountCents ?? l.estAmountCents),
    0,
  );

  return (
    <Screen title={orderRef(order)} back={{ href: '/admin/orders', label: 'Orders' }}>
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
                  {money(line.actAmountCents ?? line.estAmountCents, ADMIN_LOCALE)}
                  {done || !weighable ? '' : ' est.'}
                </span>
              </div>

              <p className="mt-1 text-meta text-muted">
                {weighable ? 'Ordered ' : ''}
                {weight(line.requestedG, ADMIN_LOCALE)}
                {done ? `, weighed ${weight(line.actWeightG ?? 0, ADMIN_LOCALE)}` : ''}
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
        <span className="tnum text-body">{money(order.deliveryFeeCents, ADMIN_LOCALE)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-4 py-3">
        <span className="text-lead font-semibold">
          {order.finalTotalCents === null ? 'Estimated total' : 'Final total'}
        </span>
        <span className="tnum text-lead font-semibold">
          {money(order.finalTotalCents ?? linesTotal + order.deliveryFeeCents, ADMIN_LOCALE)}
        </span>
      </div>

      {/*
        ⭐ HOW THIS ORDER GETS PAID, said plainly, because the two cases are
        packed identically and handed over differently.

        ⚠ On a cash order the amount shown is the FINAL total, never the
        estimate — that is the figure the driver collects, and showing an
        estimate here would put a number in somebody's head that the scale is
        about to change.
      */}
      <div className="mt-6 rounded-md border border-line bg-raised px-4 py-3">
        <p className="text-body font-semibold">
          {order.payMode === 'COD' ? 'Cash on delivery' : 'Paid online'}
        </p>
        <p className="mt-1 text-meta text-muted">
          {order.payMode === 'COD'
            ? order.finalTotalCents === null
              ? 'The driver collects the final amount once this order is weighed.'
              : `The driver collects ${money(order.finalTotalCents, ADMIN_LOCALE)} at the door.`
            : 'Held on the card at checkout, charged exactly once weighed.'}
        </p>

        {order.cashCollectedCents !== null && (
          <p
            className={
              order.cashCollectedCents === order.finalTotalCents
                ? 'mt-2 text-meta text-muted'
                : 'mt-2 rounded-sm bg-danger-wash px-2 py-1 text-meta font-semibold text-danger'
            }
          >
            Driver reported {money(order.cashCollectedCents, ADMIN_LOCALE)} collected
            {order.cashCollectedCents === order.finalTotalCents
              ? '.'
              : `, but ${money(order.finalTotalCents ?? 0, ADMIN_LOCALE)} was due. This order was deliberately left open.`}
          </p>
        )}
      </div>

      {unweighed.length > 0 ? (
        <p className="mt-4 text-body text-muted">
          {unweighed.length} {unweighed.length === 1 ? 'item' : 'items'} still to weigh before this
          order can be charged.
        </p>
      ) : null}

      {assignment !== null && (
        <DispatchPanel
          orderId={order.id}
          status={order.status}
          assignment={assignment}
          partners={partners}
          suggestedPartnerId={suggestedPartnerId}
        />
      )}

      {/*
        ⚠ THE ADVANCE BUTTON IS LAST, AND THE DRIVER PANEL IS ABOVE IT, because
        the server refuses to move an order to OUT with nobody assigned
        (`notAssigned`). Putting the assignment above the button that needs it
        means the owner meets the requirement before they meet the refusal.
      */}
      <AdvanceButton orderId={order.id} status={order.status} readyToFinalise={unweighed.length === 0} />
    </Screen>
  );
}
