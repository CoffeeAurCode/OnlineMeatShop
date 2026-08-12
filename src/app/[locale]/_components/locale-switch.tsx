'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { LOCALES, pathForLocale, t, type Locale } from '@/i18n';

/**
 * The language toggle.
 *
 * ⚠ IT IS A LINK, NOT A BUTTON, and that is not a detail. `/fr/shop` and
 * `/en/shop` are two real URLs; a button that swapped strings in place would
 * leave the address bar lying, break the back button, make the page
 * unshareable in the language it is being read in, and hide half the site from
 * a crawler. Bill 96 asks for French to be available and at least as prominent
 * as English, and "available" means at an address.
 *
 * Both locales are always rendered rather than showing only the other one. Two
 * items with the current one marked is how someone confirms which language
 * they are already in, which matters most to the person who landed in the
 * wrong one.
 *
 * `prefetch={false}`: prefetching the whole other-language page for a control
 * that most visitors never touch is a lot of bytes on a phone for nothing.
 */
export function LocaleSwitch({ current }: { current: Locale }) {
  const pathname = usePathname();

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border border-line bg-raised p-0.5"
      role="group"
      aria-label={t(current, 'meta.switchTo')}
    >
      {LOCALES.map((locale) => {
        const active = locale === current;
        return (
          <Link
            key={locale}
            href={pathForLocale(pathname, locale)}
            prefetch={false}
            hrefLang={locale}
            aria-current={active ? 'true' : undefined}
            className={`grid min-h-9 min-w-10 place-items-center rounded-full px-2 text-[0.6875rem] font-bold uppercase tracking-[0.06em] transition-colors duration-200 ${
              active ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {locale}
            <span className="sr-only">{t(locale, 'meta.localeName')}</span>
          </Link>
        );
      })}
    </div>
  );
}
