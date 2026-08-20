'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { FlameIcon, MagnifyingGlassIcon } from '@phosphor-icons/react/dist/ssr';

import { ADMIN_LOCALE, weight } from '@/ui/format';

import { Chip, Meter } from './shell';

/**
 * ⭐ WHAT IS ON THE COUNTER. The reference's `Popular Items` grid, which is
 * where it puts photographs of food and a price.
 *
 * ⚠ NOTHING HERE IS "POPULAR", AND THERE IS NO RATING. The reference fills
 * every card with a star rating, a strikethrough "was" price and a discount;
 * all three would be invented (`CLAUDE.md` §3) and one of them would be
 * invented IN A PRICE POSITION. What each card carries instead is the only
 * thing the owner is deciding from at 6am: how much of it is left, out of how
 * much was declared this morning.
 *
 * ⚠ `null` STOCK IS NOT ZERO STOCK, and the two are worded differently on
 * purpose. A product with no `stock_item` row was never put on the counter
 * today; a product whose declared quantity is fully reserved was, and has gone.
 * The storefront makes that distinction and so must this.
 */

export interface CounterItem {
  readonly id: string;
  readonly name: string;
  readonly imagePath: string | null;
  readonly painted: boolean;
  readonly priceLabel: string;
  readonly hot: boolean;
  readonly active: boolean;
  readonly stockedG: number | null;
  readonly availableG: number | null;
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'on', label: 'On the counter' },
  { key: 'low', label: 'Running low' },
  { key: 'out', label: 'Sold out' },
  { key: 'undeclared', label: 'Not declared' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

/**
 * ⚠ "LOW" IS A QUARTER OF WHAT WAS DECLARED THIS MORNING, not an absolute
 * weight. A quarter of 40kg of mussels and a quarter of 2kg of caviar are
 * different amounts of fish and the same amount of worry, and an absolute
 * threshold would flag one of them permanently and the other never.
 */
function isLow(i: CounterItem): boolean {
  if (i.stockedG === null || i.availableG === null || i.availableG === 0) return false;
  return i.availableG <= i.stockedG / 4;
}

function matches(i: CounterItem, filter: FilterKey): boolean {
  switch (filter) {
    case 'on':
      return i.stockedG !== null && (i.availableG ?? 0) > 0;
    case 'low':
      return isLow(i);
    case 'out':
      return i.stockedG !== null && (i.availableG ?? 0) === 0;
    case 'undeclared':
      return i.stockedG === null;
    default:
      return true;
  }
}

export function CounterGrid({ items }: { items: readonly CounterItem[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) => matches(i, filter) && (q === '' || i.name.toLowerCase().includes(q)),
    );
  }, [items, query, filter]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-full bg-soft px-3">
          <MagnifyingGlassIcon size={16} aria-hidden className="shrink-0 text-muted" />
          <span className="sr-only">Find a product on the counter</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a product"
            className="tap w-full min-w-0 bg-transparent text-body outline-none"
          />
        </label>
      </div>

      <div className="rail mt-2 flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`press shrink-0 rounded-full px-3 py-1.5 text-meta font-semibold transition-colors ${
              filter === f.key ? 'bg-accent text-accent-ink' : 'bg-soft text-muted hover:text-ink'
            }`}
          >
            {f.label}
            <span className="tnum ml-1.5 opacity-70">
              {items.filter((i) => matches(i, f.key)).length}
            </span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="mt-6 rounded-md border border-dashed border-line bg-soft px-4 py-8 text-center text-meta text-muted">
          Nothing on the counter matches that.
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
          {shown.map((i, index) => {
            const undeclared = i.stockedG === null;
            const left = i.availableG ?? 0;
            const soldOut = !undeclared && left === 0;

            return (
              <li
                key={i.id}
                style={{ '--i': index } as React.CSSProperties}
                className="rise card min-w-0 overflow-hidden"
              >
                <div className="relative aspect-[4/3] bg-soft">
                  {i.imagePath === null ? null : (
                    <Image
                      src={i.imagePath}
                      alt=""
                      fill
                      sizes="(max-width: 639px) 50vw, (max-width: 1279px) 33vw, 220px"
                      /*
                        ⚠ `.painted` AND A TAILWIND `filter` UTILITY MUST NEVER
                        BOTH LAND ON THIS ELEMENT — they compile to the same
                        property and the winner is decided by stylesheet order.
                        `.painted-out` is the sold-out treatment for exactly
                        that reason. See the rule in `globals.css`.
                      */
                      className={`object-cover ${
                        i.painted ? `painted ${soldOut ? 'painted-out' : ''}` : ''
                      }`}
                    />
                  )}

                  <div className="absolute inset-x-1.5 top-1.5 flex flex-wrap gap-1">
                    {soldOut ? <Chip tone="danger">Sold out</Chip> : null}
                    {undeclared ? <Chip>Not declared</Chip> : null}
                    {!soldOut && !undeclared && isLow(i) ? <Chip tone="danger">Low</Chip> : null}
                    {i.hot ? (
                      <Chip tone="hot">
                        <FlameIcon size={11} weight="fill" aria-hidden />
                        Hot
                      </Chip>
                    ) : null}
                    {!i.active ? <Chip>Off sale</Chip> : null}
                  </div>
                </div>

                <div className="px-2.5 py-2">
                  <p className="truncate text-meta font-semibold" title={i.name}>
                    {i.name}
                  </p>
                  <p className="tnum truncate text-micro text-muted">{i.priceLabel}</p>

                  <div className="mt-2">
                    <Meter
                      filled={left}
                      total={i.stockedG ?? 0}
                      tone={soldOut ? 'danger' : isLow(i) ? 'danger' : 'accent'}
                    />
                    <p className="tnum mt-1 text-micro text-muted">
                      {undeclared
                        ? 'none declared today'
                        : `${weight(left, ADMIN_LOCALE)} of ${weight(i.stockedG ?? 0, ADMIN_LOCALE)} left`}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
