import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog } from '@/db/repositories/catalog';
import { shopName } from '@/ui/shop-config';

import { PostcodeCheck } from './_components/postcode-check';
import { PriceLine, ProductTile, handlingLabel } from './_components/shop-shell';

export const metadata: Metadata = {
  title: 'Meat cut to order, delivered to your door',
  description:
    'A local butcher delivering raw, marinated and cooked-to-order meat. Per-kilogram cuts are weighed after cutting, so you pay for the piece you receive.',
};

export const revalidate = 60;

export default async function HomePage() {
  const day = await currentBusinessDay();
  const catalog = await listCatalog(day?.id ?? null);

  const today = catalog.filter((c) => c.availableG !== null && c.availableG > 0);
  const groups = [
    { key: 'RAW' as const, blurb: 'Cut for your order on the day it goes out.' },
    { key: 'MARINATED' as const, blurb: 'Prepared at the counter and ready for the pan.' },
    { key: 'COOKED_CHILLED' as const, blurb: 'Cooked, chilled and packed for easy meals.' },
    { key: 'COOKED_HOT' as const, blurb: 'Made to order and delivered in a hot-food slot.' },
  ].filter((g) => catalog.some((c) => c.handling === g.key));

  return (
    <main className="overflow-hidden">
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-[76rem] gap-10 px-4 pb-8 pt-8 sm:px-6 lg:min-h-[calc(100svh-4.5rem)] lg:grid-cols-[1.05fr_0.95fr] lg:grid-rows-[1fr_auto] lg:items-center lg:gap-x-16 lg:pb-0 lg:pt-10">
          <div className="py-4 lg:py-12">
            <h1 className="max-w-[10ch] text-[clamp(2.8rem,6vw,5.8rem)] font-semibold leading-[0.9] tracking-[-0.065em]">
              <span className="block">Fresh cuts.</span>
              <span className="mt-2 block text-accent">Local delivery.</span>
            </h1>
            <p className="mt-6 max-w-[44ch] text-lead text-muted">
              Order meat by weight. We cut it fresh and price the piece you receive.
            </p>
            <div className="mt-9 max-w-[36rem]">
              <PostcodeCheck />
            </div>
            <Link
              href="/shop"
              className="mt-6 inline-flex items-center gap-2 text-body font-semibold underline decoration-line underline-offset-4 transition-colors hover:text-accent"
            >
              Browse today&rsquo;s counter <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>

          <div className="editorial-frame relative aspect-[4/5] min-h-[25rem] overflow-hidden rounded-md bg-soft lg:aspect-[4/5] lg:max-h-[42rem]">
            <Image
              src="/images/butcher-counter-editorial.webp"
              alt="Editorial still life of a butcher counter with a cut of beef, paper, twine and a knife"
              fill
              priority
              sizes="(min-width: 1024px) 44vw, 100vw"
              className="object-cover object-[58%_center]"
            />
          </div>

          <div className="grid border-t border-line lg:col-span-2 lg:grid-cols-3">
            {[
              ['Cut after you order', 'Nothing is portioned days in advance.'],
              ['Weighed at the counter', 'Per-kilogram totals follow the actual cut.'],
              ['Delivered locally', 'Short routes, chosen time slots, no collection.'],
            ].map(([title, copy], index) => (
              <div
                key={title}
                className={`py-5 lg:px-6 ${index === 0 ? 'lg:pl-0' : 'border-t border-line lg:border-l lg:border-t-0'}`}
              >
                <p className="text-body font-semibold">{title}</p>
                <p className="mt-1 text-meta text-muted">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-soft py-16 sm:py-24">
        <div className="mx-auto max-w-[76rem] px-4 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:gap-16">
            <div>
              <p className="text-meta font-semibold uppercase tracking-[0.16em] text-accent">
                Today at the counter
              </p>
              <h2 className="mt-4 max-w-[14ch] text-[clamp(2.1rem,4vw,4rem)] font-semibold leading-[0.98] tracking-[-0.05em]">
                {day === null
                  ? 'The counter is resting.'
                  : today.length === 0
                    ? 'Fresh cuts, gone for today.'
                    : 'Fresh in this morning.'}
              </h2>
            </div>

            {today.length === 0 ? (
              <div className="border-l-2 border-accent pl-6 sm:pl-8 lg:self-end">
                <p className="max-w-[46ch] text-lead">
                  Stock is set fresh each trading day and never rolls over. Check again tomorrow morning.
                </p>
                <p className="mt-4 text-body text-muted">
                  The catalog stays visible so you can see what the counter usually carries.
                </p>
                <Link
                  href="/shop"
                  className="mt-6 inline-block text-body font-semibold underline underline-offset-4"
                >
                  See the full catalog
                </Link>
              </div>
            ) : (
              <ul className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 lg:-mr-[20vw]">
                {today.slice(0, 8).map((item) => (
                  <li key={item.id} className="w-[17rem] shrink-0 snap-start">
                    <Link href={`/p/${item.slug}`} className="group block">
                      <ProductTile name={item.name} handling={item.handling} />
                      <div className="mt-3">
                        <p className="font-semibold group-hover:text-accent">{item.name}</p>
                        <PriceLine pricing={item.pricing} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="bg-accent-solid py-16 text-accent-solid-ink sm:py-24">
        <div className="mx-auto grid max-w-[76rem] gap-14 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-24">
          <div>
            <p className="max-w-[14ch] text-[clamp(2.2rem,4.5vw,4.6rem)] font-semibold leading-[0.95] tracking-[-0.055em]">
              No guesswork after the knife comes down.
            </p>
            <Link
              href="/how-weighing-works"
              className="mt-8 inline-block text-body font-semibold underline decoration-white/40 underline-offset-4"
            >
              How weighing and payment work
            </Link>
          </div>
          <div className="self-end">
            {[
              ['Choose', 'Order the approximate weight you need. The basket marks it as an estimate.'],
              ['Cut', 'The butcher prepares your order, then records the weight of the piece.'],
              ['Pay', 'For now, payment is on delivery and follows that final weight.'],
            ].map(([title, copy]) => (
              <div key={title} className="grid gap-2 border-t border-white/30 py-6 sm:grid-cols-[8rem_1fr]">
                <h3 className="text-lead font-semibold">{title}</h3>
                <p className="max-w-[48ch] text-body text-white/75">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {groups.length > 0 ? (
        <section className="mx-auto max-w-[76rem] px-4 py-16 sm:px-6 sm:py-24">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <h2 className="max-w-[16ch] text-[clamp(2rem,4vw,3.8rem)] font-semibold leading-[0.98] tracking-[-0.05em]">
                The counter changes. The standard does not.
              </h2>
            </div>
            <Link href="/shop" className="text-body font-semibold underline underline-offset-4">
              Shop everything
            </Link>
          </div>
          <div className="mt-10 grid border-l border-t border-line md:grid-cols-2">
            {groups.map((group) => (
              <Link
                key={group.key}
                href={`/shop#${group.key.toLowerCase()}`}
                className="group min-h-56 border-b border-r border-line p-6 transition-colors hover:bg-soft sm:p-8"
              >
                <div className="flex h-full flex-col justify-between gap-12">
                  <span aria-hidden="true" className="text-meta text-muted transition-transform group-hover:translate-x-1">
                    &rarr;
                  </span>
                  <div>
                    <h3 className="text-[clamp(1.6rem,3vw,2.6rem)] font-semibold tracking-[-0.04em]">
                      {handlingLabel(group.key)}
                    </h3>
                    <p className="mt-3 max-w-[36ch] text-body text-muted">{group.blurb}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="border-y border-line bg-soft py-16 sm:py-24">
        <div className="mx-auto grid max-w-[76rem] gap-10 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:gap-24">
          <h2 className="max-w-[14ch] text-[clamp(2.3rem,5vw,5rem)] font-semibold leading-[0.92] tracking-[-0.06em]">
            Close enough for same-day care.
          </h2>
          <div>
            <p className="max-w-[48ch] text-lead">
              We deliver inside a small local radius, in a time slot you choose at checkout.
            </p>
            <p className="mt-4 max-w-[48ch] text-body text-muted">
              Hot food only appears in slots where we can keep it hot. That is a food-safety rule.
            </p>
            <Link href="/delivery" className="mt-7 inline-block text-body font-semibold underline underline-offset-4">
              See where we deliver
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[76rem] px-4 py-16 sm:px-6 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-24">
          <p className="max-w-[15ch] text-[clamp(2.2rem,4.5vw,4.6rem)] font-semibold leading-[0.96] tracking-[-0.055em]">
            A real counter, not a warehouse aisle.
          </p>
          <div className="space-y-8 border-l border-line pl-6 sm:pl-8">
            <div>
              <h2 className="text-lead font-semibold">One shop</h2>
              <p className="mt-2 max-w-[48ch] text-body text-muted">
                {shopName()} lists what is physically available that morning. When it sells out, it comes off the day.
              </p>
            </div>
            <div>
              <h2 className="text-lead font-semibold">One honest total</h2>
              <p className="mt-2 max-w-[48ch] text-body text-muted">
                Per-kilogram items are cut after you order. The final price follows the piece you actually receive.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
