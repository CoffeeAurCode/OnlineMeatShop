'use client';

import { useState } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/ssr';

import { t, type Locale } from '@/i18n';

/**
 * The search box.
 *
 * A real `<form method="get">`, not an onChange router push. It works before
 * hydration, the browser gives it history and autofill for free, and it does
 * not fire a request per keystroke on a phone connection. Search here runs
 * over a few dozen products; instant-as-you-type would be a lot of machinery
 * to save one keypress.
 */
export function SearchField({ locale, initial }: { locale: Locale; initial: string }) {
  const [value, setValue] = useState(initial);

  return (
    <form action={`/${locale}/search`} method="get" role="search" className="flex gap-2">
      <div className="relative min-w-0 flex-1">
        <label htmlFor="q" className="sr-only">
          {t(locale, 'nav.search')}
        </label>
        <MagnifyingGlassIcon
          size={18}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          id="q"
          name="q"
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t(locale, 'nav.searchPlaceholder')}
          className="tap w-full rounded-sm border border-line bg-raised pl-10 pr-3 text-body text-ink placeholder:text-muted"
        />
      </div>
      <button
        type="submit"
        className="tap inline-flex shrink-0 items-center rounded-sm bg-accent px-5 text-body font-semibold text-accent-ink transition-colors hover:bg-accent-hover active:scale-[0.98]"
      >
        {t(locale, 'nav.search')}
      </button>
    </form>
  );
}
