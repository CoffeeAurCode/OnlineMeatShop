import Link from 'next/link';

import { slotRunwayDays, takingsForDay } from '@/db/repositories/admin';
import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog } from '@/db/repositories/catalog';
import { orderQueue } from '@/db/repositories/orders';
import { businessDateIn, shopTimeZone } from '@/ui/business-date';
import { ADMIN_LOCALE, money, weight } from '@/ui/format';

import { Empty, Row, Screen } from './_components/shell';

/**
 * Today.
 *
 * One screen answering the only three questions the owner has before the shop
 * opens: is the day open, what is on the counter, and what has been ordered.
 * Everything else is one tap away and nothing else is on this screen.
 */
export default async function TodayPage() {
  const tz = shopTimeZone();
  const today = businessDateIn(tz, new Date());
  const day = await currentBusinessDay();

  if (day === null) {
    return (
      <Screen title="Today">
        <Empty
          title="The day is not open yet"
          body="Nothing rolls over from yesterday. Declare what is on the counter this morning and the shop starts selling against it."
        />
        <Link
          href="/admin/open"
          className="tap-lg mt-6 flex w-full items-center justify-center rounded-sm bg-accent px-4 text-lead font-semibold text-accent-ink"
        >
          Open {today}
        </Link>

        {/*
          ⚠ THE REST OF THE CONSOLE IS REACHABLE FROM THE CLOSED-DAY SCREEN
          TOO. Delivery windows, the roster and the catalog are not part of a
          trading day and the owner may well be fixing one of them at 6am
          BECAUSE the day will not open properly otherwise. Hiding them here
          would strand somebody on the one screen that cannot help them.
        */}
        <ManageNav />
      </Screen>
    );
  }

  const [items, queue, takings, runwayDays] = await Promise.all([
    listCatalog(day.id),
    orderQueue(day.id),
    takingsForDay(day.id),
    slotRunwayDays(today),
  ]);

  const declared = items.filter((i) => i.stockedG !== null);
  const soldOut = declared.filter((i) => (i.availableG ?? 0) === 0);
  const orderCount = queue.reduce((n, s) => n + s.orders.length, 0);
  const toWeigh = queue
    .flatMap((s) => s.orders)
    .filter((o) => o.status === 'PREPARING' && o.lines.some((l) => l.pricingMode === 'perKg' && l.actWeightG === null));

  return (
    <Screen title="Today">
      <p className="mt-1 text-body text-muted">
        {day.businessDate}
        {day.businessDate === today ? '' : ' (this is not today’s date)'}
      </p>

      <div className="mt-6">
        <Row>
          <span className="text-body">Products on the counter</span>
          <span className="tnum text-lead font-semibold">{declared.length}</span>
        </Row>
        <Row>
          <span className="text-body">Sold out</span>
          <span className="tnum text-lead font-semibold">{soldOut.length}</span>
        </Row>
        <Row>
          <span className="text-body">Orders today</span>
          <span className="tnum text-lead font-semibold">{orderCount}</span>
        </Row>
        <Row>
          <span className="text-body">Waiting to be weighed</span>
          <span className="tnum text-lead font-semibold">{toWeigh.length}</span>
        </Row>
        <Row>
          {/*
            ⚠ THIS FIGURE EXCLUDES EVERY ORDER PAID THROUGH THE STUB ADAPTER,
            and the excluded count is shown next to it rather than hidden.
            Prototype orders are `PREPAID`-shaped on purpose — nothing in the
            order distinguishes them from real ones except which adapter took
            the money — so a takings line that did not filter would report test
            traffic as revenue. See `takingsForDay`.
          */}
          <span className="text-body">Taken today</span>
          <span className="tnum text-lead font-semibold">
            {money(takings.finalTotalCents || takings.estTotalCents, ADMIN_LOCALE)}
          </span>
        </Row>
      </div>

      {takings.excludedTestOrders > 0 ? (
        <p className="mt-2 text-meta text-muted">
          {takings.excludedTestOrders} test {takings.excludedTestOrders === 1 ? 'order' : 'orders'}{' '}
          excluded from takings — no real money moved on {takings.excludedTestOrders === 1 ? 'it' : 'them'}.
        </p>
      ) : null}

      {runwayDays <= 3 ? (
        <p className="mt-4 rounded-sm bg-danger-wash px-3 py-2 text-body font-semibold text-danger">
          {runwayDays === 0
            ? 'There are no delivery windows left. Customers cannot check out.'
            : `Only ${runwayDays} day${runwayDays === 1 ? '' : 's'} of delivery windows remain.`}{' '}
          <Link href="/admin/slots" className="underline underline-offset-4">
            Add more
          </Link>
        </p>
      ) : null}

      {soldOut.length > 0 ? (
        <p className="mt-4 text-meta text-muted">
          Sold out: {soldOut.map((i) => i.name).join(', ')}
        </p>
      ) : null}

      {declared.length === 0 ? (
        <Empty
          title="Nothing declared today"
          body="The day is open but no quantities were entered, so every product reads as unavailable to customers."
        />
      ) : null}

      <nav className="mt-8 grid gap-3">
        <Link
          href="/admin/orders"
          className="tap-lg flex items-center justify-between rounded-sm border border-line bg-raised px-4 text-lead"
        >
          <span>Orders</span>
          <span className="tnum text-muted">{orderCount}</span>
        </Link>
        <Link
          href="/admin/stock"
          className="tap-lg flex items-center justify-between rounded-sm border border-line bg-raised px-4 text-lead"
        >
          <span>Stock</span>
          <span className="tnum text-muted">
            {weight(declared.reduce((g, i) => g + (i.stockedG ?? 0), 0), ADMIN_LOCALE)}
          </span>
        </Link>
      </nav>

      <ManageNav />
    </Screen>
  );
}

/**
 * Everything that is not today.
 *
 * ⭐ THE POINT OF THIS BLOCK IS THAT NONE OF IT NEEDS A DEVELOPER ANY MORE.
 * Every entry here used to be a script, a SQL statement or a deploy: delivery
 * windows came from `seed-fulfilment.mjs`, the delivery area from a hand-typed
 * UPDATE, prices from `seed-catalog.mjs` plus a release. The console is now
 * the whole operating surface of the shop.
 *
 * Kept BELOW the day's numbers and visually quieter than them, because the
 * owner opens this console to run today and only occasionally to change how
 * the shop works.
 */
function ManageNav() {
  const items = [
    { href: '/admin/slots', label: 'Delivery windows', hint: 'when the van goes out' },
    { href: '/admin/partners', label: 'Drivers', hint: 'who carries the boxes' },
    { href: '/admin/delivery-area', label: 'Delivery area', hint: 'how far, and the fee' },
    { href: '/admin/catalog', label: 'Catalog', hint: 'names and prices' },
    { href: '/admin/shop', label: 'Shop details', hint: 'address, hours, phone' },
    { href: '/admin/settings', label: 'Console settings', hint: 'the new-order sound' },
  ];

  return (
    <nav className="mt-10">
      <h2 className="text-section font-semibold tracking-tight">Manage the shop</h2>
      <div className="mt-3 grid gap-2">
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className="tap-lg flex items-center justify-between rounded-sm border border-line bg-raised px-4 text-body"
          >
            <span className="font-semibold">{i.label}</span>
            <span className="text-meta text-muted">{i.hint}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
