import { smsConfigured } from '@/adapters/sms';
import { listPartners } from '@/db/repositories/partners';

import { PartnerList } from '../_components/partner-list';
import { Screen } from '../_components/shell';

/**
 * Who is driving.
 *
 * ⭐ THE BANNER AT THE TOP IS THE MOST USEFUL THING ON THIS SCREEN.
 *
 * `smsConfigured()` is false when the Twilio environment variables are absent,
 * and in that state the dispatch button still works, still marks the order
 * dispatched, and sends nothing — `LoggingSmsSender` writes to the server log
 * and reports success (see `src/adapters/sms.ts` for why it reports success
 * rather than failing closed). That is a defensible default and an
 * indefensible surprise. Saying it here, on the screen that lists the people
 * who would not be receiving the messages, is what stops it being one.
 */

export const dynamic = 'force-dynamic';

export default async function PartnersPage() {
  const partners = await listPartners(false);
  const real = smsConfigured();

  return (
    <Screen title="Drivers" back={{ href: '/admin', label: 'Today' }}>
      {!real && (
        <p className="mt-4 rounded-sm border border-line bg-soft px-3 py-2 text-meta">
          Text messages are NOT being sent from this deployment. Dispatch is recorded and written to
          the server log, but no driver receives anything. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
          and TWILIO_FROM_NUMBER to turn it on.
        </p>
      )}

      <PartnerList partners={partners} />
    </Screen>
  );
}
