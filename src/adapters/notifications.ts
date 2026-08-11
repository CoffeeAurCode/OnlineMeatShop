import 'server-only';

/**
 * The notification adapter boundary.
 *
 * ⚠ EMAIL IS THE ONLY CHANNEL AT LAUNCH (D18). SMS was cut because Canadian
 * A2P registration is weeks of carrier paperwork and was the likeliest cause
 * of a launch delay; email covers every notification in FR-24.
 *
 * The interface is nevertheless channel-shaped rather than email-shaped. That
 * is the one piece of forward-compatibility worth paying for here: adding SMS
 * later becomes a second implementation of `NotificationSender`, not a change
 * to the outbox, the scheduler, or any caller. It costs almost nothing now and
 * a redesign later.
 *
 * Nothing in here is ever called inside a database transaction. The outbox
 * exists precisely so that the state change commits first and the send happens
 * afterwards — see `src/jobs/handlers.ts`.
 */

export interface Notification {
  readonly channel: 'EMAIL' | 'SMS';
  readonly kind: string;
  readonly recipient: string;
  readonly payload: Record<string, unknown>;
}

export type SendOutcome =
  /** Delivered, or accepted for delivery by the provider. */
  | { readonly ok: true; readonly providerId?: string }
  /**
   * Failed, and `retryable` is the important half. A malformed address will
   * never succeed and must be abandoned rather than retried forever; a 503
   * from the provider must be retried rather than abandoned. Collapsing the
   * two loses a customer's confirmation email or fills the outbox with
   * permanent garbage.
   */
  | { readonly ok: false; readonly error: string; readonly retryable: boolean };

export interface NotificationSender {
  send(n: Notification): Promise<SendOutcome>;
}

/**
 * The no-op sender, used until a sending domain exists.
 *
 * Resend delivers only to the account owner's own address until a domain is
 * verified, and there is no domain yet (DQ-11). Configuring a real sender
 * before then would APPEAR to work in testing and silently fail for every
 * real customer — the worst of the available outcomes, so it is refused
 * rather than approximated.
 *
 * It logs and reports success, which keeps the outbox draining. It must be
 * swapped for the real one as part of the go-live checklist, and there is a
 * line there for exactly that.
 */
export class LoggingNotificationSender implements NotificationSender {
  async send(n: Notification): Promise<SendOutcome> {
    console.warn(
      JSON.stringify({
        level: 'warn',
        at: 'notifications.noop',
        message: 'No sender configured — notification logged, NOT delivered.',
        channel: n.channel,
        kind: n.kind,
      }),
    );
    return { ok: true };
  }
}
