import Link from 'next/link';
import {
  CaretRightIcon,
  CheckCircleIcon,
  ClockIcon,
  CurrencyDollarIcon,
  FlameIcon,
  PackageIcon,
  ReceiptIcon,
  ScalesIcon,
  TruckIcon,
  WarningIcon,
} from '@phosphor-icons/react/dist/ssr';

import { smsConfigured } from '@/adapters/sms';
import { listSlots, slotRunwayDays, takingsForDay } from '@/db/repositories/admin';
import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog } from '@/db/repositories/catalog';
import { cashDiscrepancies } from '@/db/repositories/driver';
import { orderQueue, orderRef, type QueueOrder } from '@/db/repositories/orders';
import { listPartners } from '@/db/repositories/partners';
import { isPainted, thumb } from '@/ui/art';
import { businessDateIn, shopTimeZone, slotClock } from '@/ui/business-date';
import { ADMIN_LOCALE, money, pricePerUnit, ratePerKg, weight } from '@/ui/format';
import { portalOrigin } from '@/ui/shop-config';

import { Chip, Empty, Meter, Panel, Screen, StatTile } from './_components/shell';
import { CounterGrid, type CounterItem } from './_components/counter-grid';
import { OrderFlowChart, type FlowWindow } from './_components/order-flow-chart';

/**
 * ⭐ TODAY. The console's dashboard, rebuilt 2026-08-19 against the
 * operations-dashboard reference the client supplied.
 *
 * ⚠ THE SCREEN IT REPLACED ANSWERED THREE QUESTIONS AND THIS ONE ANSWERS THE
 * SAME THREE FIRST. Is the day open, what is on the counter, what has been
 * ordered — those are still the top of the page and still the largest type on
 * it. What is added below them is the work the owner previously did by walking
 * between four screens and holding the comparison in their head: which window
 * the load is in, what is waiting on the scale, what the drivers are carrying,
 * and which of today's declared quantities is nearly gone.
 *
 * ⚠ EVERY FIGURE ON THIS PAGE IS READ FROM THE DATABASE ON EVERY REQUEST.
 * There is no cache and there must never be one: `04-PLAN` §4 is explicit that
 * a stock or order number that was true ten minutes ago is a WRONG number, and
 * a dashboard is the screen where a stale figure does the most damage because
 * it is the screen the owner trusts without checking.
 *
 * ⚠ AND NOTHING ON IT IS INVENTED. The reference decorates every tile with a
 * period-over-period percentage; this shop declares a fresh business day each
 * morning and rolls nothing over, so there is no previous period and any such
 * figure would be fabricated (`CLAUDE.md` §3). Where a tile has no second fact
 * worth printing it prints a sentence instead of a number.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** The order lifecycle, in the sequence the shop works it. */
const PIPELINE = [
  { status: 'PLACED', label: 'Placed' },
  { status: 'PREPARING', label: 'Preparing' },
  { status: 'WEIGHED', label: 'Weighed' },
  { status: 'READY', label: 'Ready' },
  { status: 'OUT', label: 'Out' },
  { status: 'DELIVERED', label: 'Delivered' },
] as const;

/** A per-kg line that has not met the scale yet. The console's unit of work. */
function unweighedLines(o: QueueOrder): number {
  return o.lines.filter((l) => l.pricingMode === 'perKg' && l.actWeightG === null).length;
}

