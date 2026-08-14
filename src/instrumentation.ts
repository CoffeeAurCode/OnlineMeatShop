/**
 * ⭐ THE STARTUP GUARD. It runs ONCE, before the server accepts any request.
 *
 * Every dangerous configuration in this application is now caught here rather
 * than by the first customer who trips over it.
 *
 * ══ WHY THIS FILE EXISTS AT ALL ═══════════════════════════════════════════
 *
 * `paymentAdapter()` and `phoneVerifier()` both refuse to construct in
 * production without an explicit opt-in, and the comments on them claimed that
 * refusal happened "at startup". IT DID NOT. Both are called inside route
 * handlers, so a production deployment with no processor configured started
 * perfectly happily and then failed at the first CHECKOUT -- which is the
 * single worst moment to discover it, and the one place a failure costs a real
 * customer and a real order.
 *
 * A comment that describes a safety property the code does not have is worse
 * than no comment, because it stops the next person looking. This file makes
 * the claim true.
 *
 * ⚠ THROWING HERE FAILS THE DEPLOY, ON PURPOSE. Render's health check never
 * passes, so the previous version keeps serving. That is the correct outcome:
 * a shop that cannot take money must not replace a shop that can.
 */
export async function register(): Promise<void> {
  // Only the Node runtime has the environment and the modules below. The edge
  // runtime instance would throw on the imports for reasons unrelated to
  // configuration.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NODE_ENV !== 'production') return;

  const problems: string[] = [];

  /*
   * Payments. The stub places real orders, reserves real stock, and takes no
   * money. A demo deployment that does that deliberately is a coherent thing
   * to want; one that does it by accident is the most expensive failure this
   * shop can have.
   */
  if (process.env.ALLOW_STUB_PAYMENTS !== 'true') {
    problems.push(
      'No real payment adapter is configured. StubPaymentAdapter takes no money. ' +
        'Set ALLOW_STUB_PAYMENTS=true for a deliberate no-money demo deployment, ' +
        'or configure a processor.',
    );
  }

  /*
   * Staff sessions. Without a secret the console fails closed and NOBODY can
   * sign in, including the owner. That is safe but it is silently useless, and
   * the owner discovers it at 6am on the first trading day.
   */
  const secret = process.env.STAFF_SESSION_SECRET;
  if (secret === undefined || secret.length < 32) {
    problems.push(
      'STAFF_SESSION_SECRET is missing or shorter than 32 characters, so no staff ' +
        'session can be signed and the console is unreachable. Generate one with: ' +
        'node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64url\'))"',
    );
  }

  /*
   * ⚠ THE ONE THAT IS A SECURITY PROBLEM RATHER THAN AN AVAILABILITY ONE.
   * The stub verifier accepts a single fixed code for every number, so anyone
   * who knows it can read anyone's order history. There is deliberately no
   * opt-in for this and there must never be one.
   */
  if (process.env.DEV_VERIFICATION_CODE !== undefined && process.env.DEV_VERIFICATION_CODE !== '') {
    problems.push(
      'DEV_VERIFICATION_CODE is set in production. The stub phone verifier accepts ' +
        'one fixed code for every number, so this would expose order history to ' +
        'anyone who knows it. Unset it; order history is then simply unavailable.',
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start. ${problems.length} configuration problem(s):\n\n` +
        problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n\n') +
        '\n\nThese are checked at startup so they fail the deploy rather than the ' +
        'first customer. See CODEBASE-CONTEXT.md section 1.2.\n',
    );
  }
}
