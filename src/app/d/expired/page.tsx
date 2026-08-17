import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { GeistMono } from 'geist/font/mono';

import '../../globals.css';

/**
 * Where a link that will not work sends the driver.
 *
 * ⚠ ONE MESSAGE FOR EVERY CAUSE — expired, never existed, driver removed from
 * the roster, sessions not configured. The person reading this is standing
 * beside a van, and the action is identical in all four cases: sign in with
 * your number. Splitting them would add words without adding a choice.
 *
 * ⭐ IT IS A STATIC SEGMENT SITTING BESIDE A DYNAMIC ONE (`/d/[token]`), and
 * Next resolves the static one first. That is safe here because a real token is
 * 43 base64url characters and can never be the word `expired`.
 *
 * Its own root layout, because it must render for somebody with no session and
 * no account.
 */

export const metadata: Metadata = {
  title: 'Link expired',
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

export default function DriverLinkExpiredPage() {
  return (
    <html lang="en-CA">
      <body className={GeistMono.variable}>
        <main className="mx-auto grid min-h-[100dvh] max-w-[26rem] content-center gap-5 px-4 py-16">
          <h1 className="!text-display">Link no longer works</h1>
          <p className="text-body text-muted">
            Delivery links stop working 12 hours after the shop sends them. Sign in with your phone
            number instead — your jobs will be there.
          </p>
          <Link
            href="/driver"
            className="tap-lg flex w-full items-center justify-center rounded-sm bg-accent px-4 text-lead font-semibold text-accent-ink active:scale-[0.99]"
          >
            Sign in with my number
          </Link>
        </main>
      </body>
    </html>
  );
}
