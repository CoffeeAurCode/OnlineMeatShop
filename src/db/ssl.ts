import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TLS settings for every connection to Postgres.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * Supabase does not use a publicly-trusted CA for Postgres. Connecting with
 * Node's default trust store fails:
 *
 *     SELF_SIGNED_CERT_IN_CHAIN: self-signed certificate in certificate chain
 *
 * The chain actually presented by the pooler is:
 *
 *     *.pooler.supabase.com  ←  Supabase Intermediate 2021 CA
 *                            ←  Supabase Root 2021 CA
 *
 * The advice found everywhere for this error is `rejectUnauthorized: false`,
 * which does not fix the error so much as stop asking the question. It
 * disables certificate verification entirely, so anything that can answer on
 * that hostname — a hijacked DNS answer, a hostile network on the path — can
 * present its own certificate and read every row and the password itself. For
 * a database holding customers' names, addresses and phone numbers that is not
 * an acceptable default.
 *
 * Instead we pin Supabase's own root and verify against it. Verified working
 * against both the transaction pooler (6543) and the session pooler (5432).
 *
 * The certificate is a public root, not a secret — it is safe in this public
 * repository, and it is the same certificate the Supabase dashboard offers for
 * download.
 *
 * WHY IT IS NOT UNCONDITIONAL
 * ---------------------------
 * It used to be. Every connection got the pinned CA and `rejectUnauthorized:
 * true`, with no way to say otherwise — which is correct for Supabase and
 * impossible for anything else. A local PostgreSQL container and a GitHub
 * Actions service container both serve **plaintext**: they have no certificate
 * at all, so a client demanding TLS cannot connect, full stop. That made the
 * integration and concurrency suites — the project's actual correctness gate —
 * unrunnable, which is a poor trade for a setting that was never protecting
 * anything on a loopback socket in the first place.
 *
 * So the decision is made per connection string, and it is made in the safe
 * direction: **TLS unless the target is demonstrably local.** Anything this
 * function cannot parse or does not recognise gets TLS. There is no
 * environment variable to set, because the failure mode of an environment
 * variable is that it is set in the wrong environment.
 */

const CA_FILE = 'supabase-prod-ca-2021.crt';

/**
 * Resolved from the process working directory rather than `import.meta.url`.
 *
 * `next build` with `output: 'standalone'` rewrites and relocates the compiled
 * modules, so a path derived from this file's own location does not survive
 * the move. The working directory of the standalone server is the application
 * root, which is where `certs/` is copied to — see `outputFileTracingIncludes`
 * in next.config.ts, which is what makes the file exist there at all.
 */
const CA_PATH = join(process.cwd(), 'certs', CA_FILE);

let cached: string | undefined;

function rootCertificate(): string {
  cached ??= readFileSync(CA_PATH, 'utf8');
  return cached;
}

/**
 * `false` is `pg`'s way of saying "plain TCP, no TLS negotiation" — it is not
 * a weakened TLS, it is no TLS, and it is only ever returned for a loopback
 * address.
 */
export type PostgresTls = { ca: string; rejectUnauthorized: true } | false;

/**
 * Loopback only. Not "any private address", not "anything that isn't
 * Supabase". A database on another host on the LAN is still a database
 * reachable across a network someone else may also be on.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * TLS settings for a given connection string.
 *
 * @param connectionString the URL the pool or the migration tool will dial.
 */
export function postgresTls(connectionString: string): PostgresTls {
  let host: string;
  let sslmode: string | null;

  try {
    const url = new URL(connectionString);
    // `postgresql:` is not a "special" scheme to the WHATWG URL parser, so its
    // host is an OPAQUE host: not lowercased, and IPv6 literals keep their
    // square brackets. `hostname` therefore returns `LOCALHOST` verbatim and
    // `[::1]` with the brackets still on — measured, not assumed, because the
    // http-shaped intuition (lowercased, brackets stripped) is wrong here and
    // silently sends a loopback connection down the TLS path.
    host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    sslmode = url.searchParams.get('sslmode');
  } catch {
    // Not a URL we can read — a libpq key=value string, or a malformed one.
    // Fail towards encryption: an unparseable string is not evidence of a
    // local database.
    return { ca: rootCertificate(), rejectUnauthorized: true };
  }

  if (LOOPBACK.has(host)) {
    // A local test database. It has no certificate to verify, and the socket
    // does not leave the machine.
    return false;
  }

  if (sslmode === 'disable') {
    // Explicit, and honoured — except where honouring it would send a real
    // customer database across the internet in the clear. That is not a
    // preference someone can hold; it is a typo or a copied-and-pasted string,
    // and it should fail loudly at the moment it is written rather than
    // quietly at every query afterwards.
    if (host.endsWith('.supabase.com') || host.endsWith('.supabase.co')) {
      throw new Error(
        `Refusing sslmode=disable against ${host}. That is the hosted database, ` +
          'and plaintext would expose every customer row and the password itself. ' +
          'Remove sslmode=disable, or point at a local database.',
      );
    }
    return false;
  }

  return { ca: rootCertificate(), rejectUnauthorized: true };
}
