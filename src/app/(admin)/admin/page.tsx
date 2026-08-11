import Link from 'next/link';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog } from '@/db/repositories/catalog';
import { orderQueue } from '@/db/repositories/orders';
import { businessDateIn, shopTimeZone } from '@/ui/business-date';
import { weight } from '@/ui/format';

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
      </Screen>
    );
  }

  const [items, queue] = await Promise.all([listCatalog(day.id), orderQueue(day.id)]);

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
      </div>

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
            {weight(declared.reduce((g, i) => g + (i.stockedG ?? 0), 0))}
          </span>
        </Link>
      </nav>
    </Screen>
  );
}
