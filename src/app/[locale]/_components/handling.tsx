'use client';

import { FishSimpleIcon, FlameIcon } from '@phosphor-icons/react/dist/ssr';

import { t, type Locale } from '@/i18n';

/**
 * How the four handling classes are shown, everywhere they are shown.
 *
 * ⚠ ONE MODULE, THREE CONSUMERS, AND A CYCLE IS WHY. The card, the item sheet
 * and the product page all need these, and the card already imports the sheet
 * (it opens one) while the sheet needs the label. Leaving them in the card
 * made `product-card -> item-sheet -> product-card` a real import cycle: the
 * bundler resolves it, and then one of the two modules gets a partially
 * initialised binding depending on which one the graph reaches first. That is
 * the class of bug that shows up as `undefined is not a component` on one page
 * in production and nowhere in development.
 */

/**
 * The handling class, in words, on every card.
 *
 * ⚠ COLOUR CARRIES NONE OF THIS. Raw, marinated, cooked-and-chilled and hot
 * are a food-safety taxonomy, and the last of them decides which delivery
 * windows the whole order may use. A customer with a dimmed phone at dusk, or
 * with any of the eight percent of colour vision that does not separate warm
 * hues, has to be able to read it. So the label is text; hot additionally gets
 * a flame glyph and the accent, because it is the one that constrains the
 * order, and the glyph is redundant with the words on purpose.
 */
export function HandlingLabel({
  handling,
  locale,
}: {
  handling: string;
  locale: Locale;
}) {
  const hot = handling === 'COOKED_HOT';

  return (
    <p
      className={`flex items-center gap-1 text-meta font-semibold ${hot ? 'text-hot' : 'text-muted'}`}
      title={hot ? t(locale, 'handling.hotExplainer') : undefined}
    >
      {hot && <FlameIcon size={13} weight="fill" aria-hidden className="shrink-0" />}
      {t(locale, `handling.${handling}`)}
    </p>
  );
}

/**
 * The filled hot pill, for the surfaces that show ONE product rather than a
 * grid of them: the product page and the item sheet. On a card it would be the
 * only filled element in a column of quiet metadata and would read as a
 * promotion rather than as a food-safety constraint.
 */
export function HotPill({ locale }: { locale: Locale }) {
  return (
    <span
      className="inline-flex w-fit items-center gap-1.5 rounded-full bg-hot px-3 py-1 text-meta font-semibold text-hot-ink"
      title={t(locale, 'handling.hotExplainer')}
    >
      <FlameIcon size={13} weight="fill" aria-hidden />
      {t(locale, 'handling.hotPillLabel')}
    </span>
  );
}

/**
 * ⭐ THE HONEST FALLBACK. §6: "Do not use generated images as product
 * photography."
 *
 * A generated fillet, oyster platter or dish misrepresents the cut, the
 * portion, the preparation or the stock the customer will actually receive,
 * and this shop's entire proposition is that what arrives is what was on the
 * counter. So a product with no photograph gets a branded surface carrying its
 * own name and its handling class, and no fake photograph, gradient, texture
 * or illustration.
 *
 * ⚠ THE SUBLINE IS THE HANDLING CLASS, NOT THE CATEGORY, and that is a
 * deliberate substitution. The system asks for the category; the catalog row
 * carries a `categoryId` and not a category NAME, so honouring it literally
 * would mean threading a lookup through the grid, the card and the sheet for a
 * tile that only appears when a photograph is missing. Handling is already on
 * the row, is already required to be visible, and answers the more useful
 * question.
 */
export function FallbackTile({
  name,
  handling,
  locale,
}: {
  name: string;
  handling: string;
  locale: Locale;
}) {
  return (
    <div className="fallback-tile absolute inset-0">
      <FishSimpleIcon size={26} aria-hidden className="mx-auto text-muted" />
      <p className="text-body font-semibold leading-snug text-ink">{name}</p>
      <p className="text-meta text-muted">{t(locale, `handling.${handling}`)}</p>
    </div>
  );
}
