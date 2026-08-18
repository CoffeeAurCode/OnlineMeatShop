import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db, type Tx } from '@/db/client';
import { shopSetting } from '@/db/schema';
import {
  EMPTY_IDENTITY,
  WEEKDAYS,
  isTimeOfDay,
  type DayHours,
  type DeliveryTown,
  type ShopIdentity,
} from '@/domain/shop';

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
  /**
   * ⭐ WHETHER THE STOREFRONT OFFERS CASH ON DELIVERY.
   *
   * A setting rather than an environment variable, deliberately. The shop
   * turning cash off is an OPERATIONAL decision made on a morning — no float
   * in the till, a driver who will not carry cash, a run of bad notes — and it
   * has to be reversible from a phone in the time it takes to serve a
   * customer. An env var means a redeploy, which means it does not happen.
   *
   * ⚠ TURNING IT OFF DOES NOT TOUCH ORDERS ALREADY PLACED. A cash order in
   * flight still settles at the door; this gate is only on new checkouts. That
   * is the correct behaviour and it is also the surprising one, so it is
   * written down: the console will keep showing cash orders after cash is off.
   */
  'checkout.codEnabled': true,

  /*
   * ══ THE SHOP'S OWN IDENTITY ═══════════════════════════════════════════
   *
   * ⭐ THESE WERE ENVIRONMENT VARIABLES UNTIL 2026-08-18, and that was the
   * wrong home for every one of them. Six were read by NOTHING; the seventh,
   * the delivery towns, could only be changed by somebody with a hosting
   * dashboard open. A shop's phone number and its Tuesday hours are things the
   * owner changes, from a phone, without a deploy. See `src/domain/shop.ts`.
   *
   * ⚠ WHAT DID NOT MOVE, AND WHY: `NEXT_PUBLIC_SITE_ORIGIN` and
   * `NEXT_PUBLIC_SHOP_NAME` are still environment variables, because the BUILD
   * needs both before any database exists — the origin bakes into
   * `robots.txt`, `sitemap.xml` and every canonical URL, and the name into the
   * icon and the metadata template.
   *
   * ⚠ THE DEFAULTS ARE EMPTY, NOT PLAUSIBLE. An unset address must render as
   * nothing anywhere a customer can see, never as a placeholder. A fictional
   * address in a footer is a wrong address in a footer, and nobody notices it.
   */

  /** Street and number. `1 Sample Street` is NOT a default; '' is. */
  'shop.street': '',
  'shop.locality': '',
  /** Province or territory, as its two-letter code. */
  'shop.region': '',
  /** Normalised on write: uppercase, no space. */
  'shop.postalCode': '',
  /** E.164. ⚠ The number CUSTOMERS see. A driver's number lives on their row. */
  'shop.phone': '',
  /** Trading hours, one entry per open day. See `src/domain/shop.ts`. */
  'shop.hours': [] as readonly DayHours[],
  /**
   * The towns with a `/delivery/[town]` page of their own.
   *
   * ⚠ NOT A LIST OF EVERYWHERE THE VAN GOES. That is the delivery AREA, which
   * is postal-code data on `zone` and is edited at `/admin/delivery-area`.
   * This list creates PAGES, and a page for a town with nothing unique to say
   * is the doorway page Google's guidance targets.
   */
  'delivery.towns': [] as readonly DeliveryTown[],
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
  'checkout.codEnabled': boolean;
  'shop.street': string;
  'shop.locality': string;
  'shop.region': string;
  'shop.postalCode': string;
  'shop.phone': string;
  'shop.hours': readonly DayHours[];
  'delivery.towns': readonly DeliveryTown[];
}

/**
 * What a stored value must look like to be believed.
 *
 * ⭐ A SCHEMA PER KEY, REPLACING A `typeof` COMPARISON. The old check asked
 * whether the stored value had the same `typeof` as the default, which is
 * exactly right for a boolean and useless the moment a setting became a list:
 * `typeof [] === 'object'` and so does `typeof { anything: 'at all' }`, so a
 * malformed row would have been handed to the storefront as opening hours.
 *
 * ⚠ THE DOCTRINE IS UNCHANGED — a row that fails is IGNORED, not coerced and
 * not thrown. It can only get there by hand-written SQL, and the right answer
 * is the default plus a visibly wrong screen, never a console that will not
 * load. What changed is that "fails" now means something.
 */
const dayHours = z.object({
  day: z.enum(WEEKDAYS),
  opens: z.string().refine(isTimeOfDay).nullable(),
  closes: z.string().refine(isTimeOfDay).nullable(),
});

const SETTING_SHAPES: { [K in SettingKey]: z.ZodType<Settings[K]> } = {
  'console.newOrderSound': z.boolean(),
  'console.newOrderMessage': z.string(),
  'console.pollSeconds': z.number().int(),
  'console.repeatUntilSeen': z.boolean(),
  'checkout.codEnabled': z.boolean(),
  'shop.street': z.string(),
  'shop.locality': z.string(),
  'shop.region': z.string(),
  'shop.postalCode': z.string(),
  'shop.phone': z.string(),
  'shop.hours': z.array(dayHours).max(7),
  'delivery.towns': z.array(z.object({ slug: z.string().min(1), name: z.string().min(1) })).max(50),
};

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
    const parsed = SETTING_SHAPES[key].safeParse(row.value);
    if (parsed.success) {
      (out as unknown as Record<string, unknown>)[key] = parsed.data;
    }
  }
  return out;
}

/**
 * The shop's identity, in the shape `src/domain/shop.ts` describes.
 *
 * A projection of `readSettings` rather than a second query: the console reads
 * every setting on every render anyway, and two round trips for one screen is
 * two round trips.
 */
export function identityOf(settings: Settings): ShopIdentity {
  return {
    street: settings['shop.street'],
    locality: settings['shop.locality'],
    region: settings['shop.region'],
    postalCode: settings['shop.postalCode'],
    phone: settings['shop.phone'],
    hours: settings['shop.hours'],
    towns: settings['delivery.towns'],
  };
}

/**
 * The shop's identity, read fresh.
 *
 * ⚠ THIS IS THE ONE THE STOREFRONT CALLS, AND IT MUST NEVER THROW INTO A
 * PRERENDER. `next build` runs without a reachable database in CI on purpose
 * (the canary build uses an invalid connection string so that no real
 * credential is present while the output is scanned for leaks), and the
 * storefront layout renders during that build. An unguarded read there turns
 * "the database is asleep" into "the deployment failed". Same reasoning as
 * `src/db/build-time.ts`, and the same answer: an empty identity renders
 * nothing, which is what an unconfigured shop should show anyway.
 */
export async function readShopIdentity(tx: Tx | typeof db = db): Promise<ShopIdentity> {
  try {
    return identityOf(await readSettings(tx));
  } catch (error) {
    const reason = error instanceof Error ? firstLine(error.message) : String(error);
    console.warn(
      `[shop] Could not read the shop's own details, so none were shown. Reason: ${reason}`,
    );
    return EMPTY_IDENTITY;
  }
}

/** The first line of a multi-line driver error, for a one-line log. */
function firstLine(message: string): string {
  const stop = message.indexOf(String.fromCharCode(10));
  return stop === -1 ? message : message.slice(0, stop);
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
