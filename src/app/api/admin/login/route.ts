import { NextResponse } from 'next/server';
import { z } from 'zod';

import { SESSION_COOKIE, SESSION_TTL_MS, issueSession, sessionCookieOptions, sessionsConfigured } from '@/auth/session';
import { signIn } from '@/db/repositories/staff';

/**
 * Staff sign-in.
 *
 * ⚠ NOT WRAPPED IN `guarded()`. That helper requires a staff session, and this
 * is the route that creates one. It therefore has to do its own validation,
 * which is why the schema is here rather than shared.
 *
 * ⚠ NO RATE LIMIT AT THE EDGE, ON PURPOSE. Throttling lives on the staff row
 * as `failed_attempts` and `locked_until`, because an in-memory limiter resets
 * on every deploy and this instance spins down after fifteen minutes idle. See
 * `src/db/repositories/staff.ts`.
 */

const schema = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(400),
});

export async function POST(request: Request) {
  if (!sessionsConfigured()) {
    // Fail closed, and say so plainly: this is an operator-facing route and
    // "not configured" is something only the operator can fix.
    return NextResponse.json({ reason: 'notConfigured' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ reason: 'malformedBody' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ reason: 'invalidBody' }, { status: 400 });

  const now = Date.now();
  const result = await signIn(parsed.data.username, parsed.data.password, now);

  if (!result.ok) {
    return NextResponse.json(
      result.reason === 'locked'
        ? { reason: 'locked', untilMs: result.untilMs }
        : { reason: 'invalid' },
      // 401 for both. A different status for "locked" would still be a signal,
      // but the body already distinguishes them and the operator needs it.
      { status: 401 },
    );
  }

  const token = issueSession(result.staff.id, now);
  if (token === null) return NextResponse.json({ reason: 'notConfigured' }, { status: 503 });

  const response = NextResponse.json({ ok: true, username: result.staff.username });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_MS / 1000));
  return response;
}
