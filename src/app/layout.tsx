import type { Metadata, Viewport } from 'next';

import './globals.css';

/**
 * The shared shell. Deliberately almost empty: the storefront and the console
 * are different products that happen to share a token layer, so the chrome
 * belongs to their group layouts, not here.
 *
 * The brand's two faces, Bodoni Moda and Manrope, are declared as `@font-face`
 * in `globals.css` against woff2 files in `public/fonts`. They are NOT loaded
 * through `next/font` because they are also referenced from plain CSS, and a
 * face that exists under two names is a face that gets loaded twice.
 *
 * Both are preloaded below. Bodoni is in the LCP path on every page: it sets
 * every heading, so leaving it to be discovered by the CSS parser costs a
 * visible reflow on the slowest connections the shop actually serves.
 *
 * Geist Mono is still loaded inside the admin route only.
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
    { media: '(prefers-color-scheme: light)', color: '#f4f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#031923' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA">
      <head>
        <link
          rel="preload"
          href="/fonts/manrope-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/bodoni-moda-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
