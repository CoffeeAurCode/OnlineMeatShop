import Link from 'next/link';
import type { Metadata } from 'next';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog } from '@/db/repositories/catalog';
import { shopName } from '@/ui/shop-config';

import { PostcodeCheck } from './_components/postcode-check';
import { PriceLine, ProductTile, handlingLabel } from './_components/shop-shell';

/**
 * The home page.
 *
 * Six sections, six DIFFERENT layout families (`04-PLAN` §10.1). That rule is
 * what stops this reading as a template: eight variations on image-left,
 * text-right is the shape every generated storefront lands in.
 *
 * Eyebrow budget: 2, and only one is spent (the hero has none).
 *
 * Availability is rendered server-side into the HTML. It is the whole reason
 * this is a Next.js app rather than a static site, and it is also the reason
 * this page cannot be cached for long: what is on the counter changes during
 * the day.
 */

export const metadata: Metadata = {
  title: 'Meat cut to order, delivered to your door',
  description:
    'A local butcher delivering raw, marinated and cooked-to-order meat. Per-kilogram cuts are weighed after cutting and you are charged the exact amount.',
};

// Availability in the HTML is the point; a stale cache would undo it. Sixty
// seconds is short enough that a sell-out is visible quickly and long enough
// that a burst of traffic does not become a burst of queries.
export const revalidate = 60;

