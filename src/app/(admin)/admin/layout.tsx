import type { Metadata } from 'next';
import { GeistMono } from 'geist/font/mono';

import { checkStaff, type StaffRefusal } from '@/app/admin-guard';

import { OfflineBar } from './_components/offline-bar';

/**
 * The console shell.
 *
 * Deliberately not a dashboard. `04-PLAN` §11: this is a stack of
 * single-purpose screens operated one-handed at 6am, so the chrome is a title,
 * a way back, and nothing else. No sidebar, no tab bar, no breadcrumb trail —
 * every pixel of chrome is a pixel not showing a number the owner needs.
 */

export const metadata: Metadata = {
  title: 'Console',
  // Belt and braces: next.config.ts already sends X-Robots-Tag for /admin/*.
  robots: { index: false, follow: false },
};

// Stock and order figures are point-in-time. Rendering them from a cache is
// the defect this whole console is written to avoid.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const REFUSAL_COPY: Record<StaffRefusal, string> = {
  productionDisabled:
    'The console is disabled in production because staff sign-in has not been built yet. Nobody can reach it, including you.',
  notConfigured: 'No ADMIN_PREVIEW_TOKEN is set, so there is no way to sign in.',
  noToken: 'This browser has no console token. Set the admin_preview cookie to the configured value.',
  badToken: 'That token does not match. Nothing has been unlocked.',
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const gate = await checkStaff();

  if (!gate.ok) {
    return (
      <main className={`${GeistMono.variable} mx-auto max-w-[38rem] px-4 py-16`}>
        <h1 className="text-display font-semibold tracking-tight">Console unavailable</h1>
        <p className="mt-4 max-w-[65ch] text-lead text-muted">{REFUSAL_COPY[gate.reason]}</p>
        <p className="mt-6 max-w-[65ch] text-body text-muted">
          The designed sign-in is Supabase Auth with the staff role re-checked against the database
          on every write. Until that exists this guard fails closed, because an unauthenticated
          console that edits stock and money is worse than one nobody can open.
        </p>
      </main>
    );
  }

  return (
    <>
      <OfflineBar />
      {/*
        `min-h-[100dvh]`, never `h-screen`. On iOS the address bar changes the
        viewport height as it hides, and `100vh` makes the page jump under a
        thumb that is already moving toward a button.
      */}
      <div className={`${GeistMono.variable} min-h-[100dvh] pb-28`}>{children}</div>
    </>
  );
}
