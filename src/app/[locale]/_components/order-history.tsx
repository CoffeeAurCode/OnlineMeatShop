'use client';

import { useEffect } from 'react';
import Link from 'next/link';

import { t, type Locale } from '@/i18n';
import { money } from '@/ui/format';
import { useCustomerSession } from '@/ui/customer-session';

import { openSignIn } from './drawer-state';

/**
 * "My orders", for a number that has actually been proven.
 *
 * ══ WHAT THIS SCREEN USED TO BE ═══════════════════════════════════════════
 *
 * A phone field and a code field, posting to an endpoint that returned the
 * list for one request and set no cookie — because the code was a fixed
 * development string and a cookie minted from it would have been a durable
 * credential built on nothing. In production `phoneVerifier()` threw, so
 * `verificationAvailable()` was false, so this page rendered
 * "Something went wrong. Try again." to every customer who had ever ordered.
 *
 * ⭐ THAT WAS CORRECT AND USELESS. The security reasoning was right; the
 * feature simply did not exist. It exists now, so the form is gone: the
 * sign-in sheet owns the whole flow, and this component only ever renders the
 * result.
 *
 * ⚠ THE ORDERS COME FROM THE SESSION CONTEXT, WHICH GOT THEM FROM A SERVER
 * THAT READ THE SIGNED COOKIE. Nothing on this page chooses whose orders to
 * show, and no parameter can. Each row links to its own token page, so there
 * is still exactly one credential in the system rather than two.
 */

export function OrderHistory({ locale }: { locale: Locale }) {
  const { phone, orders, loading, refresh } = useCustomerSession();

  /*
   * Refreshed on mount rather than trusting whatever the provider fetched when
   * the app first loaded. This is the one page whose entire content is the
   * list, and arriving here from a just-placed order with a stale copy would
   * show the customer a history missing the order they are looking for.
   */
  useEffect(() => {
    void refresh();
    // Once, on mount. `refresh` is stable, and re-running on its identity
    // would poll this page forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && phone === undefined) {
    return <p className="mt-8 text-body text-muted">{t(locale, 'common.loading')}</p>;
  }

  if (phone == null) {
    return (
      <div className="mt-8 grid gap-4">
        <p className="text-body text-muted">{t(locale, 'auth.body')}</p>
        <button
          type="button"
          onClick={openSignIn}
          className="tap-lg justify-self-start rounded-sm bg-accent px-6 text-lead font-semibold text-accent-ink active:scale-[0.99]"
        >
          {t(locale, 'auth.title')}
        </button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="mt-8 rounded-md border border-line bg-raised px-6 py-14 text-center">
        <p className="text-lead font-semibold">{t(locale, 'order.historyEmpty')}</p>
        <p className="mx-auto mt-2 max-w-[36ch] text-body text-muted">
          {t(locale, 'order.historyEmptyBody')}
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="mt-6 text-meta text-muted">{t(locale, 'auth.signedInAs', { phone })}</p>
      <ul className="mt-4 grid gap-3">
        {orders.map((o) => (
          <li key={o.publicToken}>
            <Link
              href={`/${locale}/orders/${o.publicToken}`}
              className="flex items-center justify-between gap-4 rounded-md border border-line bg-raised px-4 py-4 transition-colors hover:border-accent"
            >
              <span className="min-w-0">
                <span className="block text-body font-semibold">
                  {t(locale, `status.${o.status}`)}
                </span>
                <span className="tnum block text-meta text-muted">
                  {new Date(o.placedAtMs).toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA')}
                </span>
              </span>
              <span className="tnum shrink-0 text-body font-semibold">
                {/*
                  The final total once it exists, the estimate until then, and
                  never both: a list is for recognising an order, not for
                  auditing it. The token page shows the full comparison.
                */}
                {money(o.finalTotalCents ?? o.estTotalCents, locale)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
