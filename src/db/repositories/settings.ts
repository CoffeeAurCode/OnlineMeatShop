import 'server-only';

import { sql } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';
import { shopSetting } from '@/db/schema';

/**
 * Console settings — the small set of preferences the owner controls.
 *
 * ══ THE DEFAULTS LIVE IN CODE, NOT IN A SEED ══════════════════════════════
 *
 * ⭐ A MISSING ROW MEANS "THE DEFAULT", NOT "BROKEN".
 *
 * A seed script that inserts default rows would mean a fresh database and a
 * migrated one behave differently until somebody remembers to run it — and the
 * thing that breaks is the new-order alarm, which fails SILENTLY. Nobody
 * notices an alarm that did not ring; they notice it three hours later when
 * the fish is still on the counter.
 *
 * So `SETTING_DEFAULTS` is the source of truth for what a setting means when
 * nobody has expressed an opinion, and a row exists only where somebody has.
 *
 * ⚠ THIS IS NOT A CONFIGURATION STORE FOR EVERYTHING. Anything a CHECK
 * constraint should enforce, or that another table references, gets a real
 * column — see the `shop_setting` comment in `schema.ts`. The delivery fee is
 * not in here; the chime is.
 */

export const SETTING_DEFAULTS = {
  /** Whether the console makes a noise when an order lands. */
  'console.newOrderSound': true,
  /**
   * What it says out loud. Spoken by the browser, so it is a SENTENCE, not a
   * label — "New order received" reads better than "NEW_ORDER".
   *
   * Kept generic rather than seeded with the shop's name, because this file is
   * in a public repository and the shop's identity belongs in an env var.
   */
  'console.newOrderMessage': 'New order received',
  /** How often the console asks whether anything arrived, in seconds. */
  'console.pollSeconds': 10,
  /** Repeat the announcement until somebody opens the order. */
  'console.repeatUntilSeen': false,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

/**
 * ⚠ WRITTEN OUT RATHER THAN MAPPED FROM `SETTING_DEFAULTS`.
 *
 * `as const` on the defaults gives each value a LITERAL type —
 * `'console.newOrderSound'` is `true`, not `boolean` — so a mapped type would
 * make `false` unassignable and the setting permanently on. The defaults still
 * have to stay in sync with this by eye, which is a real cost; it is smaller
 * than a settings object that cannot express its own off switch.
 */
export interface Settings {
  'console.newOrderSound': boolean;
  'console.newOrderMessage': string;
  'console.pollSeconds': number;
  'console.repeatUntilSeen': boolean;
}

/**
 * Every setting, defaults filled in.
 *
 * One query, always — the console reads all of them on every render of the
 * shell, and four round trips for four booleans would be four round trips.
 *
 * ⚠ A ROW WHOSE VALUE HAS THE WRONG TYPE IS IGNORED, not coerced and not
 * thrown. The row can only get there by hand-written SQL, and the right
 * behaviour when somebody has typed `"true"` instead of `true` is to fall back
 * to the default rather than to take the console down. The console shows the
 * effective value, so the mistake is visible.
 */
export async function readSettings(tx: Tx | typeof db = db): Promise<Settings> {
  const rows = await tx.select({ key: shopSetting.key, value: shopSetting.value }).from(shopSetting);

  const out: Settings = { ...SETTING_DEFAULTS };
  for (const row of rows) {
    if (!(row.key in SETTING_DEFAULTS)) continue;
    const key = row.key as SettingKey;
    if (typeof row.value === typeof SETTING_DEFAULTS[key]) {
      (out as unknown as Record<string, unknown>)[key] = row.value;
    }
  }
  return out;
}

/**
 * Write one or more settings.
 *
 * Upsert rather than insert-or-update: the first time the owner touches a
 * setting there is no row, and every time after there is. Both are the same
 * statement, so neither is a special case anybody has to remember.
 */
export async function writeSettings(
  patch: { [K in SettingKey]?: Settings[K] | undefined },
  staffId: string | null,
  tx: Tx | typeof db = db,
): Promise<void> {
  const entries = Object.entries(patch);
  if (entries.length === 0) return;

  for (const [key, value] of entries) {
    if (!(key in SETTING_DEFAULTS)) continue;
    await tx
      .insert(shopSetting)
      .values({ key, value: value as never, updatedBy: staffId })
      .onConflictDoUpdate({
        target: shopSetting.key,
        set: {
          value: sql`excluded.value`,
          updatedAt: new Date(),
          updatedBy: sql`excluded.updated_by`,
        },
      });
  }
}
