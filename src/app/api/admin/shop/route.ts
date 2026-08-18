import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { writeSettings } from '@/db/repositories/settings';
import { normalisePhone } from '@/domain/phone';
import { isValidPostalCode, normalisePostalCode } from '@/domain/serviceability';
import { WEEKDAYS, isProvinceCode, isTimeOfDay, normaliseTowns } from '@/domain/shop';

import { guardedBy } from '../_guard';

/**
 * The shop's own details: where it is, when it is open, where it delivers.
 *
 * ⭐ THESE WERE ENVIRONMENT VARIABLES UNTIL 2026-08-18. Six of them were read
 * by nothing at all, and the seventh could only be changed by somebody with a
 * hosting dashboard open. Opening hours change because a supplier is late;
 * that is not a deployment. See `src/domain/shop.ts`.
 *
 * ══ NORMALISATION HAPPENS HERE, NOT IN THE FORM ═══════════════════════════
 *
 * ⚠ THE BROWSER IS NOT THE PLACE A POSTAL CODE BECOMES CANONICAL. The console
 * is the only client today and it would be easy to trim and upper-case there
 * and call it done; the value would then be canonical only for as long as that
 * remains true. `a1a 1a1` and `A1A1A1` are one address, and the row must not
 * be able to hold both spellings.
 *
 * ⚠ AN INVALID VALUE IS REFUSED, NOT CORRECTED. A postal code that is not a
 * postal code, or a phone number E.164 cannot express, comes back as a reason
 * the form can name. Silently storing the closest guess is how a shop ends up
 * publishing a phone number nobody answers.
 *
 * ══ WHY IT PURGES THE WHOLE STOREFRONT ════════════════════════════════════
 *
 * The address and hours render in the footer of EVERY page and inside the
 * `Store` structured-data node in the root layout, and most of the storefront
 * is prerendered. `revalidatePath('/', 'layout')` is therefore correct rather
 * than lazy: there is no narrower path that covers "every page has a footer".
 */

/** '' clears a field. Anything else is trimmed and length-capped. */
const line = z.string().trim().max(120);

const schema = z.object({
  street: line,
  locality: line,
  /**
   * ⚠ CHECKED AGAINST THE CLOSED LIST, NOT AGAINST `length === 2`. `QU` is not
   * a province and `Quebec` is not a code; both would pass a length check and
   * then produce a `PostalAddress` that reads as malformed to every consumer
   * of it. The list itself lives in the domain so that the picker and this
   * refusal cannot drift apart.
   */
  region: z.string().trim().refine(isProvinceCode),
  postalCode: z.string().trim().max(10),
  phone: z.string().trim().max(24),
  /**
   * One entry per day, closed days included. Both times or neither: a day with
   * an opening time and no closing time is not a half-filled form, it is a
   * shop that never shuts.
   */
  hours: z
    .array(
      z.object({
        day: z.enum(WEEKDAYS),
        opens: z.string().refine(isTimeOfDay).nullable(),
        closes: z.string().refine(isTimeOfDay).nullable(),
      }),
    )
    .max(7)
    .refine(
      (days) => days.every((d) => (d.opens === null) === (d.closes === null)),
      { message: 'a day needs both times or neither' },
    )
    /*
     * ⚠ OVERNIGHT TRADING IS DELIBERATELY NOT EXPRESSIBLE. `closes` must be
     * later than `opens`, which refuses 18:00-02:00. This is a fish counter,
     * not a bar; allowing the wrap would mean every reader of these hours
     * (the footer, `schema.org`, whatever comes next) has to handle a range
     * that runs backwards, to support a case this shop does not have.
     */
    .refine((days) => days.every((d) => d.opens === null || d.closes! > d.opens), {
      message: 'closing time must be after opening time',
    }),
  /**
   * Town NAMES. The slug is derived server-side by `normaliseTowns`, because a
   * slug sent by a client is a URL sent by a client.
   *
   * ⚠ CAPPED AT 20, AND THE CAP IS EDITORIAL RATHER THAN TECHNICAL. Each name
   * becomes a page, and a page per town with nothing unique on it is the
   * doorway-page pattern Google's guidance targets. `04-PLAN` §10.5: a town
   * that cannot sustain its own content is a section on `/delivery`.
   */
  towns: z.array(z.string().trim().max(60)).max(20),
});

export async function POST(request: Request) {
  return guardedBy(request, schema, async (input, staff) => {
    const postalCode = input.postalCode === '' ? '' : normalisePostalCode(input.postalCode);
    if (postalCode !== '' && !isValidPostalCode(postalCode)) {
      return NextResponse.json({ reason: 'invalidPostalCode' }, { status: 400 });
    }

    const phone = input.phone === '' ? '' : normalisePhone(input.phone);
    if (phone === null) {
      return NextResponse.json({ reason: 'invalidPhone' }, { status: 400 });
    }

    await writeSettings(
      {
        'shop.street': input.street,
        'shop.locality': input.locality,
        'shop.region': input.region,
        'shop.postalCode': postalCode,
        'shop.phone': phone,
        // Closed days are dropped rather than stored as null pairs: the domain
        // fills the week back in on read, so storing them is storing nothing.
        'shop.hours': input.hours.filter((d) => d.opens !== null),
        'delivery.towns': normaliseTowns(input.towns),
      },
      staff.id,
    );

    revalidatePath('/', 'layout');

    return NextResponse.json({ ok: true });
  });
}
