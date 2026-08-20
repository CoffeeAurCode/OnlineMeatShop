import { notFound } from 'next/navigation';

import { requireDriver } from '@/app/driver-guard';
import { jobForPartner } from '@/db/repositories/driver';
import { canReportDelivery, driverStage } from '@/domain/driver';
import { mapsDirectionsUrl, mapsDirectionsUrlForAddress } from '@/domain/maps';
import { shopTimeZone, slotWindow } from '@/ui/business-date';
import { ADMIN_LOCALE, money, weight } from '@/ui/format';

import { Screen } from '../../(admin)/admin/_components/shell';
import { DeliverForm } from '../_components/deliver-form';

/**
 * One job, at the door.
 *
 * ⚠ THE LOOKUP IS KEYED ON THE DRIVER **AND** THE ORDER. A driver holding
 * another order's UUID gets a 404 that is indistinguishable from a job that
 * does not exist — see `jobForPartner`. There is deliberately no "not yours"
 * message, because it would confirm the order exists.
 *
 * ══ WHAT IS ON THIS SCREEN AND WHY EACH THING EARNS ITS PLACE ═════════════
 *
 * The coordinate finds the BUILDING; the address lines say which DOOR. Both,
 * always, and neither substitutes for the other — GPS on a phone in a stairwell
 * is routinely 30 m out, which is the difference between two addresses on a
 * terrace. Same rule as the dispatch SMS (`src/domain/dispatch.ts` §1.3).
 *
 * The customer's phone is here because the driver is at the door and nobody is
 * answering. Their email is not, and no line price is either.
 */
export default async function DriverJobPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const driver = await requireDriver();

  const job = await jobForPartner(driver.id, orderId);
  if (job === null) notFound();

  const tz = shopTimeZone();
  const stage = driverStage(job.status);

  const addressOneLine = [job.addressLine1, job.addressLine2, job.city, job.province, job.postalCode]
    .filter((p): p is string => p !== null && p.trim() !== '')
    .join(', ');

  const routeUrl =
    job.lat !== null && job.lng !== null
      ? mapsDirectionsUrl(job.lat, job.lng)
      : mapsDirectionsUrlForAddress(addressOneLine);

  return (
    <Screen title={`#${job.reference}`} back={{ href: '/driver', label: 'All deliveries' }} width="plain">
      <p className="mt-2 text-body text-muted">
        {stage === 'preparing'
          ? 'The shop is still preparing this one.'
          : stage === 'readyForPickup'
            ? 'Ready to collect from the shop.'
            : stage === 'onTheWay'
              ? 'You have this one.'
              : stage === 'delivered'
                ? 'Delivered. Nothing left to do.'
                : 'Cancelled. Do not deliver this one.'}
      </p>

      <section className="mt-6">
        <h2 className="text-section font-semibold tracking-tight">Deliver to</h2>
        <p className="mt-2 text-lead font-semibold">{job.addressLine1}</p>
        {job.addressLine2 !== null && job.addressLine2 !== '' && (
          <p className="text-lead">{job.addressLine2}</p>
        )}
        <p className="text-lead">
          {job.city} {job.province}
          {job.postalCode === null ? '' : ` ${job.postalCode}`}
        </p>

        {job.deliveryNotes !== null && job.deliveryNotes !== '' && (
          <p className="mt-3 rounded-sm bg-raised px-3 py-2 text-body">{job.deliveryNotes}</p>
        )}

        {/*
          A real link, not a button that copies coordinates. It opens the map
          app the driver already uses and already trusts, with directions
          started — which is one tap, at night, in a van.
        */}
        <a
          href={routeUrl}
          target="_blank"
          rel="noreferrer"
          className="tap-lg mt-4 flex w-full items-center justify-center rounded-sm bg-accent px-4 text-lead font-semibold text-accent-ink active:scale-[0.99]"
        >
          Open route
        </a>
      </section>

      <section className="mt-8">
        <h2 className="text-section font-semibold tracking-tight">Window</h2>
        <p className="tnum mt-1 text-body">
          {slotWindow(tz, new Date(job.slotStartsAtMs), new Date(job.slotEndsAtMs))}
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-section font-semibold tracking-tight">
          What is in it
          {job.hasHotLine ? (
            <span className="ml-3 rounded-sm bg-hot-wash px-2 py-0.5 text-meta font-semibold text-hot">
              HOT — separate bag
            </span>
          ) : null}
        </h2>
        <ul className="mt-2">
          {job.lines.map((line, index) => (
            <li key={index} className="flex justify-between gap-4 border-b border-line py-2">
              <span className="text-body">
                {line.name}
                {line.hot ? ' (HOT)' : ''}
              </span>
              <span className="tnum shrink-0 text-body text-muted">
                {weight(line.requestedG, ADMIN_LOCALE)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-section font-semibold tracking-tight">Customer</h2>
        <p className="mt-1 text-body">{job.customerName ?? 'No name given'}</p>
        {/* A real `tel:` link. The driver is at the door and nobody is answering. */}
        <a
          href={`tel:${job.customerPhone}`}
          className="tnum tap mt-1 inline-block text-lead underline underline-offset-4"
        >
          {job.customerPhone}
        </a>
      </section>

      <section className="mt-8">
        <h2 className="text-section font-semibold tracking-tight">Payment</h2>
        {job.payMode === 'COD' ? (
          <p className="mt-1 text-lead font-semibold">
            CASH ON DELIVERY —{' '}
            {job.finalTotalCents === null ? (
              <span className="text-muted">amount set once the shop weighs it</span>
            ) : (
              <span className="tnum">collect {money(job.finalTotalCents, ADMIN_LOCALE)}</span>
            )}
          </p>
        ) : (
          <p className="mt-1 text-lead">Paid online. Collect nothing.</p>
        )}

        {/*
          ⚠ A REPORTED FIGURE THAT DID NOT MATCH IS SHOWN BACK, NOT HIDDEN.
          Its presence beside an order still marked "with you" is the driver's
          only signal that their report landed and the shop has been told.
        */}
        {job.cashCollectedCents !== null && job.cashCollectedCents !== job.finalTotalCents && (
          <p className="mt-3 rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
            You reported{' '}
            <span className="tnum">{money(job.cashCollectedCents, ADMIN_LOCALE)}</span> collected,
            which does not match what was owed. The shop has been told and will sort it out.
          </p>
        )}
      </section>

      {canReportDelivery(job.status) ? (
        <DeliverForm
          orderId={job.orderId}
          payMode={job.payMode}
          dueCents={job.finalTotalCents}
          alreadyReportedCents={job.cashCollectedCents}
        />
      ) : null}
    </Screen>
  );
}
