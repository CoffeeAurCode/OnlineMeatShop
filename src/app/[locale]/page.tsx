/* eslint-disable @next/next/no-img-element -- runtime image optimisation is disabled, so this page supplies pre-sized responsive derivatives directly */
import Link from 'next/link';
import type { Metadata } from 'next';

import { currentBusinessDay } from '@/db/repositories/availability';
import { listCatalog } from '@/db/repositories/catalog';
import { shopName } from '@/ui/shop-config';

import { PostcodeCheck } from './_components/postcode-check';
import { PriceLine, ProductTile, handlingLabel } from './_components/shop-shell';

export const metadata: Metadata = {
  title: 'Fresh meat, cut to order and delivered locally',
  description:
    'Fresh cuts from a local butcher, delivered to your door. Per-kilogram orders are weighed after cutting, so the final price follows the piece you receive.',
};

export const revalidate = 60;

const heroSrcSet =
  '/images/hero-butcher-wrap-480.webp 480w, /images/hero-butcher-wrap-960.webp 960w, /images/hero-butcher-wrap-1440.webp 1440w';
const weighingSrcSet =
  '/images/weighing-parcel-480.webp 480w, /images/weighing-parcel-960.webp 960w, /images/weighing-parcel-1440.webp 1440w';

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
      <section className="hero-stage border-b border-line">
        <div className="relative mx-auto grid max-w-[82rem] gap-9 px-4 pb-8 pt-6 sm:px-6 sm:pt-8 lg:min-h-[calc(100dvh-4.5rem)] lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:gap-12 lg:px-8 lg:pb-10 lg:pt-10">
          <div className="hero-copy flex min-h-[clamp(32rem,calc(100dvh-7rem),44rem)] flex-col py-3 lg:block lg:min-h-0 lg:py-10">
            <p className="hero-kicker text-meta font-semibold uppercase tracking-[0.16em] text-accent">
              Cut today. At your door next.
            </p>
            <h1 className="mt-5 text-[clamp(2.65rem,5.1vw,5rem)] font-semibold leading-[0.88] tracking-[-0.07em]">
              <span className="block whitespace-nowrap">Fresh cuts.</span>
              <span className="mt-2 block whitespace-nowrap text-accent">Delivered close.</span>
            </h1>
            <p className="mt-6 max-w-[38ch] text-lead text-muted">
              Choose the cut. We prepare it fresh, weigh it honestly and bring it home.
            </p>
            <div className="mt-8 max-w-[36rem]">
              <PostcodeCheck />
            </div>
            <Link href="/shop" className="arrow-link mt-auto inline-flex w-fit items-center gap-3 pt-6 text-body font-semibold lg:mt-6 lg:pt-0">
              Shop <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>

          <div className="hero-media editorial-frame absolute bottom-40 right-4 size-40 min-h-0 overflow-hidden rounded-md bg-raised sm:bottom-8 sm:right-6 sm:size-56 sm:min-h-0 lg:relative lg:h-[min(74dvh,47rem)] lg:w-auto lg:min-h-[34rem]">
            <img
              src="/images/hero-butcher-wrap-960.webp"
              srcSet={heroSrcSet}
              sizes="(min-width: 1024px) 48vw, 100vw"
              width="1440"
              height="960"
              alt="A butcher wrapping a fresh marbled roast in white paper at a stainless counter"
              fetchPriority="high"
              loading="eager"
              decoding="sync"
              className="hero-media-image absolute inset-0 size-full object-cover object-[55%_center]"
            />
          </div>
        </div>
      </section>

      <section className="fact-marquee border-b border-line bg-raised" aria-label="What makes the service different">
        <div className="fact-marquee-track">
          {[0, 1].map((copy) => (
            <div key={copy} className="fact-marquee-group" aria-hidden={copy === 1}>
              <span>Cut after you order</span>
              <span>Weighed at the counter</span>
              <span>Stock set every morning</span>
              <span>Delivered in local time slots</span>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-soft py-16 sm:py-24">
        <div className="reveal-section mx-auto max-w-[82rem] px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
            <div>
              <p className="text-meta font-semibold uppercase tracking-[0.16em] text-accent">Today at the counter</p>
              <h2 className="mt-4 max-w-[12ch] text-[clamp(2.35rem,4.8vw,4.8rem)] font-semibold leading-[0.94] tracking-[-0.06em] text-balance">
                {day === null
                  ? 'The counter is resting.'
                  : today.length === 0
                    ? 'Fresh cuts, gone for today.'
                    : 'Fresh in this morning.'}
              </h2>
              <p className="mt-5 max-w-[32ch] text-body text-muted">
                The selection follows what is genuinely ready to cut, not a warehouse feed.
              </p>
            </div>

            {today.length === 0 ? (
              <div className="self-end border-l-2 border-accent pl-6 sm:pl-8">
                <p className="max-w-[42ch] text-lead">
                  Stock is set fresh each trading day and never rolls over. Check again tomorrow morning.
                </p>
                <Link href="/shop" className="arrow-link mt-7 inline-flex items-center gap-3 text-body font-semibold">
                  Shop <span aria-hidden="true">&rarr;</span>
                </Link>
              </div>
            ) : (
              <ul className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 lg:-mr-[14vw]">
                {today.slice(0, 8).map((item) => (
                  <li key={item.id} className="w-[17rem] shrink-0 snap-start">
                    <Link href={`/p/${item.slug}`} className="group block">
                      <ProductTile name={item.name} handling={item.handling} />
                      <div className="mt-3">
                        <p className="font-semibold transition-colors group-hover:text-accent">{item.name}</p>
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
        <div className="reveal-section mx-auto max-w-[82rem] px-4 sm:px-6 lg:px-8">
          <div className="max-w-[58rem]">
            <h2 className="max-w-[14ch] text-[clamp(2.5rem,5.5vw,5.6rem)] font-semibold leading-[0.9] tracking-[-0.065em] text-balance">
              The scale makes the final call.
            </h2>
            <p className="mt-6 max-w-[48ch] text-lead text-white/78">
              Per-kilogram orders stay estimated until your exact cut is prepared and weighed.
            </p>
          </div>

          <div className="process-media mt-10 overflow-hidden rounded-md bg-raised sm:mt-14">
            <img
              src="/images/weighing-parcel-960.webp"
              srcSet={weighingSrcSet}
              sizes="(min-width: 1280px) 1280px, 100vw"
              width="1440"
              height="1080"
              alt="A butcher placing a white wrapped parcel on a stainless counter scale"
              loading="lazy"
              decoding="async"
              className="h-full min-h-[22rem] w-full object-cover object-center sm:aspect-[16/7]"
            />
          </div>

          <div className="process-steps grid border-t border-white/30 md:grid-cols-[0.85fr_1.25fr_0.9fr]">
            {[
              ['Choose', 'Order the approximate weight and preparation you need.'],
              ['We cut and weigh', 'The butcher prepares your order, then records the exact weight at the counter.'],
              ['Pay on delivery', 'For now, the final total follows that recorded weight.'],
            ].map(([title, copy], index) => (
              <div key={title} className={`py-6 md:px-7 ${index > 0 ? 'border-t border-white/30 md:border-l md:border-t-0' : ''}`}>
                <h3 className="text-section font-semibold">{title}</h3>
                <p className="mt-3 max-w-[36ch] text-body text-white/75">{copy}</p>
              </div>
            ))}
          </div>
          <Link href="/how-weighing-works" className="arrow-link arrow-link-light mt-8 inline-flex items-center gap-3 text-body font-semibold">
            How weighing and payment work <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </section>

      {groups.length > 0 ? (
        <section className="reveal-section mx-auto max-w-[82rem] px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div className="max-w-[56rem]">
            <h2 className="max-w-[15ch] text-[clamp(2.35rem,4.8vw,4.8rem)] font-semibold leading-[0.94] tracking-[-0.06em] text-balance">
              The counter changes. The standard does not.
            </h2>
            <p className="mt-5 max-w-[46ch] text-lead text-muted">
              From raw cuts to hot food, each category follows the handling it actually needs.
            </p>
          </div>
          <div
            className={`category-grid mt-10 grid gap-3 ${groups.length > 1 ? 'md:grid-cols-2' : ''} lg:grid-cols-12 ${groups.length >= 3 ? 'lg:grid-rows-2' : ''}`}
          >
            {groups.map((group, index) => {
              const layout = categoryLayout(index, groups.length);

              return (
                <Link
                  key={group.key}
                  href={`/shop#${group.key.toLowerCase()}`}
                  className={`category-cell group relative min-h-64 overflow-hidden rounded-md border border-line bg-raised p-6 transition-[transform,border-color,background-color] duration-300 hover:-translate-y-1 hover:border-accent hover:bg-soft sm:p-8 ${layout}`}
                >
                  <span aria-hidden="true" className="category-letter">
                    {handlingLabel(group.key).charAt(0)}
                  </span>
                  <div className="relative flex h-full flex-col justify-between gap-14">
                    <span className="category-arrow self-end text-section" aria-hidden="true">&rarr;</span>
                    <div>
                      <h3 className="max-w-[12ch] text-[clamp(1.7rem,3vw,3.2rem)] font-semibold leading-[0.96] tracking-[-0.045em]">
                        {handlingLabel(group.key)}
                      </h3>
                      <p className="mt-4 max-w-[34ch] text-body text-muted">{group.blurb}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
          <Link href="/shop" className="arrow-link mt-8 inline-flex items-center gap-3 text-body font-semibold">
            Shop <span aria-hidden="true">&rarr;</span>
          </Link>
        </section>
      ) : null}

      <section className="delivery-callout border-y border-line bg-soft py-20 sm:py-28">
        <div className="reveal-section mx-auto max-w-[82rem] px-4 text-center sm:px-6 lg:px-8">
          <h2 className="mx-auto max-w-[16ch] text-[clamp(2.7rem,6vw,6.4rem)] font-semibold leading-[0.9] tracking-[-0.07em] text-balance">
            A shorter route makes a better delivery.
          </h2>
          <p className="mx-auto mt-7 max-w-[48ch] text-lead text-muted">
            We stay local, offer clear time slots and reserve hot-food windows for safe delivery.
          </p>
          <Link href="/delivery" className="primary-link mt-9 inline-flex items-center justify-center gap-3 rounded-sm bg-accent-solid px-6 py-3.5 text-body font-semibold text-accent-solid-ink">
            Delivery <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </section>

      <section className="reveal-section mx-auto max-w-[82rem] px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_0.8fr] lg:gap-24">
          <p className="max-w-[14ch] text-[clamp(2.35rem,4.8vw,4.8rem)] font-semibold leading-[0.94] tracking-[-0.06em] text-balance">
            One real counter. One honest total.
          </p>
          <div className="space-y-9 border-l border-line pl-6 sm:pl-8">
            <div>
              <h2 className="text-lead font-semibold">What is ready today</h2>
              <p className="mt-2 max-w-[46ch] text-body text-muted">
                {shopName()} lists what is physically available that morning. When it sells out, it leaves the day&rsquo;s counter.
              </p>
            </div>
            <div>
              <h2 className="text-lead font-semibold">What you actually receive</h2>
              <p className="mt-2 max-w-[46ch] text-body text-muted">
                Per-kilogram items are cut after you order. The final price follows the piece that arrives at your door.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function categoryLayout(index: number, count: number): string {
  if (count === 1) return 'lg:col-span-12 lg:min-h-[22rem]';
  if (count === 2) return index === 0 ? 'lg:col-span-7 lg:min-h-[24rem]' : 'lg:col-span-5 lg:min-h-[24rem]';
  if (count === 3) {
    return index === 0
      ? 'lg:col-span-7 lg:row-span-2 lg:min-h-[31rem]'
      : 'lg:col-span-5 lg:min-h-[15rem]';
  }

  return [
    'lg:col-span-7 lg:row-span-2 lg:min-h-[31rem]',
    'lg:col-span-5 lg:min-h-[15rem]',
    'lg:col-span-5 lg:min-h-[15rem]',
    'lg:col-span-7 lg:min-h-[15rem]',
  ][index] ?? 'lg:col-span-5 lg:min-h-[15rem]';
}
