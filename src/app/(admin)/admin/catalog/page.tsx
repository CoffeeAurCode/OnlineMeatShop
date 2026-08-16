import { listProductsForAdmin } from '@/db/repositories/admin';

import { CatalogEditor } from '../_components/catalog-editor';
import { Screen } from '../_components/shell';

/**
 * The catalog.
 *
 * ⚠ THIS SCREEN EDITS PRODUCTS; IT DOES NOT CREATE THEM. Creating one means
 * choosing a pricing mode, a handling class, a tax code and a slug — four
 * decisions with lasting consequences, two of which cannot be changed
 * afterwards. `scripts/seed-catalog.mjs` still owns that, and a create form is
 * the next piece of work here rather than a gap that was overlooked.
 */

export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
  const products = await listProductsForAdmin();

  return (
    <Screen title="Catalog" back={{ href: '/admin', label: 'Today' }}>
      <CatalogEditor products={products} />
    </Screen>
  );
}
