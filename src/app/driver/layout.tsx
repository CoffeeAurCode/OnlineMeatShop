import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';

import { checkDriver, type DriverRefusalReason } from '@/app/driver-guard';

import '../globals.css';
import { SignInForm } from './_components/sign-in-form';

/**
 * The driver portal shell, and THE THIRD ROOT LAYOUT.
 *
 * It renders `<html>` for the same reason the console does: the storefront's
 * root layout lives inside `[locale]`, and this half of the app has no locale.
 * The driver portal is English only — it is one worker using a tool, and the
 * dispatch SMS it is reached from is English too.
 *
 * ⭐ THE SIGN-IN FORM LIVES IN THE LAYOUT, NOT ON A `/driver/login` PAGE.
 *
 * The link in a dispatch SMS points at a JOB. A driver who taps it with an
 * expired cookie must land on the sign-in form and then be looking at that
 * job — not be bounced to a login route that has forgotten where they were
 * going. Rendering the form in place of the page keeps the URL intact, so the
 * refresh after signing in resolves the job they were sent to.
 *
 * ⚠ Deliberately not a dashboard. A driver is holding a phone in one hand and
 * a box in the other, standing outside, possibly in the dark. Chrome is a
 * title and a way back, and nothing else.
 */

export const metadata: Metadata = {
  title: 'Deliveries',
  // Belt and braces alongside the header rules in next.config.ts. Customer
  // addresses live behind this door and none of it should ever be indexed.
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

// A job's status is point-in-time. Rendering it from a cache is how a driver
// gets told an order is still being prepared twenty minutes after it was not.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * ⚠ ONLY `notConfigured` GETS A REAL EXPLANATION. Every other refusal is a
 * failed sign-in, and the form says so without distinguishing "no session"
 * from "bad signature" from "removed from the roster" — those differences are
 * useful to somebody probing the door and to nobody else.
 */
const NEEDS_SETUP: Partial<Record<DriverRefusalReason, string>> = {
  notConfigured:
    'STAFF_SESSION_SECRET is not set, so no driver session can be signed and nobody can ' +
    'sign in. Set it to at least 32 random characters.',
};

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const gate = await checkDriver();

  if (!gate.ok) {
    const setupProblem = NEEDS_SETUP[gate.reason];

    return (
      <html lang="en-CA">
        <body className={GeistMono.variable}>
          <main className="mx-auto grid min-h-[100dvh] max-w-[26rem] content-center gap-6 px-4 py-16">
            {setupProblem === undefined ? (
              <SignInForm expired={gate.reason === 'expired'} />
            ) : (
              <>
                <h1 className="!text-display">Deliveries unavailable</h1>
                <p className="max-w-[60ch] text-body text-muted">{setupProblem}</p>
              </>
            )}
          </main>
        </body>
      </html>
    );
  }

  return (
    <html lang="en-CA">
      <body className={GeistMono.variable}>
        {/*
          `min-h-[100dvh]`, never `h-screen`. On iOS the address bar changes the
          viewport height as it hides, and `100vh` makes the page jump under a
          thumb already moving toward a button — which here is the button that
          reports money.
        */}
        <div className="min-h-[100dvh] pb-28">{children}</div>
      </body>
    </html>
  );
}
