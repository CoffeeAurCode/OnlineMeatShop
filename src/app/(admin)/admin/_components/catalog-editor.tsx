'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { AdminProduct } from '@/db/repositories/admin';
import { ADMIN_LOCALE, money } from '@/ui/format';

import { PrimaryBar, PrimaryButton, Row } from './shell';

/**
 * The catalog: prices, names, and whether a thing is sold at all.
 *
 * ⭐ EVERY SAVE BUMPS `catalog_version` ON THE SERVER, and that is what makes a
 * price change safe. A customer whose basket was priced before the edit gets
 * `priceChanged` at checkout and is asked to confirm the new number, rather
 * than being charged it silently. This screen is the reason that precondition
 * exists.
 *
 * ⚠ ONE PRODUCT AT A TIME, NOT A BULK SAVE. The stock screen saves the whole
 * list in one go because the owner works down it once a morning; this one is
 * opened to change one price. A bulk save here would mean every catalog visit
 * bumped the version and invalidated every basket in flight, whether or not
 * anything actually changed.
 *
 * ⚠ THE PRICING MODE AND THE HANDLING CLASS ARE NOT EDITABLE, and the screen
 * shows them as plain text so it is obvious they are facts rather than
 * omissions. Flipping a pack to per-kg changes which columns must be NULL;
 * flipping handling to hot retroactively changes which delivery windows whole
 * ORDERS may use. Both are "retire this and add a new one".
 */

export function CatalogEditor({ products }: { products: readonly AdminProduct[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/catalog', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError('That did not save. Nothing has changed.');
        setBusy(false);
        return false;
      }
      router.refresh();
      setBusy(false);
      setEditing(null);
      return true;
    } catch {
      setError('That did not save. Check the connection and try again.');
      setBusy(false);
      return false;
    }
  }

  return (
    <>
      <p className="mt-4 max-w-[60ch] text-meta text-muted">
        Changing a price here takes effect immediately. Anyone with a basket priced a moment ago is
        asked to confirm the new total at checkout rather than being charged it quietly.
      </p>

      {error !== null && (
        <p role="alert" className="mt-4 rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
          {error}
        </p>
      )}

      <div className="mt-6">
        {products.map((p) => (
          <div key={p.id}>
            <Row>
              <span className="min-w-0">
                <span className={`block text-body font-semibold ${p.active ? '' : 'text-muted'}`}>
                  {p.name}
                  {p.active ? '' : ' · not sold'}
                </span>
                <span className="tnum block text-meta text-muted">
                  {p.categoryName ?? 'uncategorised'} · {p.handling.toLowerCase().replace('_', ' ')}{' '}
                  ·{' '}
                  {p.pricingMode === 'pack'
                    ? money(p.packPriceCents ?? 0, ADMIN_LOCALE)
                    : `${money(p.ratePerKgCents ?? 0, ADMIN_LOCALE)} / kg`}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(editing === p.id ? null : p.id)}
                className="tap shrink-0 text-meta text-muted underline underline-offset-4 disabled:opacity-50"
              >
                {editing === p.id ? 'Close' : 'Edit'}
              </button>
            </Row>

            {editing === p.id && <ProductFields product={p} busy={busy} onSave={patch} />}
          </div>
        ))}
      </div>

      <PrimaryBar>
        <PrimaryButton type="button" onClick={() => router.push('/admin')}>
          Done
        </PrimaryButton>
      </PrimaryBar>
    </>
  );
}

function ProductFields({
  product: p,
  busy,
  onSave,
}: {
  product: AdminProduct;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [name, setName] = useState(p.name);
  const [nameFr, setNameFr] = useState(p.nameFr ?? '');
  const [priceCents, setPriceCents] = useState(
    String(p.pricingMode === 'pack' ? (p.packPriceCents ?? 0) : (p.ratePerKgCents ?? 0)),
  );
  const [active, setActive] = useState(p.active);

  const cents = Number(priceCents.replace(/\D/g, '')) || 0;

  return (
    <div className="grid gap-3 border-b border-line bg-soft px-3 py-4">
      <label className="grid gap-1">
        <span className="text-meta text-muted">Name (English)</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="tap rounded-sm border border-line bg-raised px-3 text-body text-ink"
        />
      </label>

      <label className="grid gap-1">
        {/*
          ⚠ Bill 96 applies to a commercial site in Quebec, so the French name
          is not a nice-to-have. A product with no `name_fr` falls back to the
          English one on the French storefront, which is exactly the state the
          law is about.
        */}
        <span className="text-meta text-muted">Name (French)</span>
        <input
          value={nameFr}
          onChange={(e) => setNameFr(e.target.value)}
          className="tap rounded-sm border border-line bg-raised px-3 text-body text-ink"
        />
      </label>

      <label className="grid gap-1">
        <span className="text-meta text-muted">
          {p.pricingMode === 'pack' ? 'Pack price (cents)' : 'Rate per kg (cents)'}
        </span>
        <input
          inputMode="numeric"
          value={priceCents}
          onChange={(e) => setPriceCents(e.target.value)}
          className="tap tnum rounded-sm border border-line bg-raised px-3 text-body text-ink"
        />
        <span className="tnum text-meta text-muted">
          {money(cents, ADMIN_LOCALE)}
          {p.pricingMode === 'perKg' ? ' / kg' : ''}
        </span>
      </label>

      <label className="flex items-center gap-3 text-body">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="size-5"
        />
        Sold on the site
      </label>

      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void onSave({
            id: p.id,
            name: name.trim(),
            nameFr: nameFr.trim() === '' ? null : nameFr.trim(),
            active,
            ...(p.pricingMode === 'pack'
              ? { packPriceCents: cents }
              : { ratePerKgCents: cents }),
          })
        }
        className="tap-lg rounded-sm bg-accent text-lead font-semibold text-accent-ink disabled:opacity-50"
      >
        Save {p.name}
      </button>
    </div>
  );
}
