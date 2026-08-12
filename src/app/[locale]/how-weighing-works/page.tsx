import type { Metadata } from 'next';
import Link from 'next/link';

import { siteOrigin } from '@/ui/shop-config';

export const metadata: Metadata = {
  title: 'How weighing and payment work',
  description:
    'Per-kilogram meat is cut after you order, weighed at the counter, and paid for at the exact final weight on delivery.',
  alternates: { canonical: `${siteOrigin()}/how-weighing-works` },
};

export default function HowWeighingWorksPage() {
  return (
    <main>
      <section className="border-b border-line bg-soft">
        <div className="mx-auto max-w-[60rem] px-4 py-16 sm:px-6 sm:py-24">
          <h1 className="max-w-[12ch] text-[clamp(2.7rem,6vw,5.8rem)] font-semibold leading-[0.92] tracking-[-0.06em]">
            How weighing and payment work
          </h1>
          <p className="mt-6 max-w-[52ch] text-lead text-muted">
            Meat sold by the kilogram cannot have a final price until the butcher has made the cut.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[60rem] px-4 py-14 sm:px-6 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-[0.65fr_1.35fr] lg:gap-20">
          <p className="text-meta font-semibold uppercase tracking-[0.16em] text-accent">At the counter</p>
          <div>
            {[
              [
                'You order a weight',
                'Pick roughly how much you want. Because nothing has been cut yet, the basket labels the price as an estimate.',
              ],
              [
                'We cut, then weigh',
                'A hand-cut piece is rarely exact. If it lands within ten percent either way, the butcher records that weight. If it is further out, the shop calls before continuing.',
              ],
              [
                'You pay for the piece',
                'Card payment is not connected yet. Orders placed now are pay on delivery, and the amount follows the final recorded weight.',
              ],
              [
                'Fixed-price packs stay fixed',
                'Anything sold as a pack keeps one price. Only items sold by the kilogram are repriced after weighing.',
              ],
            ].map(([title, copy]) => (
              <div key={title} className="border-t border-line py-8 first:pt-0">
                <h2 className="text-section font-semibold tracking-tight">{title}</h2>
                <p className="mt-3 max-w-[58ch] text-body text-muted">{copy}</p>
              </div>
            ))}
            <Link href="/shop" className="mt-4 inline-block text-body font-semibold underline underline-offset-4">
              See what we have today
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
