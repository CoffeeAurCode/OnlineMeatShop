import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';

import { checkStaff, type StaffRefusal } from '@/app/admin-guard';

import '../../globals.css';
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
 * Deliberately not a dashboard. `04-PLAN` §11: a stack of single-purpose
 * screens operated one-handed at 6am, so the chrome is a title, a way back,
 * and nothing else. No sidebar, no tab bar, no breadcrumb trail. Every pixel
 * of chrome is a pixel not showing a number the owner needs.
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
        <OfflineBar />
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
        <NewOrderAlarm />
        {/*
          `min-h-[100dvh]`, never `h-screen`. On iOS the address bar changes the
          viewport height as it hides, and `100vh` makes the page jump under a
          thumb that is already moving toward a button.
        */}
        <div className="min-h-[100dvh] pb-28">{children}</div>
      </body>
    </html>
  );
}
