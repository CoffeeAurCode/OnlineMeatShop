import Link from 'next/link';
import { CaretLeftIcon } from '@phosphor-icons/react/dist/ssr';

/**
 * The console's layout primitives. Everything else is plain markup.
 *
 * ⚠ THE OLD RULE WAS "NO CARDS, EVER" — at density 6 a card is a box drawn
 * around information that was already grouped by being next to itself, and it
 * costs vertical space a phone does not have. That was written for a stack of
 * single-purpose screens and it is the wrong rule for a dashboard, where the
 * whole job of the layout is to say which of nine things on screen belong
 * together. So cards are back, and the constraint that produced the old rule
 * is honoured differently: `Panel` and `StatTile` carry their padding at two
 * sizes, tight on a phone and generous on a laptop, so the density the owner
 * gets at 6am is the density they had before.
 *
 * ⚠ `Screen`, `PrimaryBar`, `Row` AND `Empty` KEEP THEIR SIGNATURES. Nine
 * screens call them; changing the shape of the primitives and the screens in
 * one pass would make the redesign impossible to review.
 */

/**
 * A console screen: the title block, then whatever the screen is.
 *
 * `width` is the one addition. Forms want a readable measure and get one; the
 * dashboard and the queue want the whole window and say so.
 *
 * ⚠ A `'form'` SCREEN IS WRAPPED IN A CARD AUTOMATICALLY. That is what
 * restyles the eight setup screens without touching any of them, and it is
 * also what keeps a 900px-wide laptop window from rendering a bare column of
 * inputs floating on an empty page.
 */
