import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { currentBusinessDay } from '@/db/repositories/availability';
import {
  listCatalog,
  localisedDescription,
  localisedName,
  prepsForProducts,
} from '@/db/repositories/catalog';
import { isLocale, t } from '@/i18n';
import { weight } from '@/ui/format';
import { resolveVoiceOrder, type VoiceQuantity } from '@/ui/voice-command';

import { ProductGrid } from '../_components/product-grid';
import { SearchField } from '../_components/search-field';
import { VoiceCartAction, type VoiceCartOutcome } from '../_components/voice-cart-action';

/**
 * Search.
 *
 * ⭐ IN MEMORY, OVER 37 PRODUCTS, ON PURPOSE. `02-DTM` Appendix A rules out a
 * search engine, and this is why that is not a compromise: the entire catalog
 * is already loaded to render the grid, it is a few dozen rows, and the shop
 * will never have thousands. Adding Postgres full-text search, let alone a
 * search service, would be more configuration than the feature is.
 *
 * Accent-insensitive in both directions, which matters more than it sounds:
 * a French customer types `huitres` without the circumflex and must still find
 * `Huîtres`, and an English customer typing `pate` must find `Paté`. `NFD`
 * decomposition plus stripping combining marks handles both with no table.
 */

export const metadata: Metadata = {
  // Not indexable: a search results page is per-visitor and has nothing a
  // crawler should hold on to.
  robots: { index: false, follow: true },
};

/** `Huîtres` and `huitres` compare equal. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; voice?: string; voiceQuantity?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { q = '', voice, voiceQuantity } = await searchParams;

  const query = fold(q);
  const day = await currentBusinessDay();
  const catalog = await listCatalog(day?.id ?? null);

  // Searched across BOTH languages regardless of the current locale. Someone
  // browsing in French may well know the fish by its English name, and there
  // is no cost to matching it.
  const items =
    query === ''
      ? []
      : catalog.filter((item) => {
          const haystack = fold(
            [
              item.name,
              item.nameFr ?? '',
              localisedName(item, locale),
              localisedDescription(item, locale) ?? '',
            ].join(' '),
          );
          return query.split(/\s+/).every((term) => {
            if (haystack.includes(term)) return true;
            // Speech engines commonly pluralise the thing requested. A spoken
            // "lobster rolls" must still find the catalog's "lobster roll".
            return term.length > 3 && term.endsWith('s') && haystack.includes(term.slice(0, -1));
          });
        });

  const preps = await prepsForProducts(items.map((i) => i.id));

  let voiceOutcome: VoiceCartOutcome | null = null;
  if (voice !== undefined) {
    if (items.length === 0) {
      voiceOutcome = { kind: 'message', tone: 'error', message: t(locale, 'voice.noMatch') };
    } else if (items.length > 1) {
      voiceOutcome = {
        kind: 'message',
        tone: 'info',
        message: t(locale, 'voice.ambiguous', { count: items.length }),
      };
    } else {
      const item = items[0];
      if (item !== undefined) {
        const parsedQuantity = parseVoiceQuantity(voiceQuantity);
        const minOrderG = item.pricing.mode === 'perKg' ? item.pricing.minOrder : item.pricing.wMin;
        const stepG = item.pricing.mode === 'perKg' ? item.pricing.step : item.pricing.wMin;
        const resolved =
          voiceQuantity !== undefined && parsedQuantity === null
            ? ({ ok: false, reason: 'invalidQuantity' } as const)
            : resolveVoiceOrder(
                {
                  pricingMode: item.pricing.mode,
                  minOrderG,
                  stepG,
                  availableG: item.availableG,
                },
                parsedQuantity,
              );

        if (!resolved.ok) {
          const messageKey =
            resolved.reason === 'wrongUnit'
              ? 'voice.usePackCount'
              : resolved.reason === 'insufficientStock'
                ? 'voice.insufficientStock'
                : 'voice.invalidQuantity';
          voiceOutcome = {
            kind: 'message',
            tone: 'error',
            message: t(locale, messageKey, { name: localisedName(item, locale) }),
          };
        } else {
          const prep = preps.get(item.id)?.[0] ?? null;
          const amount =
            item.pricing.mode === 'pack'
              ? t(
                  locale,
                  resolved.requestedG === minOrderG ? 'voice.onePack' : 'voice.packCount',
                  { count: resolved.requestedG / minOrderG },
                )
              : weight(resolved.requestedG, locale);
          const name = localisedName(item, locale);
          voiceOutcome = {
            kind: 'add',
            line: {
              productId: item.id,
              slug: item.slug,
              name,
              requestedG: resolved.requestedG,
              prepOptionId: prep?.id ?? null,
              prepLabel: prep?.label ?? null,
            },
            message: t(locale, prep === null ? 'voice.added' : 'voice.addedWithPrep', {
              amount,
              name,
              prep: prep?.label ?? '',
            }),
          };
        }
      }
    }
  }

  return (
    <div className="mx-auto max-w-[76rem] px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="!text-display-lg">{t(locale, 'nav.search')}</h1>

      <div className="mt-6 max-w-[32rem]">
        <SearchField locale={locale} initial={q} />
      </div>

      {voice !== undefined && voiceOutcome !== null && (
        <VoiceCartAction actionId={voice} outcome={voiceOutcome} />
      )}

      {query !== '' && (
        <>
          <p className="mt-8 text-meta text-muted" aria-live="polite">
            {t(locale, items.length === 1 ? 'shop.resultCountOne' : 'shop.resultCount', {
              count: items.length,
            })}
          </p>
          <div className="mt-4">
            <ProductGrid items={items} locale={locale} prepsByProduct={preps} />
          </div>
        </>
      )}
    </div>
  );
}

function parseVoiceQuantity(value: string | undefined): VoiceQuantity | null {
  if (value === undefined) return null;
  const match = /^(count|weight):(\d+)$/.exec(value);
  if (match === null) return null;
  const amount = Number(match[2]);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return match[1] === 'count'
    ? { kind: 'count', value: amount }
    : { kind: 'weight', grams: amount };
}
