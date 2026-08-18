import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';

import { isLocale, t, type Locale } from '@/i18n';

/**
 * The money page.
 *
 * ⭐ THIS IS THE PROMISE THE SHOP MADE, written out. Every other page links to
 * it and the checkout repeats its one sentence. It exists as a page rather
 * than a tooltip because "we hold a maximum and charge the exact weight" is
 * the single most surprising thing about buying here, and a customer who does
 * not understand it reads the hold on their card as an overcharge.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const l: Locale = isLocale(locale) ? locale : 'fr';
  return {
    title: t(l, 'weighing.title'),
    description: t(l, 'weighing.intro'),
    alternates: {
      languages: {
        'en-CA': '/en/how-weighing-works',
        'fr-CA': '/fr/how-weighing-works',
      },
    },
  };
}

export default async function HowWeighingWorksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const steps = [
    ['weighing.step1Heading', 'weighing.step1Body'],
    ['weighing.step2Heading', 'weighing.step2Body'],
    ['weighing.step3Heading', 'weighing.step3Body'],
  ] as const;

  return (
    <div className="mx-auto max-w-[46rem] px-4 py-14 sm:px-6 sm:py-20">
      <h1 className="!text-display-xl">{t(locale, 'weighing.title')}</h1>
      <p className="mt-6 max-w-[56ch] text-lead text-muted">{t(locale, 'weighing.intro')}</p>

      {/*
        ⚠ ONE IMAGE, AND IT IS THE SHOP'S OWN COUNTER. §9 allows at most one
        supporting image per major section here and warns against restyling
        these explainers as promotional pages, so this is the only one on the
        page: it shows the place the weighing actually happens, which is the
        thing the words are about. Empty `alt` because the three steps below
        say everything a screen reader needs.
      */}
      <div className="relative mt-10 aspect-[16/9] w-full overflow-hidden rounded-md bg-soft">
        <Image
          src="/sherbrooke/market-counter.webp"
          alt=""
          fill
          sizes="(max-width: 767px) 100vw, 46rem"
          priority
          className="object-cover"
        />
      </div>

      {/*
        An ordered list, not three cards. The steps are a sequence and the
        numbering is the content, not decoration.
      */}
      <ol className="mt-12 grid gap-10">
        {steps.map(([heading, body], i) => (
          <li key={heading} className="grid gap-2 border-t border-line pt-6">
            <span className="tnum text-meta font-semibold text-muted">{i + 1}</span>
            <h2 className="!text-display">{t(locale, heading)}</h2>
            <p className="max-w-[58ch] text-body text-muted">{t(locale, body)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
