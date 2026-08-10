import 'server-only';

/**
 * The single boundary at which server-side secrets are read.
 *
 * `import 'server-only'` makes this module a BUILD ERROR if anything in a
 * client component imports it, directly or transitively. That is a stronger
 * guarantee than review or lint: the mistake cannot compile.
 *
 * Rules:
 *   - Every server secret is read HERE and nowhere else.
 *   - Nothing in this file is ever passed as a prop to a client component.
 *     Doing so serialises it into the RSC payload, which is HTML the browser
 *     receives. CI builds with canary values and scans for exactly that
 *     (scripts/scan-secrets.mjs).
 *   - Public configuration belongs in NEXT_PUBLIC_* and does not belong here.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Fail loudly at first use rather than producing `undefined` that surfaces
    // later as a confusing runtime error somewhere unrelated.
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const serverEnv = {
  /** Pooled connection. The application always uses this one. */
  databaseUrl: () => required('DATABASE_URL'),

  /**
   * Deliberately absent: DIRECT_DATABASE_URL. It bypasses the pooler and
   * belongs only to the migration job and the backup dump, which run outside
   * the web service. It is not in the web service's environment at all
   * (see render.yaml).
   */

  supabaseServiceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),
  stripeSecretKey: () => required('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: () => required('STRIPE_WEBHOOK_SECRET'),
  resendApiKey: () => required('RESEND_API_KEY'),
  twilioAuthToken: () => required('TWILIO_AUTH_TOKEN'),
} as const;
