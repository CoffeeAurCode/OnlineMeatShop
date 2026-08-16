import { listSlots, slotRunwayDays } from '@/db/repositories/admin';
import { businessDateIn, shopTimeZone } from '@/ui/business-date';

import { Screen } from '../_components/shell';
import { SlotEditor } from '../_components/slot-editor';

/**
 * Delivery windows.
 *
 * ⚠ `07-PLAN` §6.2 puts this first among the console's gaps, and the reason is
 * that it is the only one that is a SCHEDULED OUTAGE rather than an
 * inconvenience: the seeded windows run out on a known date and the site
 * silently stops accepting orders. Every other missing screen costs the owner
 * a phone call to a developer; this one costs a day's trade with no warning.
 */

export const dynamic = 'force-dynamic';

export default async function SlotsPage() {
  const timeZone = shopTimeZone();
  const today = businessDateIn(timeZone, new Date());

  const [slots, runwayDays] = await Promise.all([listSlots(today), slotRunwayDays(today)]);

  return (
    <Screen title="Delivery windows" back={{ href: '/admin', label: 'Today' }}>
      <SlotEditor slots={slots} today={today} runwayDays={runwayDays} timeZone={timeZone} />
    </Screen>
  );
}
