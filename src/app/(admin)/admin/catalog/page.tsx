import { listProductsForAdmin } from '@/db/repositories/admin';
import { listCategories } from '@/db/repositories/catalog';

import { CatalogEditor } from '../_components/catalog-editor';
import { Screen } from '../_components/shell';

/**
 * The catalog.
 *
 * Creation exposes the durable choices explicitly: pricing mode, handling
 * class, tax code and slug. Pricing mode and handling remain immutable after
 * creation; changing either means retiring the old item and adding its replacement.
 */

export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
  const [products, categories] = await Promise.all([listProductsForAdmin(), listCategories('en')]);

  return (
    <Screen title="Catalog" back={{ href: '/admin', label: 'Today' }}>
      <CatalogEditor products={products} categories={categories} />
    </Screen>
  );
}
