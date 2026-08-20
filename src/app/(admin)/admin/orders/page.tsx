import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  CaretRightIcon,
  CheckCircleIcon,
  FlameIcon,
  ReceiptIcon,
  ScalesIcon,
  TruckIcon,
} from '@phosphor-icons/react/dist/ssr';

import { currentBusinessDay } from '@/db/repositories/availability';
import { orderQueue, orderRef } from '@/db/repositories/orders';
import { shopTimeZone, slotClock } from '@/ui/business-date';
import { ADMIN_LOCALE, money, weight } from '@/ui/format';

import { Chip, Empty, Panel, Screen, StatTile } from '../_components/shell';

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
 *
 * ⚠ REBUILT AS A CARD BOARD 2026-08-19, AND THE GROUPING DID NOT CHANGE. What
 * changed is that a window is now a panel rather than a heading, and an order
 * is a card rather than a row — so on a laptop three windows sit side by side
 * and the owner reads the whole day without scrolling, and on a phone the
 * cards stack into exactly the list this screen was before.
 */
export default async function OrdersPage() {
  const day = await currentBusinessDay();
  if (day === null) redirect('/admin/open');

  const queue = await orderQueue(day.id);
  const tz = shopTimeZone();

  const orders = queue.flatMap((s) => s.orders).filter((o) => o.status !== 'CANCELLED');
  const unweighedIn = (o: (typeof orders)[number]) =>
    o.lines.filter((l) => l.pricingMode === 'perKg' && l.actWeightG === null).length;
  const toWeigh = orders.filter((o) => unweighedIn(o) > 0);

  return (
    <Screen
      title="Orders"
      back={{ href: '/admin', label: 'Today' }}
      intro="Read just now. Nothing here updates on its own — the refresh is in the bar above."
      width="wide"
    >
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile
          label="Orders today"
          value={String(orders.length)}
          hint={`${queue.length} ${queue.length === 1 ? 'window' : 'windows'} in use`}
          icon={<ReceiptIcon size={17} weight="fill" />}
        />
        <StatTile
          label="Waiting on the scale"
          value={String(toWeigh.length)}
          hint={`${orders.reduce((n, o) => n + unweighedIn(o), 0)} per-kg lines`}
          icon={<ScalesIcon size={17} weight="fill" />}
          tone={toWeigh.length > 0 ? 'danger' : 'plain'}
        />
        <StatTile
          label="Out for delivery"
          value={String(orders.filter((o) => o.status === 'OUT').length)}
          hint={`${orders.filter((o) => o.status === 'READY').length} packed and waiting`}
          icon={<TruckIcon size={17} weight="fill" />}
          tone={orders.filter((o) => o.status === 'OUT').length > 0 ? 'accent' : 'plain'}
        />
        <StatTile
          label="Delivered"
          value={String(orders.filter((o) => o.status === 'DELIVERED').length)}
          hint={`${orders.filter((o) => o.payMode === 'COD').length} cash on delivery today`}
          icon={<CheckCircleIcon size={17} weight="fill" />}
          tone={orders.filter((o) => o.status === 'DELIVERED').length > 0 ? 'success' : 'plain'}
        />
      </div>

      {queue.length === 0 ? (
        <Empty
          title="No orders yet"
          body="Orders appear here as customers place them, grouped by the delivery slot they chose."
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {queue.map((slot) => (
          <Panel
            key={slot.id}
            title={slotClock(tz, slot.startsAt, slot.endsAt)}
            note={`${slot.orders.length} ${slot.orders.length === 1 ? 'order' : 'orders'} in this window`}
            action={
              slot.hotEligible ? (
                <Chip tone="hot">
                  <FlameIcon size={11} weight="fill" aria-hidden />
                  Hot food
                </Chip>
              ) : null
            }
          >
            <ul className="grid gap-2">
              {slot.orders.map((order, i) => {
                const unweighed = unweighedIn(order);
                return (
                  <li key={order.id} style={{ '--i': i } as React.CSSProperties} className="rise">
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="press-card block rounded-md border border-line px-3 py-2.5 transition-colors hover:border-accent"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-lead font-semibold">{orderRef(order)}</span>
                        <span className="tnum shrink-0 text-lead">
                          {order.finalTotalCents === null
                            ? `${money(order.estTotalCents, ADMIN_LOCALE)} est.`
                            : money(order.finalTotalCents, ADMIN_LOCALE)}
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Chip tone={order.status === 'DELIVERED' ? 'success' : 'accent'}>
                          {order.status.toLowerCase()}
                        </Chip>
                        {order.hasHotLine ? (
                          <Chip tone="hot">
                            <FlameIcon size={11} weight="fill" aria-hidden />
                            hot food
                          </Chip>
                        ) : null}
                        {unweighed > 0 ? <Chip tone="danger">{unweighed} to weigh</Chip> : null}
                        {/*
                          ⭐ A cash order is packed the same and handed over
                          differently — somebody is coming back with money for
                          it. Prepaid says nothing, because saying "paid" on the
                          overwhelming majority of rows is noise that makes the
                          minority harder to spot, not easier.
                        */}
                        {order.payMode === 'COD' ? (
                          <Chip tone="danger">
                            cash on delivery
                            {order.finalTotalCents === null
                              ? ''
                              : ` · ${money(order.finalTotalCents, ADMIN_LOCALE)} due`}
                          </Chip>
                        ) : null}
                      </div>

                      {/*
                        The driver reported a figure that did not match. The
                        order deliberately did NOT close — see `reportDelivery`.
                      */}
                      {order.cashCollectedCents !== null &&
                      order.cashCollectedCents !== order.finalTotalCents ? (
                        <p className="mt-1.5 rounded-sm bg-danger-wash px-2 py-1 text-meta font-semibold text-danger">
                          Driver reported {money(order.cashCollectedCents, ADMIN_LOCALE)} collected
                          {order.finalTotalCents === null
                            ? ''
                            : `, ${money(order.finalTotalCents, ADMIN_LOCALE)} was due`}
                        </p>
                      ) : null}

                      <p className="mt-1.5 flex items-center gap-1 text-meta text-muted">
                        <span className="min-w-0 flex-1 truncate">
                          {order.lines
                            .map((l) => `${l.productName} ${weight(l.requestedG, ADMIN_LOCALE)}`)
                            .join(', ')}
                        </span>
                        <CaretRightIcon size={12} weight="bold" aria-hidden className="shrink-0" />
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))}
      </div>
    </Screen>
  );
}
