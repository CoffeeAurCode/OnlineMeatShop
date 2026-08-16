import { readSettings } from '@/db/repositories/settings';

import { SettingsForm } from '../_components/settings-form';
import { Screen } from '../_components/shell';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const settings = await readSettings();

  return (
    <Screen title="Console settings" back={{ href: '/admin', label: 'Today' }}>
      <SettingsForm settings={settings} />
    </Screen>
  );
}
