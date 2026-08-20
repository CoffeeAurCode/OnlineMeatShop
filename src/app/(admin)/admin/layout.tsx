import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';

import { checkStaff, type StaffRefusal } from '@/app/admin-guard';
import { shopName } from '@/ui/shop-config';

import '../../globals.css';
import { ConsoleChrome } from './_components/console-nav';
import { OfflineBar } from './_components/offline-bar';
import { LoginForm } from './_components/login-form';
import { NewOrderAlarm } from './_components/new-order-alarm';

/**
 * The console shell, and THE SECOND ROOT LAYOUT.
 *
 * It renders `<html>` because the storefront's root layout lives inside
 * `[locale]` and this half of the app has no locale: the console is English
 * only and always will be. It is one operator using a tool, not a shopfront.
 *
 * ⚠ IT IS A DASHBOARD NOW, AND IT WAS DELIBERATELY NOT ONE BEFORE.
 *
 * `04-PLAN` §11 called for a stack of single-purpose screens with a title, a
 * way back and no other chrome, on the argument that every pixel of chrome is
 * a pixel not showing a number the owner needs. The client asked on 2026-08-19
 * for the console to be rebuilt against an operations-dashboard reference, and
 * the plan's argument is answered rather than discarded:
 *
 *   below `lg`  the chrome is a pill row, which costs one line of screen and
 *               replaces the tap-back-tap-forward walk between screens that
 *               the old layout charged for every cross-reference
 *   `lg` and up an icon rail and a top bar, on a width where the alternative
 *               was 900px of empty page beside a 600px column
 *
 * Nothing was removed to make room: every destination the console had is still
 * one tap away at every width, and the day's figures are on the first screen.
 */

export const metadata: Metadata = {
  title: 'Console',
  // Belt and braces: next.config.ts already sends X-Robots-Tag for /admin/*.
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

// Stock and order figures are point-in-time. Rendering them from a cache is
// the defect this whole console is written to avoid.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * What the operator is told, per refusal.
 *
 * ⚠ Only `notConfigured` gets a real explanation. Every other refusal is a
 * failed sign-in, and the login form says so without distinguishing "no
 * session" from "bad signature" from "deactivated" -- those differences are
 * useful to somebody probing the door and to nobody else.
 */
const NEEDS_SETUP: Partial<Record<StaffRefusal, string>> = {
  notConfigured:
    'STAFF_SESSION_SECRET is not set, so no session can be signed and nobody can sign in. ' +
    'Set it to at least 32 random characters, then create a staff account with scripts/create-staff.mjs.',
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const gate = await checkStaff();

  if (!gate.ok) {
    const setupProblem = NEEDS_SETUP[gate.reason];

    return (
      <html lang="en-CA">
        <body className={GeistMono.variable}>
          <main className="mx-auto grid min-h-[100dvh] max-w-[26rem] content-center gap-6 px-4 py-16">
            {setupProblem === undefined ? (
              <LoginForm expired={gate.reason === 'expired'} />
            ) : (
              <>
                <h1 className="!text-display">Console unavailable</h1>
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
          ⭐ THE ALARM IS IN THE LAYOUT, SO IT SURVIVES NAVIGATION.

          Put on a page instead, it would unmount and remount every time the
          owner opened an order — losing its cursor, its armed AudioContext and
          its unacknowledged list each time, and re-announcing whatever arrived
          during the walk between screens. In the layout it is mounted once for
          the whole session.

          It renders inside the authenticated branch only. There is no alarm on
          the login screen, which is the correct amount of information to give
          somebody who has not signed in.
        */}
        {/*
          `min-h-[100dvh]`, never `h-screen`. On iOS the address bar changes the
          viewport height as it hides, and `100vh` makes the page jump under a
          thumb that is already moving toward a button. The frame inside
          `ConsoleChrome` inherits the same rule for the same reason.

          `pb-28` clears the fixed action bar the form screens pin to the
          bottom; it stays on the OUTER element so the frame's own rounded
          corner is not pushed off the viewport with it.

          ⚠ BOTH BANNERS ARE HANDED TO THE CHROME RATHER THAN RENDERED BESIDE
          IT, so they share the header's single sticky wrapper. See the prop.
        */}
        <div className="pb-28">
          <ConsoleChrome
            shopName={shopName()}
            operator={gate.staff}
            banners={
              <>
                <OfflineBar />
                <NewOrderAlarm />
              </>
            }
          >
            {children}
          </ConsoleChrome>
        </div>
      </body>
    </html>
  );
}
