import type { Metadata } from 'next';
import Link from 'next/link';

import { deliveryTowns, shopName, siteOrigin } from '@/ui/shop-config';

import { PostcodeCheck } from '../_components/postcode-check';

export const metadata: Metadata = {
  title: 'Where we deliver',
  description:
    'We deliver within a local radius only, in time slots you choose at checkout. Check your postal code.',
  alternates: { canonical: `${siteOrigin()}/delivery` },
};

export default function DeliveryPage() {
  const towns = deliveryTowns();

  return (
    <main className="mx-auto max-w-[46rem] px-4 py-12">
      <h1 className="text-display font-semibold tracking-tight">Where we deliver</h1>
      <p className="mt-4 max-w-[60ch] text-lead text-muted">
        {shopName()} is one shop with one counter. We deliver within a local radius and there is no
        collection point.
      </p>

      <div className="mt-8">
        <PostcodeCheck />
      </div>

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="text-section font-semibold tracking-tight">Delivery times</h2>
        <p className="mt-3 max-w-[60ch] text-body text-muted">
          You choose a time slot at checkout. Each slot has a cut-off, after which it stops being
          offered, and a limited number of deliveries.
        </p>
        <p className="mt-3 max-w-[60ch] text-body text-muted">
          If your basket contains anything cooked hot, only the slots we can get it to you hot in
          are offered. That is a food-safety rule rather than a scheduling preference.
        </p>
      </section>

      {towns.length > 0 ? (
        <section className="mt-8 border-t border-line pt-8">
          <h2 className="text-section font-semibold tracking-tight">Areas we cover</h2>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {towns.map((town) => (
              <li key={town.slug}>
                <Link
                  href={`/delivery/${town.slug}`}
                  className="text-body underline underline-offset-4"
                >
                  {town.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
