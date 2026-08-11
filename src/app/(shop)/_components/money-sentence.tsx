import { money } from '@/ui/format';

/**
 * ⭐ THE MONEY SENTENCE.
 *
 * `NFR-2` made visible, and a commitment already made to the client in
 * `WHATSAPP-architecture-options.md`. It is the single line that separates this
 * shop from every competitor whose checkout says "your card will be charged an
 * estimate".
 *
 * `04-PLAN` §10.4 specifies it rather than merely warning about it, because a
 * warning loses to a layout six weeks later:
 *
 *   - its own component, so a future restyle cannot quietly shrink it
 *   - `text-lead` (18px) minimum, never smaller
 *   - `--ink`, never `--ink-muted`. It is not secondary text
 *   - the amount at 600 weight with tabular figures
 *   - directly above the pay button, with NOTHING between them
 *   - never inside an accordion, a tooltip or a disclosure
 *
 * ⚠ The element carries `data-money-sentence` so a test can assert its computed
 * size and position. If you are tempted to make this smaller, that assertion
 * is what will stop you, and it is there on purpose.
 */
export function MoneySentence({ holdCents }: { holdCents: number }) {
  return (
    <p data-money-sentence className="text-lead text-ink">
      We&rsquo;ll hold <span className="tnum font-semibold">{money(holdCents)}</span>. Once your
      order is cut and weighed we charge the <strong className="font-semibold">exact amount</strong>,
      never more than the hold.
    </p>
  );
}
