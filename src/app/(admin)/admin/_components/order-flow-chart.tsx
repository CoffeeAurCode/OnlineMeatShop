'use client';

import { useState } from 'react';

import { ADMIN_LOCALE, money, weight } from '@/ui/format';

/**
 * ⭐ THE DAY, BY DELIVERY WINDOW. The reference's `Order Trends` panel, with
 * its invented twelve-month series replaced by the only series this shop
 * actually has.
 *
 * ⚠ THE X AXIS IS THE DAY'S WINDOWS, NOT MONTHS, AND THAT IS THE WHOLE POINT.
 * A month-over-month trend would need history the console does not keep:
 * nothing rolls over, a business day is declared each morning and closed each
 * night (`CLAUDE.md` §2), so there is no previous period to plot against. What
 * there IS — and what the owner is actually deciding from at 6am — is how the
 * day's load is distributed across the windows the van goes out in. Every bar
 * here is a count of rows in the database.
 *
 * ⚠ THREE METRICS, ONE SHAPE. Orders, money and weight answer three different
 * questions about the same windows — how many boxes, how much money, how much
 * fish to cut — and a shop with four orders in one window and forty kilos in
 * another needs both readings. The segmented control is the reference's; the
 * metrics are ours.
 *
 * ⚠ MONEY IS ESTIMATED WHERE IT IS NOT YET WEIGHED, and the panel says so
 * rather than letting a bar imply a settled figure. Per-kg lines are not final
 * until the scale has spoken; see `CLAUDE.md` §3.
 */

export interface FlowWindow {
  readonly id: string;
  readonly label: string;
  readonly hotEligible: boolean;
  readonly orders: number;
  readonly valueCents: number;
  readonly weightG: number;
  /** True once the window's end time has passed. */
  readonly past: boolean;
  /** The next window still to go out. At most one of these is true. */
  readonly next: boolean;
}

const METRICS = [
  { key: 'orders', label: 'Orders' },
  { key: 'value', label: 'Value' },
  { key: 'weight', label: 'Weight' },
] as const;

type MetricKey = (typeof METRICS)[number]['key'];

function valueOf(w: FlowWindow, metric: MetricKey): number {
  return metric === 'orders' ? w.orders : metric === 'value' ? w.valueCents : w.weightG;
}

function labelOf(v: number, metric: MetricKey): string {
  return metric === 'orders'
    ? String(v)
    : metric === 'value'
      ? money(v, ADMIN_LOCALE)
      : weight(v, ADMIN_LOCALE);
}

export function OrderFlowChart({ windows }: { windows: readonly FlowWindow[] }) {
  const [metric, setMetric] = useState<MetricKey>('orders');

  const values = windows.map((w) => valueOf(w, metric));
  const peak = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="rail flex gap-1 overflow-x-auto rounded-full bg-soft p-1">
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMetric(m.key)}
            aria-pressed={metric === m.key}
            className={`tap press flex-1 shrink-0 rounded-full px-3 py-1.5 text-meta font-semibold transition-colors ${
              metric === m.key ? 'bg-raised text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <p className="tnum mt-3 text-display-lg font-bold tracking-tight">
        {labelOf(total, metric)}
      </p>
      <p className="text-micro text-muted">
        across {windows.length} {windows.length === 1 ? 'window' : 'windows'} today
        {metric === 'value' ? ' · estimated until every line is weighed' : ''}
      </p>

      {/*
        ⚠ THE BARS ARE A FLEX ROW OF COLUMNS, NOT AN SVG. There are at most a
        handful of them, they need no axis ticks and no interaction beyond a
        title, and a chart library on this console would be the single largest
        thing in a bundle that currently has none.
      */}
      {/*
        ⚠ THE PLOT AREA HAS AN EXPLICIT HEIGHT AND EACH COLUMN IS `h-full`, and
        neither is decoration. A bar sized in `%` resolves against its parent's
        height, and a flex column that is sized by its own content has no
        height to resolve against — every bar computes to zero and the chart
        renders as a set of labels floating over nothing. Caught in the browser,
        because it type-checks and lints perfectly.
      */}
      <div className="chart-rules mt-4 flex h-[150px] items-stretch gap-1.5 pt-1 sm:h-[170px]">
        {windows.map((w, i) => {
          const v = values[i] ?? 0;
          const pct = Math.round((v / peak) * 100);
          return (
            <div key={w.id} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
              <span className="tnum text-center text-micro font-semibold text-muted">
                {v === 0 ? '' : metric === 'orders' ? v : ''}
              </span>
              <div
                title={`${w.label} — ${labelOf(v, metric)}`}
                style={{ height: `${Math.max(pct, v === 0 ? 2 : 8)}%` }}
                className={`w-full rounded-t-sm transition-[height] duration-(--duration-standard) ${
                  w.next ? 'bg-accent' : w.past ? 'bg-soft' : 'bg-accent/35'
                }`}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex gap-1.5">
        {windows.map((w) => (
          <p
            key={w.id}
            className="tnum min-w-0 flex-1 truncate text-center text-micro text-muted"
            title={w.label}
          >
            {w.label.slice(0, 5)}
          </p>
        ))}
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-accent" />
          next out
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-accent/35" />
          later today
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-soft" />
          gone
        </span>
      </p>
    </div>
  );
}