export default async function TodayPage() {
  const tz = shopTimeZone();
  const now = new Date();
  const today = businessDateIn(tz, now);
  const day = await currentBusinessDay();

  if (day === null) {
    /*
      ⚠ THE REST OF THE CONSOLE IS REACHABLE FROM THE CLOSED-DAY SCREEN TOO.
      Delivery windows, the roster and the catalog are not part of a trading
      day, and the owner may well be fixing one of them at 6am BECAUSE the day
      will not open properly otherwise. The rail and the pill row carry all of
      them at every width, so this screen no longer has to repeat the list.
    */
    const runwayDays = await slotRunwayDays(today);

    return (
      <Screen
        title="Today"
        intro="Nothing rolls over from yesterday. Declare what is on the counter this morning and the shop starts selling against it."
        width="wide"
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="The day is not open yet" className="xl:col-span-2">
            <Empty
              title={`No trading day for ${today}`}
              body="Every product reads as unavailable to customers until a quantity is declared against an open day. Opening the day is one screen: a number per product, in kilograms."
            />
            <Link
              href="/admin/open"
              className="tap-lg press mt-4 flex w-full items-center justify-center rounded-md bg-accent px-4 text-lead font-semibold text-accent-ink"
            >
              Open {today}
            </Link>
          </Panel>

          <Panel title="Needs attention" note="Checked on every load.">
            <AttentionList
              items={await attention({ runwayDays, dayOpen: false, toWeigh: 0, soldOut: [] })}
            />
          </Panel>
        </div>
      </Screen>
    );
  }

  const [items, queue, takings, runwayDays, slots, discrepancies, partners] = await Promise.all([
    listCatalog(day.id, { includeInactive: true }),
    orderQueue(day.id),
    takingsForDay(day.id),
    slotRunwayDays(today),
    listSlots(today),
    cashDiscrepancies(),
    listPartners(true),
  ]);

  // ── The day's orders, flattened once and read from many times ───────────
  const orders = queue.flatMap((s) => s.orders);
  const live = orders.filter((o) => o.status !== 'CANCELLED');
  const cancelled = orders.length - live.length;
  const byStatus = (s: string) => live.filter((o) => o.status === s).length;

  const toWeigh = live.filter((o) => o.status === 'PREPARING' && unweighedLines(o) > 0);
  const weighingLines = live.reduce((n, o) => n + unweighedLines(o), 0);
  const cashOrders = live.filter((o) => o.payMode === 'COD');
  const hotOrders = live.filter((o) => o.hasHotLine);

  // ── The counter ─────────────────────────────────────────────────────────
  const active = items.filter((i) => i.active);
  const declared = active.filter((i) => i.stockedG !== null);
  const soldOut = declared.filter((i) => (i.availableG ?? 0) === 0);
  const remainingG = declared.reduce((g, i) => g + (i.availableG ?? 0), 0);

  // ── Today's windows, whether or not anything was ordered into them ───────
  const todaySlots = slots.filter((s) => s.serviceDate === today && s.active);
  const ordersBySlot = new Map(queue.map((s) => [s.id, s.orders.filter((o) => o.status !== 'CANCELLED')]));
  const nextIndex = todaySlots.findIndex((s) => s.endsAt.getTime() >= now.getTime());

  const windows: FlowWindow[] = todaySlots.map((s, i) => {
    const inSlot = ordersBySlot.get(s.id) ?? [];
    return {
      id: s.id,
      label: slotClock(tz, s.startsAt, s.endsAt),
      hotEligible: s.hotEligible,
      orders: inSlot.length,
      /*
        ⚠ FINAL WHERE THERE IS ONE, ESTIMATE WHERE THERE IS NOT. A per-kg line
        is not priced until it has been weighed, so a chart that only summed
        final totals would read zero all morning and a chart that only summed
        estimates would keep reporting a number the scale has already replaced.
      */
      valueCents: inSlot.reduce((c, o) => c + (o.finalTotalCents ?? o.estTotalCents), 0),
      weightG: inSlot.reduce(
        (g, o) => g + o.lines.reduce((n, l) => n + (l.actWeightG ?? l.requestedG), 0),
        0,
      ),
      past: s.endsAt.getTime() < now.getTime(),
      next: i === nextIndex,
    };
  });

  const takenCents = takings.finalTotalCents || takings.estTotalCents;
  const counterItems: CounterItem[] = items.map((i) => ({
    id: i.id,
    name: i.name,
    imagePath: i.imagePath === null ? null : thumb(i.imagePath),
    painted: i.imagePath !== null && isPainted(i.imagePath),
    priceLabel:
      i.pricing.mode === 'perKg'
        ? ratePerKg(i.pricing.ratePerKg, ADMIN_LOCALE)
        : pricePerUnit(i.pricing.price, 'pack', ADMIN_LOCALE),
    hot: i.handling === 'COOKED_HOT',
    active: i.active,
    stockedG: i.stockedG,
    availableG: i.availableG,
  }));

  const alerts = await attention({
    runwayDays,
    dayOpen: true,
    toWeigh: toWeigh.length,
    soldOut: soldOut.map((i) => i.name),
    discrepancies: discrepancies.length,
    activePartners: partners.length,
    outWithNoDriver: live.filter((o) => o.status === 'READY' || o.status === 'OUT').length,
    undeclared: active.length - declared.length,
  });

  return (
    <Screen
      title="Today"
      intro={
        <>
          {day.businessDate}
          {day.businessDate === today ? '' : ' — this is not today’s date'} · read just now, and
          nothing on this page updates on its own
        </>
      }
      width="wide"
      action={
        <Link
          href="/admin/stock"
          className="tap press inline-flex items-center gap-1.5 rounded-full bg-accent px-4 text-meta font-semibold text-accent-ink"
        >
          Correct stock
          <CaretRightIcon size={13} weight="bold" aria-hidden />
        </Link>
      }
    >
      <div className="grid gap-4 xl:grid-cols-12">
        {/* ── The working column ─────────────────────────────────────────── */}
        <div className="grid min-w-0 gap-4 xl:col-span-8">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            <StatTile
              label="Orders today"
              value={String(live.length)}
              hint={
                cancelled === 0
                  ? `${cashOrders.length} cash · ${live.length - cashOrders.length} prepaid`
                  : `${cancelled} cancelled, not counted`
              }
              icon={<ReceiptIcon size={17} weight="fill" />}
              href="/admin/orders"
            />
            <StatTile
              label="Waiting on the scale"
              value={String(toWeigh.length)}
              hint={
                weighingLines === 0
                  ? 'nothing to weigh'
                  : `${weighingLines} per-kg ${weighingLines === 1 ? 'line' : 'lines'}`
              }
              icon={<ScalesIcon size={17} weight="fill" />}
              tone={toWeigh.length > 0 ? 'danger' : 'plain'}
              href="/admin/orders"
            />
            <StatTile
              label="Out for delivery"
              value={String(byStatus('OUT'))}
              hint={`${byStatus('READY')} packed and waiting`}
              icon={<TruckIcon size={17} weight="fill" />}
              tone={byStatus('OUT') > 0 ? 'accent' : 'plain'}
              href="/admin/orders"
            />
            <StatTile
              label="Delivered"
              value={String(byStatus('DELIVERED'))}
              hint={
                live.length === 0
                  ? 'nothing ordered yet'
                  : `${Math.round((byStatus('DELIVERED') / live.length) * 100)}% of today`
              }
              icon={<CheckCircleIcon size={17} weight="fill" />}
              tone={byStatus('DELIVERED') > 0 ? 'success' : 'plain'}
            />
            <StatTile
              label="Taken today"
              value={money(takenCents, ADMIN_LOCALE)}
              /*
                ⚠ THIS FIGURE EXCLUDES EVERY ORDER PAID THROUGH THE STUB
                ADAPTER, and the excluded count is shown rather than hidden.
                Prototype orders are `PREPAID`-shaped on purpose — nothing in
                the order distinguishes them from real ones except which
                adapter took the money — so a takings line that did not filter
                would report test traffic as revenue. See `takingsForDay`.
              */
              hint={
                takings.excludedTestOrders > 0
                  ? `${takings.excludedTestOrders} test ${takings.excludedTestOrders === 1 ? 'order' : 'orders'} excluded`
                  : takings.finalTotalCents === 0
                    ? 'estimated until every line is weighed'
                    : `${takings.orders} paying ${takings.orders === 1 ? 'order' : 'orders'}`
              }
              icon={<CurrencyDollarIcon size={17} weight="fill" />}
              tone="success"
            />
            <StatTile
              label="On the counter"
              value={String(declared.length)}
              hint={`${weight(remainingG, ADMIN_LOCALE)} left · ${soldOut.length} sold out`}
              icon={<PackageIcon size={17} weight="fill" />}
              tone={soldOut.length > 0 ? 'danger' : 'plain'}
              href="/admin/stock"
            />
            <StatTile
              label="Hot food today"
              value={String(hotOrders.length)}
              /*
                Not a count of hot products — a count of ORDERS constrained by
                one. A single hot line decides which delivery windows the whole
                order may use, which is why it is on this row at all.
              */
              hint={`${todaySlots.filter((s) => s.hotEligible).length} hot-eligible ${todaySlots.filter((s) => s.hotEligible).length === 1 ? 'window' : 'windows'}`}
              icon={<FlameIcon size={17} weight="fill" />}
              tone={hotOrders.length > 0 ? 'accent' : 'plain'}
            />
            <StatTile
              label="Delivery windows left"
              value={`${runwayDays}d`}
              hint={
                runwayDays === 0
                  ? 'customers cannot check out'
                  : `${todaySlots.length} today · add more before it runs out`
              }
              icon={<ClockIcon size={17} weight="fill" />}
              tone={runwayDays <= 3 ? 'danger' : 'plain'}
              href="/admin/slots"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Panel
              title="Today’s service"
              note="Every window the van goes out in, and what is in it."
              className="lg:col-span-3"
            >
              {/*
                ⭐ THE PIPELINE. The reference draws a van moving along a route;
                the equivalent fact here is where the day's orders have got to,
                and it is a fact rather than an illustration.
              */}
              <ul className="rail flex gap-1.5 overflow-x-auto pb-1">
                {PIPELINE.map((p) => {
                  const n = byStatus(p.status);
                  return (
                    <li
                      key={p.status}
                      className={`min-w-0 shrink-0 rounded-md px-2.5 py-1.5 text-center ${
                        n > 0 ? 'bg-accent-wash text-accent' : 'bg-soft text-muted'
                      }`}
                    >
                      <p className="tnum text-lead font-bold">{n}</p>
                      <p className="text-micro font-semibold">{p.label}</p>
                    </li>
                  );
                })}
              </ul>

              {todaySlots.length === 0 ? (
                <div className="mt-4">
                  <Empty
                    title="No delivery windows today"
                    body="Customers cannot check out on a day with no window to deliver in. Add one on the Windows screen."
                  />
                </div>
              ) : (
                <ul className="mt-4">
                  {todaySlots.map((s) => {
                    const inSlot = ordersBySlot.get(s.id) ?? [];
                    const pending = inSlot.reduce((n, o) => n + unweighedLines(o), 0);
                    const gone = s.endsAt.getTime() < now.getTime();

                    return (
                      <li key={s.id} className="border-b border-line py-2.5 last:border-b-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`tnum text-body font-semibold ${gone ? 'text-muted' : ''}`}>
                            {slotClock(tz, s.startsAt, s.endsAt)}
                          </span>
                          {s.hotEligible ? (
                            <Chip tone="hot">
                              <FlameIcon size={11} weight="fill" aria-hidden />
                              Hot food
                            </Chip>
                          ) : null}
                          {gone ? <Chip>gone</Chip> : null}
                          {pending > 0 ? (
                            <Chip tone="danger">
                              {pending} to weigh
                            </Chip>
                          ) : null}
                          <span className="tnum ml-auto text-meta text-muted">
                            {inSlot.length} of {s.capacity}
                          </span>
                        </div>
                        <div className="mt-1.5">
                          <Meter
                            filled={s.bookedCount}
                            total={s.capacity}
                            tone={s.bookedCount >= s.capacity ? 'danger' : 'accent'}
                          />
                        </div>
                        {inSlot.length > 0 ? (
                          <p className="mt-1.5 truncate text-micro text-muted">
                            {inSlot.map((o) => orderRef(o)).join(' · ')}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel
              title="Orders by window"
              note="Today only. Nothing rolls over, so there is no previous period to compare against."
              className="lg:col-span-2"
            >
              {windows.length === 0 ? (
                <Empty
                  title="Nothing to plot"
                  body="There are no delivery windows on today’s date."
                />
              ) : (
                <OrderFlowChart windows={windows} />
              )}
            </Panel>
          </div>

          <Panel
            title="On the counter"
            note="What was declared this morning, and what is left of it."
            action={
              <Link
                href="/admin/stock"
                className="tap press inline-flex items-center gap-1 rounded-full bg-soft px-3.5 text-meta font-semibold hover:text-accent"
              >
                Correct stock
                <CaretRightIcon size={12} weight="bold" aria-hidden />
              </Link>
            }
          >
            {declared.length === 0 ? (
              <Empty
                title="Nothing declared today"
                body="The day is open but no quantities were entered, so every product reads as unavailable to customers."
              />
            ) : (
              <CounterGrid items={counterItems} />
            )}
          </Panel>
        </div>

        {/* ── The activity column ────────────────────────────────────────── */}
        <aside className="grid min-w-0 content-start gap-4 xl:col-span-4">
          <Panel title="Needs attention" note="Checked on every load, never cached.">
            <AttentionList items={alerts} />
          </Panel>

          <Panel
            title="Latest orders"
            note="Newest first, across every window."
            action={
              <Link
                href="/admin/orders"
                className="tap press inline-flex items-center gap-1 rounded-full bg-soft px-3.5 text-meta font-semibold hover:text-accent"
              >
                All {live.length}
                <CaretRightIcon size={12} weight="bold" aria-hidden />
              </Link>
            }
          >
            {live.length === 0 ? (
              <Empty
                title="No orders yet"
                body="Orders appear here as customers place them. The console makes a sound for each new one, if the sound is armed."
              />
            ) : (
              <ul>
                {[...live]
                  .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                  .slice(0, 6)
                  .map((o) => (
                    <li key={o.id} className="border-b border-line last:border-b-0">
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="press flex items-center gap-3 py-2.5"
                      >
                        <span
                          aria-hidden
                          className="grid size-9 shrink-0 place-content-center rounded-full bg-accent-wash text-meta font-semibold text-accent"
                        >
                          {(o.postalCode ?? '#').slice(0, 2).toUpperCase()}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-body font-semibold">{orderRef(o)}</span>
                            {o.payMode === 'COD' ? <Chip tone="danger">cash</Chip> : null}
                            {o.hasHotLine ? (
                              <Chip tone="hot">
                                <FlameIcon size={11} weight="fill" aria-hidden />
                              </Chip>
                            ) : null}
                          </span>
                          <span className="block truncate text-micro text-muted">
                            {o.status.toLowerCase()} ·{' '}
                            {o.lines.map((l) => l.productName).join(', ')}
                          </span>
                        </span>

                        <span className="tnum shrink-0 text-right text-body font-semibold">
                          {o.finalTotalCents === null
                            ? `${money(o.estTotalCents, ADMIN_LOCALE)}`
                            : money(o.finalTotalCents, ADMIN_LOCALE)}
                          <span className="block text-micro font-normal text-muted">
                            {o.finalTotalCents === null ? 'estimate' : 'final'}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </Panel>

          {/*
            ⭐ THE POINT OF THIS BLOCK IS THAT NONE OF IT NEEDS A DEVELOPER ANY
            MORE. Every entry used to be a script, a SQL statement or a deploy:
            delivery windows came from `seed-fulfilment.mjs`, the delivery area
            from a hand-typed UPDATE, prices from `seed-catalog.mjs` plus a
            release. The console is now the whole operating surface of the shop.

            Kept quieter than the day's figures, because the owner opens this
            console to run today and only occasionally to change how the shop
            works. It is duplicated by the rail on a laptop and by the pill row
            on a phone; what it adds is the one-line explanation of what each
            screen is for, which an icon cannot carry.
          */}
          <Panel title="Manage the shop" note="Everything that is not today.">
            <ul>
              {[
                { href: '/admin/slots', label: 'Delivery windows', hint: 'when the van goes out' },
                { href: '/admin/partners', label: 'Drivers', hint: 'who carries the boxes' },
                { href: '/admin/delivery-area', label: 'Delivery area', hint: 'how far, and the fee' },
                { href: '/admin/catalog', label: 'Catalog', hint: 'names and prices' },
                { href: '/admin/shop', label: 'Shop details', hint: 'address, hours, phone' },
                { href: '/admin/settings', label: 'Console settings', hint: 'the new-order sound' },
              ].map((i) => (
                <li key={i.href} className="border-b border-line last:border-b-0">
                  <Link
                    href={i.href}
                    className="press flex items-center justify-between gap-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-body font-semibold">{i.label}</span>
                      <span className="block truncate text-micro text-muted">{i.hint}</span>
                    </span>
                    <CaretRightIcon size={14} weight="bold" aria-hidden className="shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </Screen>
  );
}

// ── What is wrong, said once, in one place ─────────────────────────────────

interface Alert {
  readonly id: string;
  readonly tone: 'danger' | 'accent' | 'plain';
  readonly title: string;
  readonly body: string;
  readonly href?: string;
  readonly cta?: string;
}

/**
 * ⭐ EVERY WAY THIS DEPLOYMENT CAN QUIETLY DO LESS THAN THE SCREEN IMPLIES,
 * gathered onto the first screen the owner opens.
 *
 * ⚠ TWO OF THESE USED TO LIVE ONLY ON `/admin/partners`, and they are the
 * expensive ones. With no Twilio credentials dispatch still works, still marks
 * the order sent and texts nobody; with no `NEXT_PUBLIC_SITE_ORIGIN` the text
 * goes out without its sign-in link. On 2026-08-17 every dispatch went out
 * link-free and the shop found out from a driver. A banner on the roster screen
 * is only seen by somebody who went looking at the roster.
 *
 * ⚠ ORDERED BY WHAT IT COSTS TO IGNORE, not by category. No delivery windows
 * means the storefront cannot take an order at all, so it is first whenever it
 * is true.
 */
async function attention(input: {
  runwayDays: number;
  dayOpen: boolean;
  toWeigh: number;
  soldOut: readonly string[];
  discrepancies?: number;
  activePartners?: number;
  outWithNoDriver?: number;
  undeclared?: number;
}): Promise<readonly Alert[]> {
  const alerts: Alert[] = [];

  if (input.runwayDays === 0) {
    alerts.push({
      id: 'no-windows',
      tone: 'danger',
      title: 'There are no delivery windows left',
      body: 'Customers cannot check out. The storefront looks normal and refuses at the last step.',
      href: '/admin/slots',
      cta: 'Add windows',
    });
  } else if (input.runwayDays <= 3) {
    alerts.push({
      id: 'low-windows',
      tone: 'danger',
      title: `Only ${input.runwayDays} day${input.runwayDays === 1 ? '' : 's'} of delivery windows remain`,
      body: 'Nothing generates these. When the last one passes its cutoff the shop stops trading without saying so.',
      href: '/admin/slots',
      cta: 'Add windows',
    });
  }

  if (!input.dayOpen) {
    alerts.push({
      id: 'closed',
      tone: 'danger',
      title: 'The day is not open',
      body: 'Every product reads as unavailable until quantities are declared against an open business day.',
      href: '/admin/open',
      cta: 'Open the day',
    });
  }

  if ((input.discrepancies ?? 0) > 0) {
    alerts.push({
      id: 'cash',
      tone: 'danger',
      title: `${input.discrepancies} cash order${input.discrepancies === 1 ? '' : 's'} did not settle`,
      body: 'A driver reported an amount that was not the amount due, so the order was deliberately left open for the shop to resolve.',
      href: '/admin/orders',
      cta: 'Open orders',
    });
  }

  if (input.toWeigh > 0) {
    alerts.push({
      id: 'weigh',
      tone: 'accent',
      title: `${input.toWeigh} order${input.toWeigh === 1 ? '' : 's'} waiting on the scale`,
      body: 'A per-kg line is not priced until it is weighed, and a card is not charged until the order is.',
      href: '/admin/orders',
      cta: 'Open orders',
    });
  }

  if ((input.activePartners ?? 1) === 0 && (input.outWithNoDriver ?? 0) > 0) {
    alerts.push({
      id: 'no-driver',
      tone: 'danger',
      title: 'Nobody is on the roster',
      body: 'An order cannot be moved to OUT with no driver assigned, so packed orders will stay packed.',
      href: '/admin/partners',
      cta: 'Add a driver',
    });
  }

  if ((input.undeclared ?? 0) > 0) {
    alerts.push({
      id: 'undeclared',
      tone: 'plain',
      title: `${input.undeclared} product${input.undeclared === 1 ? '' : 's'} not declared today`,
      body: 'Not the same as sold out: these were never put on the counter this morning, so customers cannot see them at all.',
      href: '/admin/stock',
      cta: 'Declare stock',
    });
  }

  if (input.soldOut.length > 0) {
    alerts.push({
      id: 'sold-out',
      tone: 'plain',
      title: `${input.soldOut.length} sold out`,
      body: input.soldOut.join(', '),
      href: '/admin/stock',
      cta: 'Correct stock',
    });
  }

  if (!smsConfigured()) {
    alerts.push({
      id: 'sms',
      tone: 'danger',
      title: 'Text messages are not being sent',
      body: 'Dispatch is recorded and written to the server log, but no driver receives anything. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.',
      href: '/admin/partners',
      cta: 'Drivers',
    });
  }

  if (portalOrigin() === null) {
    alerts.push({
      id: 'portal',
      tone: 'danger',
      title: 'Dispatch texts carry no sign-in link',
      body: 'Drivers get the job and can deliver it, but cannot open their job list or close a cash order from their phone. Set NEXT_PUBLIC_SITE_ORIGIN.',
      href: '/admin/partners',
      cta: 'Drivers',
    });
  }

  return alerts;
}

function AttentionList({ items }: { items: readonly Alert[] }) {
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-md bg-success-wash px-3 py-3 text-meta font-semibold text-success">
        <CheckCircleIcon size={17} weight="fill" aria-hidden className="shrink-0" />
        Nothing needs attention.
      </p>
    );
  }

  const fills = {
    danger: 'bg-danger-wash text-danger',
    accent: 'bg-accent-wash text-accent',
    plain: 'bg-soft text-muted',
  } as const;

  return (
    <ul className="grid gap-2">
      {items.map((a) => (
        <li key={a.id} className="flex items-start gap-2.5 rounded-md bg-soft px-3 py-2.5">
          <span
            aria-hidden
            className={`grid size-7 shrink-0 place-content-center rounded-full ${fills[a.tone]}`}
          >
            <WarningIcon size={14} weight="fill" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-meta font-semibold">{a.title}</span>
            <span className="mt-0.5 block text-micro text-muted">{a.body}</span>
            {a.href === undefined ? null : (
              <Link
                href={a.href}
                className="mt-1 inline-flex items-center gap-1 text-micro font-semibold text-accent underline underline-offset-4"
              >
                {a.cta}
                <CaretRightIcon size={11} weight="bold" aria-hidden />
              </Link>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
