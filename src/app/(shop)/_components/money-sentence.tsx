import { money } from '@/ui/format';

/**
 * The money sentence.
 *
 * This deployment currently places pay-on-delivery orders because the payment
 * adapter is not connected. The sentence therefore states the current payment
 * behaviour instead of promising the future card-authorisation flow.
 *
 * `04-PLAN` §10.4 specifies it rather than merely warning about it, because a
 * warning loses to a layout six weeks later:
 *
 *   - its own component, so a future restyle cannot quietly shrink it
 *   - `text-lead` (18px) minimum, never smaller
 *   - `--ink`, never `--ink-muted`. It is not secondary text
 *   - the estimate at 600 weight with tabular figures
 *   - directly above the pay button, with NOTHING between them
 *   - never inside an accordion, a tooltip or a disclosure
 *
 * ⚠ The element carries `data-money-sentence` so a test can assert its computed
 * size and position. If you are tempted to make this smaller, that assertion
 * is what will stop you, and it is there on purpose.
 */
export function MoneySentence({ estimateCents }: { estimateCents: number }) {
  return (
    <p data-money-sentence className="text-lead text-ink">
      Your estimated total is <span className="tnum font-semibold">{money(estimateCents)}</span>.
      {' '}After cutting and weighing, you pay the <strong className="font-semibold">exact amount</strong>
      {' '}on delivery.
    </p>
  );
}