export default async function HomePage() {
  const day = await currentBusinessDay();
  const catalog = await listCatalog(day?.id ?? null);

  const today = catalog.filter((c) => c.availableG !== null && c.availableG > 0);
  const groups = [
    { key: 'RAW' as const, blurb: 'Cut to your order, the day it goes out.' },
    { key: 'MARINATED' as const, blurb: 'Prepared here, ready for the pan.' },
    { key: 'COOKED_CHILLED' as const, blurb: 'Cooked, chilled and packed.' },
    { key: 'COOKED_HOT' as const, blurb: 'Made to order and sent out hot.' },
  ].filter((g) => catalog.some((c) => c.handling === g.key));

  return (
    <main>
      {/* ── 1. Hero: asymmetric split ─────────────────────────────────── */}
      <section className="mx-auto grid max-w-[68rem] gap-10 px-4 pt-12 pb-16 lg:grid-cols-[7fr_5fr] lg:items-center lg:pt-20">
        <div>
          <h1 className="text-display font-semibold tracking-tight lg:text-[2.75rem] lg:leading-[1.05]">
            Meat cut to order, delivered to your door
          </h1>
          <p className="mt-4 max-w-[46ch] text-lead text-muted">
            We cut it after you order, weigh it, and charge you the exact amount.
          </p>
          {/* The first question anyone has about a delivery-only shop. */}
          <div className="mt-8">
            <PostcodeCheck />
          </div>
        </div>

        <div className="lg:pl-4">
          <ProductTile
            name={today[0]?.name ?? 'Today’s counter'}
            handling={today[0]?.handling ?? 'RAW'}
            ratio="wide"
          />
        </div>
      </section>

      {/* ── 2. Today's counter: horizontal scroll-snap ────────────────── */}
      <section className="border-y border-line bg-raised py-12">
        <div className="mx-auto max-w-[68rem] px-4">
          <p className="text-meta font-semibold uppercase tracking-[0.14em] text-muted">
            On the counter today
          </p>
          <h2 className="mt-2 text-section font-semibold tracking-tight">
            {day === null
              ? 'The shop is not taking orders right now'
              : today.length === 0
                ? 'Everything has gone for today'
                : 'Fresh in this morning'}
          </h2>

          {today.length === 0 ? (
            <p className="mt-3 max-w-[60ch] text-body text-muted">
              Stock is set fresh every trading day and nothing carries over. Check back tomorrow
              morning.
            </p>
          ) : (
            <ul className="mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2">
              {today.slice(0, 8).map((item) => (
                <li key={item.id} className="w-56 shrink-0 snap-start">
                  <Link href={`/p/${item.slug}`}>
                    <ProductTile name={item.name} handling={item.handling} />
                    <div className="mt-3">
                      <PriceLine pricing={item.pricing} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── 3. How the exact charge works: three-up, verb headings ────── */}
      <section className="mx-auto max-w-[68rem] px-4 py-16">
        <h2 className="max-w-[22ch] text-section font-semibold tracking-tight">
          Why your card is never charged more than you agreed
        </h2>
        <div className="mt-8 grid gap-8 sm:grid-cols-3">
          <div>
            <h3 className="text-body font-semibold">Order by weight</h3>
            <p className="mt-2 text-body text-muted">
              You choose how much you want. We show an estimate, because nothing has been cut yet.
            </p>
          </div>
          <div>
            <h3 className="text-body font-semibold">We hold the estimate</h3>
            <p className="mt-2 text-body text-muted">
              Your card is authorised, not charged. No money leaves your account at this point.
            </p>
          </div>
          <div>
            <h3 className="text-body font-semibold">We charge the exact weight</h3>
            <p className="mt-2 text-body text-muted">
              After cutting and weighing, we charge what it actually came to. Never more than the
              hold.
            </p>
          </div>
        </div>
        <Link href="/how-weighing-works" className="mt-8 inline-block text-body underline underline-offset-4">
          How weighing and charging work
        </Link>
      </section>

      {/* ── 4. Categories: asymmetric grid ────────────────────────────── */}
      {groups.length > 0 ? (
        <section className="mx-auto max-w-[68rem] px-4 pb-16">
          <h2 className="text-section font-semibold tracking-tight">What we sell</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {groups.map((group, i) => (
              <Link
                key={group.key}
                href={`/shop#${group.key.toLowerCase()}`}
                // The first tile is deliberately wider than the rest: an even
                // three-across grid is the shape this page is trying not to be.
                className={`rounded-md border border-line bg-raised p-5 ${
                  i === 0 ? 'md:col-span-2' : ''
                }`}
              >
                <p className="text-lead font-semibold tracking-tight">{handlingLabel(group.key)}</p>
                <p className="mt-2 text-body text-muted">{group.blurb}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── 5. Delivery and slots: full-width tinted band ─────────────── */}
      <section className="border-y border-line bg-raised py-16">
        <div className="mx-auto max-w-[68rem] px-4">
          <h2 className="text-section font-semibold tracking-tight">Delivery</h2>
          <div className="mt-4 grid gap-8 md:grid-cols-2">
            <p className="max-w-[60ch] text-body text-muted">
              We deliver within a local radius only, in time slots you choose at checkout. There is
              no shop counter to collect from.
            </p>
            <p className="max-w-[60ch] text-body text-muted">
              If your basket has anything cooked hot, only the slots we can get it to you hot in are
              offered. That is a food-safety rule, not an arbitrary limit.
            </p>
          </div>
          <Link href="/delivery" className="mt-6 inline-block text-body underline underline-offset-4">
            Where we deliver
          </Link>
        </div>
      </section>

      {/* ── 6. Trust: two-column prose, no cards, no icons ────────────── */}
      <section className="mx-auto max-w-[68rem] px-4 py-16">
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <h2 className="text-section font-semibold tracking-tight">One shop, one counter</h2>
            <p className="mt-3 max-w-[60ch] text-body text-muted">
              {shopName()} is a single butcher shop, not a warehouse. What we list is what is
              physically on the counter that morning, which is why the shop sells out and why
              nothing rolls over to the next day.
            </p>
          </div>
          <div>
            <h2 className="text-section font-semibold tracking-tight">Cut when you order it</h2>
            <p className="mt-3 max-w-[60ch] text-body text-muted">
              Per-kilogram items are cut after your order arrives, not portioned in advance. That is
              why the amount at checkout is an estimate, and why the final charge is the weight of
              the piece you actually get.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
