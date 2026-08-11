import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';

import './globals.css';

/**
 * The shared shell. Deliberately almost empty: the storefront and the console
 * are different products that happen to share a token layer, so the chrome
 * belongs to their group layouts, not here.
 *
 * Fonts are self-hosted through the `geist` package rather than fetched from
 * Google at build time — one less network dependency in a build that already
 * has enough of them, and no third-party request in the LCP path.
 *
 * Geist Mono is loaded inside the admin route only. The storefront gets
 * tabular figures out of the sans face, because a second font file in the
 * storefront's LCP path buys nothing that `font-variant-numeric` does not.
 */

export const metadata: Metadata = {
  // Per-page titles fill the template. `04-PLAN` §5: no template defaults ship.
  title: {
    default: 'Fresh meat, cut to order, delivered',
    template: '%s',
  },
  description: 'Meat cut to order and delivered locally. You are charged the exact weight.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The console is used one-handed on a phone; a zoom lock would be hostile,
  // so `maximumScale` is deliberately not set.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f5f6' },
    { media: '(prefers-color-scheme: dark)', color: '#14181a' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA" className={GeistSans.variable}>
      <body>{children}</body>
    </html>
  );
}
