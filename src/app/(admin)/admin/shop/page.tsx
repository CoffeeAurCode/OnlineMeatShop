import { identityOf, readSettings } from '@/db/repositories/settings';
import { hasAddress } from '@/domain/shop';

import { ShopForm } from '../_components/shop-form';
import { Screen } from '../_components/shell';

/**
 * The shop's own details.
 *
 * ⚠ SEPARATE FROM "Console settings", which is about the owner's own screen
 * (the alarm, how often it polls). Everything here is about what CUSTOMERS
 * see, and mixing the two would mean one screen where half the switches change
 * the shop and half change the phone in your hand.
 *
 * ⚠ NOT the delivery AREA and not the delivery WINDOWS. Both have screens of
 * their own, both are enforced data rather than presentation, and the form
 * says so where the two could be confused.
 */

export const dynamic = 'force-dynamic';

export default async function ShopPage() {
  const identity = identityOf(await readSettings());

  return (
    <Screen title="Shop details" back={{ href: '/admin', label: 'Today' }}>
      {!hasAddress(identity) && (
        <p className="mt-4 rounded-sm border border-line bg-soft px-3 py-2 text-meta">
          The site is showing no address and no opening hours to anybody, because none are set.
          Nothing is broken; there is simply nothing to show yet.
        </p>
      )}

      <ShopForm identity={identity} />
    </Screen>
  );
}
