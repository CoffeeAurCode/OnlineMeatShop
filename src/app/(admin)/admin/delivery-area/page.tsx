import { listZones } from '@/db/repositories/admin';

import { Screen } from '../_components/shell';
import { ZoneEditor } from '../_components/zone-editor';

export const dynamic = 'force-dynamic';

export default async function DeliveryAreaPage() {
  const zones = await listZones();

  return (
    <Screen title="Delivery area" back={{ href: '/admin', label: 'Today' }}>
      <ZoneEditor zones={zones} />
    </Screen>
  );
}
