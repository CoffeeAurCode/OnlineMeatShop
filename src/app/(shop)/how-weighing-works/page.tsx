import type { Metadata } from 'next';
import Link from 'next/link';

import { siteOrigin } from '@/ui/shop-config';

/**
 * The trust page the whole business model rests on.
 *
 * Deliberately NOT "Step 1 / Step 2 / Step 3": the action is the heading, and
 * numbered stage labels are filler that pushes the content down the page.
 */
export const metadata: Metadata = {
  title: 'How weighing and charging work',
  description:
    'Per-kilogram meat is cut after you order. We hold an estimate, weigh the cut, and charge the exact amount. Never more than the hold.',
  alternates: { canonical: `${siteOrigin()}/how-weighing-works` },
};

export default function HowWeighingWorksPage() {
  return (
    <main className="mx-auto max-w-[46rem] px-4 py-12">
      <h1 className="text-display font-semibold tracking-tight">How weighing and charging work</h1>
      <p className="mt-4 max-w-[60ch] text-lead text-muted">
        Meat sold by the kilogram cannot be priced exactly until it has been cut. Here is what
        happens to your money in between.
      </p>

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="text-section font-semibold tracking-tight">You order a weight</h2>
        <p className="mt-3 max-w-[60ch] text-body text-muted">
          You pick roughly how much you want. Because nothing has been cut yet, what you see is an
          estimate, and we label it as one everywhere it appears.
        </p>
      </section>

      <section className="mt-8 border-t border-line pt-8">
        <h2 className="text-section font-semibold tracking-tight">We hold, we do not charge</h2>
        <p className="mt-3 max-w-[60ch] text-body text-muted">
          Your card is authorised for a little over the estimate. An authorisation is not a charge:
          no money leaves your account, and if the order does not go ahead the hold is released.
        </p>
      </section>

      <section className="mt-8 border-t border-line pt-8">
        <h2 className="text-section font-semibold tracking-tight">We cut it, then weigh it</h2>
        <p className="mt-3 max-w-[60ch] text-body text-muted">
          A hand-cut piece is never exactly the weight you asked for. If it lands within ten percent
          either way, that is the cut you ordered and we carry on. If it is further out, we ring you
          and ask before charging anything. We cannot decide on your behalf that you are buying more
          meat than you wanted.
        </p>
      </section>

      <section className="mt-8 border-t border-line pt-8">
        <h2 className="text-section font-semibold tracking-tight">We charge the exact amount</h2>
        <p className="mt-3 max-w-[60ch] text-body text-muted">
          The final charge is the weight you actually got, at the price per kilogram you saw. If the
          cut came out lighter you pay less. It is never more than the hold.
        </p>
      </section>

      <section className="mt-8 border-t border-line pt-8">
        <h2 className="text-section font-semibold tracking-tight">Fixed-price packs</h2>
        <p className="mt-3 max-w-[60ch] text-body text-muted">
          Anything sold as a pack has one price and is never re-priced. Only items sold by the
          kilogram are weighed.
        </p>
      </section>

      <Link href="/shop" className="mt-12 inline-block text-body underline underline-offset-4">
        See what we have today
      </Link>
    </main>
  );
}
