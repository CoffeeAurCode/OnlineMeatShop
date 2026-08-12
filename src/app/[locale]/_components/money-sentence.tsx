import { WarningIcon } from '@phosphor-icons/react/dist/ssr';

import { t, type Locale } from '@/i18n';
import { money } from '@/ui/format';

/**
 * ⭐ THE MONEY SENTENCE. `04-PLAN` §10.4 specifies it rather than merely
 * warning about it, because a warning loses to a layout six weeks later:
 *
 *   - its own component, so a future restyle cannot quietly shrink it
 *   - `text-lead` (18px) minimum, never smaller
 *   - `--ink`, never `--ink-muted`. It is not secondary text
 *   - the estimate at 600 weight with tabular figures
 *   - directly above the pay button, with NOTHING between them
 *   - never inside an accordion, a tooltip or a disclosure
 *
 * ⚠ The element carries `data-money-sentence` so a test can assert its
 * computed size and position. If you are tempted to make this smaller, that
 * assertion is what will stop you, and it is there on purpose.
 *
 * The wording now describes the REAL flow again, hold-the-ceiling and
 * capture-the-exact-amount, because the lifecycle exists. It runs against a
 * stub adapter, which is what the banner below says.
 */
export function MoneySentence({
  estimateCents,
  locale,
}: {
  estimateCents: number;
  locale: Locale;
}) {
  return (
    <p data-money-sentence className="text-lead text-ink">
      <span className="tnum font-semibold">
        {t(locale, 'payment.moneySentenceEstimate', { amount: money(estimateCents, locale) })}
      </span>{' '}
      {t(locale, 'payment.moneySentenceRest')}
    </p>
  );
}

/**
 * ⚠ "TEST ORDER, NO PAYMENT TAKEN", and it has to be unmissable.
 *
 * The orders this prototype places are `pay_mode = PREPAID` and go through the
 * full authorise-then-capture lifecycle. That is deliberate: it is the branch
 * worth testing. The consequence is that NOTHING IN THE DATA distinguishes
 * them from a real prepaid order except the adapter identity, so the only
 * thing telling a human being that no money moved is this band.
 *
 * It appears on checkout, on the confirmation, and on the tracking page. Not
 * a dismissible toast, not a footnote, not muted text.
 */
export function TestOrderBanner({ locale }: { locale: Locale }) {
  return (
    <aside
      data-test-order-banner
      role="note"
      className="flex items-start gap-3 rounded-md border-2 border-accent bg-soft px-4 py-3"
    >
      <WarningIcon size={22} weight="fill" aria-hidden className="mt-0.5 shrink-0 text-accent" />
      <div>
        <p className="text-body font-semibold text-ink">{t(locale, 'payment.testBannerTitle')}</p>
        <p className="mt-1 text-meta text-ink/80">{t(locale, 'payment.testBannerBody')}</p>
      </div>
    </aside>
  );
}
