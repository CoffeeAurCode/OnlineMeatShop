'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ClockIcon,
  FishIcon,
  GearIcon,
  MapPinIcon,
  PackageIcon,
  ReceiptIcon,
  StorefrontIcon,
  SunHorizonIcon,
  TruckIcon,
} from '@phosphor-icons/react/dist/ssr';

import { RefreshButton } from './refresh-button';
import { SignOutButton } from './sign-out-button';

/**
 * ⭐ THE CONSOLE'S CHROME. Rebuilt 2026-08-19 against the operations-dashboard
 * reference the client supplied.
 *
 * ⚠ THE PREVIOUS RULE HERE WAS "NO CHROME AT ALL" — a title, a way back, and
 * nothing else, on the argument that every pixel of chrome is a pixel not
 * showing a number the owner needs. That argument was right for a 375px screen
 * and is wrong for a 1440px one, where the alternative to a rail is 900px of
 * empty page beside a 600px column. So the chrome is now RESPONSIVE rather
 * than absent:
 *
 *   below `lg`  a horizontal pill row and nothing else, exactly as much
 *               chrome as before, still one-handed, still thumb-reachable
 *   `lg` and up an icon rail down the left and a full top bar, because the
 *               owner reconciling the day on a laptop is a different session
 *               from the owner declaring stock on a phone at 6am
 *
 * ⚠ THE RAIL IS NOT A HAMBURGER. Nothing here hides behind a tap: every
 * destination the console has is on screen at every width, which is the one
 * property the old stack-of-screens layout had that a dashboard usually loses.
 */

export interface ConsoleSection {
  readonly href: string;
  readonly label: string;
  readonly hint: string;
  /*
   * ⚠ `typeof FishIcon` rather than Phosphor's own `Icon` type. The `/ssr`
   * entry point re-exports the components and NOT the types — importing `Icon`
   * from it type-checks against nothing and fails the build.
   */
  readonly icon: typeof FishIcon;
  /** In the top pill row as well as the rail. The day's work, not the setup. */
  readonly daily: boolean;
}

/**
 * Every screen the console has, in the order the owner meets them.
 *
 * ⚠ ONE LIST, TWO RENDERINGS. The rail and the pill row read from this array
 * rather than each keeping their own copy — a destination added to one and
 * forgotten in the other is how a screen becomes unreachable on a phone.
 */
export const SECTIONS: readonly ConsoleSection[] = [
  { href: '/admin', label: 'Today', hint: 'the day at a glance', icon: SunHorizonIcon, daily: true },
  { href: '/admin/orders', label: 'Orders', hint: 'what has been ordered', icon: ReceiptIcon, daily: true },
  { href: '/admin/stock', label: 'Stock', hint: 'what is on the counter', icon: PackageIcon, daily: true },
  { href: '/admin/catalog', label: 'Catalog', hint: 'names and prices', icon: FishIcon, daily: true },
  { href: '/admin/partners', label: 'Drivers', hint: 'who carries the boxes', icon: TruckIcon, daily: true },
  { href: '/admin/slots', label: 'Windows', hint: 'when the van goes out', icon: ClockIcon, daily: false },
  { href: '/admin/delivery-area', label: 'Area', hint: 'how far, and the fee', icon: MapPinIcon, daily: false },
  { href: '/admin/shop', label: 'Shop', hint: 'address, hours, phone', icon: StorefrontIcon, daily: false },
  { href: '/admin/settings', label: 'Settings', hint: 'the new-order sound', icon: GearIcon, daily: false },
];

/**
 * ⚠ SEGMENT-BOUNDARY MATCHING, NOT `startsWith` ON THE STRING. `/admin/orders`
 * must not light up for a future `/admin/ordersomething`, and `/admin` itself
 * would otherwise light for every screen in the console.
 *
 * `/admin/open` counts as Today: it is the closed-day screen, reached from
 * Today, and it is where the owner starts the morning.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin' || pathname === '/admin/open';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The whole console, wrapped.
 *
 * `children` arrives as a prop from the layout, so everything inside stays a
 * Server Component even though this file is a client boundary. Only the active
 * highlight needs the pathname; the pages do not.
 */
