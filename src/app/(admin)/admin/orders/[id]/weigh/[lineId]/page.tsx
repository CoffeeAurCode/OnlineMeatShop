import { notFound } from 'next/navigation';

import { orderForWeighing, orderRef } from '@/db/repositories/orders';

import { Screen } from '../../../../_components/shell';
import { WeighForm } from '../../../../_components/weigh-form';

/**
 * ⭐ THE WEIGHING SCREEN.
 *
 * `04-PLAN` §4 calls this the one to get right, and it is used dozens of times
 * a day with wet hands in a cold room. One line, one number, one button.
 */
export default async function WeighPage({
  params,
}: {
  params: Promise<{ id: string; lineId: string }>;
}) {
  const { id, lineId } = await params;
  const order = await orderForWeighing(id);
  if (order === null) notFound();

  const line = order.lines.find((l) => l.id === lineId);
  if (line === undefined || line.pricingMode !== 'perKg') notFound();

  return (
    <Screen title={line.productName} back={{ href: `/admin/orders/${id}`, label: orderRef(order) }}>
      <WeighForm
        orderId={id}
        lineId={line.id}
        requestedG={line.requestedG}
        band={line.band ?? { lowerG: line.requestedG, upperG: line.requestedG }}
        alreadyWeighedG={line.actWeightG}
        orderStatus={order.status}
      />
    </Screen>
  );
}
