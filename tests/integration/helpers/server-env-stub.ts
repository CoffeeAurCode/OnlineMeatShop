/**
 * Test double for `@/server-env`, aliased in vitest.integration.config.ts.
 *
 * WHY THIS EXISTS, AND WHY THE REAL MODULE IS NOT LOOSENED INSTEAD
 * ---------------------------------------------------------------
 * The real module calls React's `experimental_taintUniqueValue`, which only
 * exists when Next.js enables the taint experiment. Under plain vitest the
 * export is `undefined`, so importing any repository throws.
 *
 * The tempting fix is a `typeof taintUniqueValue === 'function'` guard in
 * `src/server-env.ts`. That is worse than it looks: it makes the defence
 * silently optional, so the day someone drops `experimental.taint` from
 * next.config.ts the taint stops working in PRODUCTION and every test still
 * passes. A security control that degrades quietly is the failure mode the
 * whole four-layer setup exists to avoid.
 *
 * So the real module stays strict and the test aliases past it. What is lost
 * is that these suites do not exercise the taint — which is fine, because the
 * taint is a request-time guarantee and it has its own coverage: the
 * build-artifact and request-time canary scans in CI, each demonstrated
 * against a planted leak.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const serverEnv = {
  databaseUrl: () => required('DATABASE_URL'),
  supabaseServiceRoleKey: () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test_service_role',
  stripeSecretKey: () => process.env.STRIPE_SECRET_KEY ?? 'sk_test_fake',
  stripeWebhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test_fake',
  resendApiKey: () => process.env.RESEND_API_KEY ?? 're_test_fake',
  twilioAuthToken: () => process.env.TWILIO_AUTH_TOKEN ?? 'test_twilio',
} as const;