export function Screen({
  title,
  back,
  intro,
  action,
  width = 'form',
  children,
}: {
  title: string;
  back?: { href: string; label: string };
  /** One line under the title. The screen's own subtitle, not a heading. */
  intro?: React.ReactNode;
  /** Rendered opposite the title — a button, a chip, a count. */
  action?: React.ReactNode;
  /**
   * ⚠ `'plain'` IS THE DRIVER PORTAL'S, AND IT IS THE OLD BEHAVIOUR EXACTLY.
   * `/driver` imports this component, has no console chrome around it and is
   * only ever opened on a phone at the kerb; it wants the narrow column and no
   * card, which is what this screen was before the console was rebuilt.
   */
  width?: 'form' | 'wide' | 'plain';
  children: React.ReactNode;
}) {
  return (
    <main
      className={`mx-auto w-full px-4 pt-5 pb-8 lg:pt-6 ${
        width === 'plain'
          ? 'max-w-[38rem]'
          : width === 'form'
            ? /*
               * ⚠ THE FORM COLUMN IS CENTRED AND CAPPED, NOT LEFT-HUGGING. It
               * has to line up with the fixed action bar, which is centred in
               * the frame — a left-aligned column with a centred Save under it
               * reads as two unrelated things on a 1440px screen. `--bar-measure`
               * below is the same number.
               */
              'max-w-[48rem] lg:px-6'
            : 'max-w-[86rem] lg:px-6'
      }`}
    >
      {back ? (
        <Link
          href={back.href}
          className="tap -ml-1 inline-flex items-center gap-1 px-1 text-meta font-semibold text-muted hover:text-ink"
        >
          <CaretLeftIcon size={13} weight="bold" aria-hidden />
          {back.label}
        </Link>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-display-lg font-bold tracking-tight">{title}</h1>
          {intro ? <p className="mt-1 text-body text-muted">{intro}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {width === 'form' ? (
        <div className="card mt-5 px-4 py-5 sm:px-6 sm:py-6">{children}</div>
      ) : (
        <div className="mt-5">{children}</div>
      )}
    </main>
  );
}

/**
 * ⭐ A DASHBOARD REGION. The reference's repeated shape: a white card with a
 * title, an optional control opposite it, and content below.
 *
 * `span` is a grid hint rather than a width — the dashboard lays itself out on
 * a 12-column grid at `xl`, and a panel that had to know its own pixel width
 * would have to be told again every time the grid changed.
 */
export function Panel({
  title,
  action,
  note,
  className = '',
  children,
}: {
  title: string;
  action?: React.ReactNode;
  /** A line of explanation under the title. Where a caveat belongs. */
  note?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`card flex min-w-0 flex-col px-4 py-4 sm:px-5 sm:py-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lead font-semibold tracking-tight">{title}</h2>
          {note ? <p className="mt-0.5 text-meta text-muted">{note}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-3 min-w-0 flex-1">{children}</div>
    </section>
  );
}

/**
 * ⭐ THE STAT TILE. The reference's most characteristic element: a very large
 * number, its label under it, a second line of context, and a tinted disc
 * carrying a glyph opposite.
 *
 * ⚠ THE SECOND LINE IS NOT A TREND, AND IT MUST NEVER BECOME ONE. Every tile
 * in the reference carries an invented percentage against an invented previous
 * period; this shop has one open business day at a time and nothing rolls over
 * (`CLAUDE.md` §2), so there is no previous period to compare against and any
 * number in that position would be fabricated. What goes there instead is a
 * fact that is true right now — a share of today's total, a breakdown, or a
 * sentence saying there is nothing to say.
 *
 * `tone` selects the disc and figure colour from the semantic tokens only.
 * `plain` is the default because a screen of six coloured tiles colour-codes
 * nothing; the two that mean "look at me" are the ones that get a hue.
 */
const TONES = {
  plain: 'text-ink',
  accent: 'text-accent',
  success: 'text-success',
  danger: 'text-danger',
} as const;

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'plain',
  href,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  icon: React.ReactNode;
  tone?: keyof typeof TONES;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className={`tnum text-display-lg font-bold tracking-tight ${TONES[tone]}`}>{value}</p>
        <span
          aria-hidden
          className={`tile-disc grid size-9 shrink-0 place-content-center rounded-full ${TONES[tone]}`}
        >
          {icon}
        </span>
      </div>
      <p className="mt-1 text-meta font-semibold">{label}</p>
      {hint ? <p className="mt-0.5 text-micro text-muted">{hint}</p> : null}
    </>
  );

  const shape = 'card min-w-0 px-3.5 py-3.5 sm:px-4 sm:py-4';

  return href === undefined ? (
    <div className={shape}>{body}</div>
  ) : (
    <Link href={href} className={`${shape} tile-link press-card block`}>
      {body}
    </Link>
  );
}

/**
 * A status chip. One shape for order status, handling class and any other
 * short piece of state, so two of them side by side always look like two of
 * the same kind of thing.
 */
export function Chip({
  children,
  tone = 'plain',
}: {
  children: React.ReactNode;
  tone?: 'plain' | 'accent' | 'success' | 'danger' | 'hot';
}) {
  const fills = {
    plain: 'bg-soft text-muted',
    accent: 'bg-accent-wash text-accent',
    success: 'bg-success-wash text-success',
    danger: 'bg-danger-wash text-danger',
    hot: 'bg-hot-wash text-hot',
  } as const;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold ${fills[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * A proportion, drawn. Used for stock remaining and for how full a delivery
 * window is — the two places on this console where a fraction is easier to
 * judge as a length than as two numbers.
 *
 * ⚠ THE NUMBERS ARE ALWAYS PRINTED BESIDE IT BY THE CALL SITE. A bar is a
 * summary, and the owner acts on the figure.
 */
export function Meter({
  filled,
  total,
  tone = 'accent',
}: {
  filled: number;
  total: number;
  tone?: 'accent' | 'success' | 'danger';
}) {
  const pct = total <= 0 ? 0 : Math.min(100, Math.round((filled / total) * 100));
  const fills = { accent: 'bg-accent', success: 'bg-success', danger: 'bg-danger' } as const;

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-soft">
      <div className={`h-full rounded-full ${fills[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * The primary action. Fixed to the bottom, full width, always in the thumb's
 * reach — `04-PLAN` §11 forbids a top-right Save, because reaching the top of
 * a phone one-handed means shifting grip on a wet phone over a tiled floor.
 *
 * ⚠ IT IS INSET TO THE FRAME FROM `lg` UP. Left at `inset-x-0` it ran under
 * the icon rail and off both edges of the floating window, which reads as a
 * bar belonging to the browser rather than to the screen it is saving.
 */
export function PrimaryBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="elev action-bar fixed z-30 bg-raised px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:px-6">
      <div className="mx-auto w-full max-w-[var(--bar-measure,38rem)]">{children}</div>
    </div>
  );
}

const BUTTON_BASE =
  'tap-lg flex w-full items-center justify-center rounded-md px-4 text-lead font-semibold transition-colors active:scale-[0.99]';

export function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`${BUTTON_BASE} bg-accent text-accent-ink hover:bg-accent-hover disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`${BUTTON_BASE} border border-line bg-raised text-ink disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

/** A row in a hairline-separated list. Still the console's densest grouping. */
export function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-b-0">
      {children}
    </div>
  );
}

/**
 * The empty state is not a decoration here, it is the 6am screen. "The day is
 * not open yet" is the most-seen screen in the console and gets the same care
 * as the weighing screen.
 */
export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-line border-dashed bg-soft px-4 py-8 text-center">
      <p className="text-lead font-semibold tracking-tight">{title}</p>
      <p className="mx-auto mt-1 max-w-[55ch] text-meta text-muted">{body}</p>
    </div>
  );
}