export function ConsoleChrome({
  shopName,
  operator,
  banners,
  children,
}: {
  shopName: string;
  operator: { username: string; role: string };
  /**
   * 🔴 THE OFFLINE BAR AND THE NEW-ORDER ALARM, AND THEY HAVE TO BE IN HERE.
   *
   * Both used to be `sticky top-0` siblings of the page. So is this header now,
   * and two sticky elements pinned to the same edge do not queue up — they
   * stack, and the one with the higher `z-index` wins. The alarm's z-30 beat
   * the header's z-20, so the moment the owner scrolled, the bar announcing a
   * new order covered the navigation they would use to go and look at it.
   *
   * One sticky wrapper, banners above the bar, both scrolling as one object.
   */
  banners?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    /*
     * The tinted ground the window floats on, and the window itself. Below
     * `lg` the frame is not drawn at all — see the header — so the page is a
     * plain scrolling column with no wasted gutter.
     */
    <div className="min-h-[100dvh] lg:p-5 xl:p-7">
      {/*
        🔴 NO `overflow-hidden` ON THE FRAME, EVER, AND IT HAD ONE FOR AN HOUR.
        It is the obvious way to make the banners and the rail respect the
        window's rounded corners, and it silently kills the sticky header: an
        `overflow` other than `visible` makes an element the scrollport its
        sticky descendants stick INSIDE, so the bar pinned to the top of a
        3600px-tall frame scrolls away with it and the navigation is gone for
        the rest of the page. Measured in the browser, not guessed.

        The corners are handled by the two elements that actually paint into
        them instead: the rail rounds its own left edge, the header block
        rounds its own top-right.
      */}
      <div className="console-frame flex min-h-[100dvh] max-lg:!rounded-none max-lg:!bg-transparent max-lg:!shadow-none lg:min-h-[calc(100dvh-2.5rem)] xl:min-h-[calc(100dvh-3.5rem)]">
        <ConsoleRail pathname={pathname} />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="sticky top-0 z-20 overflow-hidden lg:rounded-tr-[28px]">
            {banners}
            <ConsoleHeader pathname={pathname} shopName={shopName} operator={operator} />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * The icon rail. `lg` and up only.
 *
 * Icon-only with a `title` and an `aria-label`, which is what the reference
 * does and what keeps it to 76px — the labels are one hover away and the full
 * word is on the pill row directly beside it anyway.
 */
function ConsoleRail({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Console sections"
      className="hidden w-[76px] shrink-0 flex-col items-center gap-1 rounded-l-[28px] border-r border-line bg-soft py-5 lg:flex"
    >
      {/*
        ⚠ THE MARK IS THE BRAND GROUND, NOT THE ACCENT. Filled-accent is what
        says "this is the section you are in" two rows below it; a mark wearing
        the same fill reads as a tenth destination that is permanently selected.
      */}
      <span
        aria-hidden
        className="mb-3 grid size-11 place-content-center rounded-lg bg-brand-ground text-brand-ground-ink"
      >
        <FishIcon size={22} weight="fill" />
      </span>

      {SECTIONS.map((s) => {
        const active = isActive(pathname, s.href);
        const Glyph = s.icon;
        return (
          <Link
            key={s.href}
            href={s.href}
            title={`${s.label} — ${s.hint}`}
            aria-label={s.label}
            aria-current={active ? 'page' : undefined}
            className={`press grid size-12 place-content-center rounded-md transition-colors ${
              active
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:bg-raised hover:text-ink'
            }`}
          >
            <Glyph size={20} weight={active ? 'fill' : 'regular'} />
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The top bar: the mark, the pill row, and the operator.
 *
 * ⚠ THE PILL ROW IS THE ENTIRE NAVIGATION BELOW `lg`, so it carries every
 * section rather than only the daily five — the rail that would have held the
 * rest is not drawn at that width. From `lg` up the setup pills are hidden,
 * because the rail beside them already has those four.
 */
function ConsoleHeader({
  pathname,
  shopName,
  operator,
}: {
  pathname: string;
  shopName: string;
  operator: { username: string; role: string };
}) {
  return (
    <header className="border-b border-line bg-raised px-4 pt-3 pb-2 lg:px-6 lg:pt-4">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-content-center rounded-md bg-accent text-accent-ink lg:hidden">
          <FishIcon size={18} weight="fill" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-lead font-semibold tracking-tight">{shopName}</p>
          <p className="truncate text-micro text-muted">Owner&rsquo;s console</p>
        </div>

        <RefreshButton compact />

        {/*
          The operator, named. Two people share this console in a shop this
          size, and a screen that never says which of them is signed in is a
          screen that cannot explain why an audit row has somebody else's name
          on it.
        */}
        <div className="hidden items-center gap-2 rounded-full bg-soft py-1 pr-3 pl-1 sm:flex">
          <span
            aria-hidden
            className="grid size-7 place-content-center rounded-full bg-accent text-meta font-semibold text-accent-ink"
          >
            {operator.username.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-meta font-semibold">{operator.username}</span>
          <span className="text-micro text-muted">{operator.role.toLowerCase()}</span>
        </div>

        <SignOutButton />
      </div>

      <nav aria-label="Console sections" className="rail rail-bleed mt-2 flex gap-1.5 overflow-x-auto pb-1 lg:mt-3">
        {SECTIONS.map((s) => {
          const active = isActive(pathname, s.href);
          const Glyph = s.icon;
          return (
            <Link
              key={s.href}
              href={s.href}
              aria-current={active ? 'page' : undefined}
              className={`tap press flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-meta font-semibold transition-colors ${
                active
                  ? 'bg-accent text-accent-ink'
                  : 'bg-soft text-muted hover:text-ink'
              } ${s.daily ? '' : 'lg:hidden'}`}
            >
              <Glyph size={15} weight={active ? 'fill' : 'regular'} aria-hidden />
              {s.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
