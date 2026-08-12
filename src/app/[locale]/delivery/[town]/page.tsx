import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog } from '@/db/repositories/catalog';
import { deliveryTowns, shopName, siteOrigin } from '@/ui/shop-config';

import { PostcodeCheck } from '../../_components/postcode-check';

/**
 * The "butcher near me" surface.
 *
 * 🔴 THE DOORWAY-PAGE RISK IS REAL AND THIS FILE DOES NOT SOLVE IT.
 *
 * A set of pages differing only by a place name is what the doorway-page
 * guidance targets, and generating one per town from a list is the fastest
 * route to that penalty. `04-PLAN` §10.5 is the rule: each town page must
 * carry materially unique content, the streets and landmarks actually served,
 * that town's slots and cut-offs and its fee. A town that cannot sustain that
 * is a SECTION on `/delivery`, not a route of its own.
 *
 * What is here is the shell plus the one genuinely per-town fact available
 * today, which is live availability. **Do not expand `DELIVERY_TOWNS` until
 * the real per-town copy exists** (blocked on DQ-1 and DQ-3).
 */
export async function generateStaticParams() {
  return deliveryTowns().map((t) => ({ town: t.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ town: string }>;
}): Promise<Metadata> {
  const { town } = await params;
  const found = deliveryTowns().find((t) => t.slug === town);
  if (found === undefined) return { title: 'Not found' };

  return {
    title: `Butcher delivering to ${found.name}`,
    description: `${shopName()} delivers meat cut to order to ${found.name}. Per-kilogram cuts are weighed and charged at the exact amount.`,
    alternates: { canonical: `${siteOrigin()}/delivery/${found.slug}` },
  };
}

export const revalidate = 60;

export default async function TownPage({ params }: { params: Promise<{ town: string }> }) {
  const { town } = await params;
  const found = deliveryTowns().find((t) => t.slug === town);
  if (found === undefined) notFound();

  const day = await currentBusinessDay();
  const catalog = await listCatalog(day?.id ?? null);
  const available = catalog.filter((c) => c.availableG !== null && c.availableG > 0);

  return (
    <main className="mx-auto max-w-[46rem] px-4 py-12">
      <h1 className="text-display font-semibold tracking-tight">Meat delivered to {found.name}</h1>
      <p className="mt-4 max-w-[60ch] text-lead text-muted">
        {shopName()} cuts to order and delivers to {found.name}. You are charged the weight you
        actually get, not an estimate.
      </p>

      <div className="mt-8">
        <PostcodeCheck />
      </div>

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="text-section font-semibold tracking-tight">On the counter today</h2>
        <p className="mt-3 text-body text-muted">
          {available.length === 0
            ? 'Nothing is out at the moment. Stock goes up each trading morning.'
            : `${available.length} ${available.length === 1 ? 'item' : 'items'} available for delivery to ${found.name} today.`}
        </p>
      </section>
    </main>
  );
}
