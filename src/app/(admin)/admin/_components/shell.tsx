import Link from 'next/link';

/**
 * The console's three layout primitives. Everything else is plain markup.
 *
 * There are no cards here on purpose (`04-PLAN` §11): at density 6 a card is a
 * box drawn around information that was already grouped by being next to
 * itself, and it costs vertical space that a phone does not have.
 */

export function Screen({
  title,
  back,
  children,
}: {
  title: string;
  back?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-[38rem] px-4 pt-6">
      {back ? (
        <Link
          href={back.href}
          className="tap -ml-1 mb-1 inline-flex items-center px-1 text-body text-muted underline underline-offset-4"
        >
          {back.label}
        </Link>
      ) : null}
      <h1 className="text-display font-semibold tracking-tight">{title}</h1>
      {children}
    </main>
  );
}

/**
 * The primary action. Fixed to the bottom, full width, always in the thumb's
 * reach — `04-PLAN` §11 forbids a top-right Save, because reaching the top of
 * a phone one-handed means shifting grip on a wet phone over a tiled floor.
 */
export function PrimaryBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="elev fixed inset-x-0 bottom-0 z-10 bg-raised px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-[38rem]">{children}</div>
    </div>
  );
}

const BUTTON_BASE =
  'tap-lg flex w-full items-center justify-center rounded-sm px-4 text-lead font-semibold transition-colors active:scale-[0.99]';

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

/** A row in a hairline-separated list. The console's only grouping device. */
export function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4 border-b border-line py-3">{children}</div>;
}

/**
 * The empty state is not a decoration here, it is the 6am screen. "The day is
 * not open yet" is the most-seen screen in the console and gets the same care
 * as the weighing screen.
 */
export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-8 rounded-md border border-line bg-raised px-4 py-8">
      <p className="text-section font-semibold tracking-tight">{title}</p>
      <p className="mt-2 max-w-[65ch] text-body text-muted">{body}</p>
    </div>
  );
}
