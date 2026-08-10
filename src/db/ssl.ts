import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TLS settings for every connection to Supabase Postgres.
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
 */

/**
 * Resolved from the process working directory rather than `import.meta.url`.
 *
 * `next build` with `output: 'standalone'` rewrites and relocates the compiled
 * modules, so a path derived from this file's own location does not survive
 * the move. The working directory of the standalone server is the application
 * root, which is where `certs/` is copied to — see `outputFileTracingIncludes`
 * in next.config.ts, which is what makes the file exist there at all.
 */
const CA_PATH = join(process.cwd(), 'certs', 'supabase-prod-ca-2021.crt');

let cached: string | undefined;

function rootCertificate(): string {
  cached ??= readFileSync(CA_PATH, 'utf8');
  return cached;
}

/**
 * `rejectUnauthorized: true` is the entire point — the pinned CA is only
 * meaningful if the result is actually enforced.
 */
export function supabaseTls(): { ca: string; rejectUnauthorized: true } {
  return { ca: rootCertificate(), rejectUnauthorized: true };
}
