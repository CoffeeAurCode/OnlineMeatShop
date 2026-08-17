import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { GeistMono } from 'geist/font/mono';

import { hashDriverLinkToken } from '@/auth/driver-link';
import { peekDriverLink } from '@/db/repositories/driver';
import { activePartnerById } from '@/db/repositories/partners';

import '../../globals.css';
import { ClaimForm } from './claim-form';

/**
 * The landing page for the link in a dispatch SMS.
 *
 * ⭐ IT LIVES OUTSIDE `/driver`, AND IT HAS TO. Everything under `/driver` is
 * behind a layout that renders a sign-in form when there is no session — and a
 * link whose entire purpose is to CREATE that session cannot sit behind it.
 * `/d/` is also nine characters shorter than `/driver/link/`, which is billed:
 * the dispatch message is already three SMS segments.
 *
 * ⚠ THIS PAGE READS THE LINK. IT DOES NOT SPEND IT.
 *
 * Carriers, messaging apps and security scanners routinely GET a URL in an SMS
 * before any human sees it, to build a preview or check for malware. If this
 * render consumed the token, every one of those fetches would burn it and the
 * driver would tap a dead link on every single dispatch. So the page renders a
 * button, and the BUTTON spends it — an action a preview bot does not take.
 *
 * It is its own root layout because it must render for somebody with no
 * session, no cookie and possibly no account at all.
 */

export const metadata: Metadata = {
  title: 'Your delivery',
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#031923' },
  ],
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA">
      <body className={GeistMono.variable}>
        <main className="mx-auto grid min-h-[100dvh] max-w-[26rem] content-center gap-5 px-4 py-16">
          {children}
        </main>
      </body>
    </html>
  );
}

export default async function DriverLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = await peekDriverLink(hashDriverLinkToken(token));

  /*
   * ⚠ ONE MESSAGE FOR "SPENT", "EXPIRED" AND "NEVER EXISTED"? NO — and the
   * distinction is the opposite of the usual rule.
   *
   * A sign-in form must not distinguish its failures, because the differences
   * are useful to somebody probing the door. Here the person reading this is
   * standing beside a van and the difference tells them what to DO: an expired
   * link means sign in normally, a spent one means somebody already used it and
   * the shop should hear about that. Withholding it would protect nothing —
   * whoever holds the token already holds it — and would waste a delivery.
   */
  if (link.state !== 'valid') {
    return (
      <Shell>
        <h1 className="!text-display">
          {link.state === 'spent' ? 'Already used' : 'Link no longer works'}
        </h1>
        <p className="text-body text-muted">
          {link.state === 'spent'
            ? 'This link has already been used to sign in. If that was not you, tell the shop — ' +
              'somebody else may have the message. You can still sign in with your own number.'
            : 'Delivery links stop working 12 hours after they are sent. Sign in with your phone ' +
              'number instead and your jobs will be there.'}
        </p>
        <Link
          href="/driver"
          className="tap-lg flex w-full items-center justify-center rounded-sm bg-accent px-4 text-lead font-semibold text-accent-ink active:scale-[0.99]"
        >
          Sign in with my number
        </Link>
      </Shell>
    );
  }

  /*
   * ⚠ THE ROSTER IS CHECKED HERE TOO, before the button is even offered.
   *
   * A link minted on Tuesday for somebody taken off the roster on Wednesday
   * must not work, and `delivery_partner.active` is the single place that
   * decides. The guard re-checks it on every request afterwards as well — this
   * one just avoids showing a button that is going to refuse.
   */
  const partner = await activePartnerById(link.partnerId);
  if (partner === null) {
    return (
      <Shell>
        <h1 className="!text-display">Link no longer works</h1>
        <p className="text-body text-muted">
          This link belongs to a driver who is no longer on the shop’s list.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="!text-display">Deliveries</h1>
      <p className="text-body text-muted">
        Signing in as <span className="font-semibold text-ink">{partner.name}</span>.
      </p>
      {/*
        ⚠ THE ONE-TAP WARNING IS SAID OUT LOUD. A driver who knows the link
        dies on use is a driver who taps it themselves instead of forwarding it
        to whoever is actually driving — which is the behaviour that makes the
        single-use rule protective rather than merely annoying.
      */}
      <p className="rounded-sm border border-line bg-soft px-3 py-2 text-meta text-muted">
        This link works once and then stops. Do not forward it — if somebody else opens it first,
        you will be locked out and will have to sign in with your number.
      </p>
      <ClaimForm token={token} />
    </Shell>
  );
}
