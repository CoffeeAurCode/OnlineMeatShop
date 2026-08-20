import Link from 'next/link';

import { requireDriver } from '@/app/driver-guard';
import { jobsForPartner } from '@/db/repositories/driver';
import { driverStage, isOpenJob, type DriverStage } from '@/domain/driver';
import { shopTimeZone, slotWindow } from '@/ui/business-date';
import { ADMIN_LOCALE, money } from '@/ui/format';

import { Empty, Screen } from '../(admin)/admin/_components/shell';
import { RefreshButton } from '../(admin)/admin/_components/refresh-button';
import { SignOutButton } from './_components/sign-out-button';

/**
 * Every job assigned to the driver who is signed in.
 *
 * ⚠ THE LIST IS SCOPED IN THE QUERY, not here. `jobsForPartner` takes the
 * partner id from the session and filters in SQL — see its file header for why
 * a `.filter()` on this page would be the wrong place for the only rule that
 * keeps one driver out of another's customers' addresses.
 *
 * No live board and no polling, for the same reason the console's order queue
 * has none: at two to six orders a day an explicit refresh is honest about
 * when the numbers were read, and a board that silently reconnects can show a
 * stale status while looking current.
 */

const STAGE_LABEL: Record<DriverStage, string> = {
  preparing: 'Preparing',
  readyForPickup: 'Ready for pickup',
  onTheWay: 'With you',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/**
 * ⚠ The wash classes are named for MEANING, not colour, so a theme change
 * cannot quietly make "ready" and "cancelled" look alike.
 */
const STAGE_CLASS: Record<DriverStage, string> = {
  preparing: 'bg-raised text-muted',
  readyForPickup: 'bg-hot-wash text-hot',
  onTheWay: 'bg-raised text-ink',
  delivered: 'bg-raised text-muted',
  cancelled: 'bg-danger-wash text-danger',
};

export default async function DriverJobsPage() {
  const driver = await requireDriver();
  const jobs = await jobsForPartner(driver.id);
  const tz = shopTimeZone();

  const open = jobs.filter((j) => isOpenJob(j.status));

  return (
    <Screen title="Deliveries" width="plain">
      <div className="mt-2 flex items-center justify-between gap-4">
        <p className="text-body text-muted">
          {driver.name} · {open.length === 0 ? 'nothing open' : `${open.length} to do`}
        </p>
        <RefreshButton />
      </div>

      {jobs.length === 0 ? (
        <div className="mt-8">
          <Empty
            title="No jobs yet"
            body="Orders appear here when the shop assigns one to you. You will also get a text."
          />
        </div>
      ) : null}

      <ul className="mt-6">
        {jobs.map((job) => {
          const stage = driverStage(job.status);
          /*
           * ⭐ THE CASH LINE IS THE ONLY MONEY ON THIS SCREEN, and it appears
           * only on cash orders. A driver does not need to know what a prepaid
           * order was worth, and `src/domain/dispatch.ts` refuses to put a
           * figure in the SMS for the same reason.
           *
           * `null` on an unweighed cash order is correct: there is genuinely no
           * amount yet, and showing the estimate "for now" would be showing a
           * number somebody is about to hand over.
           */
          const cash = job.payMode === 'COD' ? job.finalTotalCents : null;

          return (
            <li key={job.orderId} className="border-b border-line">
              <Link href={`/driver/${job.orderId}`} className="block py-3">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-lead font-semibold">
                    {job.addressLine1}
                    {job.hasHotLine ? ' · HOT' : ''}
                  </span>
                  <span
                    className={`shrink-0 rounded-sm px-2 py-0.5 text-meta font-semibold ${STAGE_CLASS[stage]}`}
                  >
                    {STAGE_LABEL[stage]}
                  </span>
                </div>

                <p className="mt-1 text-meta text-muted">
                  {job.city} · <span className="tnum">{slotWindow(tz, new Date(job.slotStartsAtMs), new Date(job.slotEndsAtMs))}</span>
                </p>

                <p className="mt-1 text-meta">
                  {job.payMode === 'COD' ? (
                    <span className="font-semibold text-ink">
                      CASH
                      {cash === null ? ' · amount once weighed' : ` · ${money(cash, ADMIN_LOCALE)}`}
                    </span>
                  ) : (
                    <span className="text-muted">Paid online · collect nothing</span>
                  )}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-10">
        <SignOutButton />
      </div>
    </Screen>
  );
}
