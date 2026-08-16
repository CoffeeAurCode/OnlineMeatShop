import { NextResponse } from 'next/server';
import { z } from 'zod';

import { writeSettings } from '@/db/repositories/settings';

import { guardedBy } from '../_guard';

/**
 * The console's own preferences.
 *
 * ⚠ THE SCHEMA IS AN ALLOWLIST OF KEYS, NOT A FREE-FORM MAP. `shop_setting` is
 * key/value, so a route accepting `{ key, value }` would let anybody with a
 * staff session write any key at all, including ones a future feature reads
 * for something that matters. Naming the four fields costs four lines and
 * means the table can only ever hold what this file admits.
 *
 * ⭐ THE MESSAGE IS SPOKEN OUT LOUD, so it is validated as a SENTENCE: capped
 * at 120 characters, because the browser's speech synthesiser will happily
 * read a paragraph over a busy counter and there is no way to stop it once it
 * starts.
 */

const schema = z.object({
  newOrderSound: z.boolean().optional(),
  newOrderMessage: z.string().trim().min(1).max(120).optional(),
  /**
   * Bounded at both ends deliberately. Below ~5s the console is generating
   * more load than the shop does; above 60s it stops being an alarm and starts
   * being a surprise.
   */
  pollSeconds: z.number().int().min(5).max(60).optional(),
  repeatUntilSeen: z.boolean().optional(),
});

export async function POST(request: Request) {
  return guardedBy(request, schema, async (input, staff) => {
    await writeSettings(
      {
        ...(input.newOrderSound !== undefined && { 'console.newOrderSound': input.newOrderSound }),
        ...(input.newOrderMessage !== undefined && {
          'console.newOrderMessage': input.newOrderMessage,
        }),
        ...(input.pollSeconds !== undefined && { 'console.pollSeconds': input.pollSeconds }),
        ...(input.repeatUntilSeen !== undefined && {
          'console.repeatUntilSeen': input.repeatUntilSeen,
        }),
      },
      staff.id,
    );

    return NextResponse.json({ ok: true });
  });
}
