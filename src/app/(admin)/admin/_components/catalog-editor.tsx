'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { AdminProduct } from '@/db/repositories/admin';
import type { CategoryView } from '@/db/repositories/catalog';
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

const REFUSALS: Record<string, string> = {
  duplicateSlug: 'That URL slug is already used by another item.',
  categoryNotFound: 'That category is no longer available. Refresh and choose another.',
  mustDeactivate: 'Turn off “Sold on the site” and save before deleting this item.',
  hasOrderHistory: 'This item is used by past orders, so it can be retired but not deleted.',
  reservedStock: 'This item still has stock promised to an order and cannot be deleted.',
  notFound: 'That item is no longer in the catalog. Refreshing.',
};

export function CatalogEditor({
  products,
  categories,
}: {
  products: readonly AdminProduct[];
  categories: readonly CategoryView[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function call(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/catalog', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const parsed = (await res.json()) as { reason?: string };
        setError(REFUSALS[parsed.reason ?? ''] ?? 'That did not save. Nothing has changed.');
        setBusy(false);
        return false;
      }
      router.refresh();
      setBusy(false);
      setEditing(null);
      if (method === 'POST') setCreating(false);
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
        Changing a price here takes effect immediately. Anyone with a basket priced a moment ago is asked to confirm the
        new total at checkout rather than being charged it quietly.
      </p>

      <button
        type="button"
        disabled={busy || categories.length === 0}
        onClick={() => setCreating((value) => !value)}
        className="tap-lg mt-5 w-full rounded-sm border border-line bg-raised px-4 text-lead font-semibold disabled:opacity-50"
      >
        {creating ? 'Close new item' : 'Add new item'}
      </button>

      {creating ? <NewProductForm categories={categories} busy={busy} onCreate={(body) => call('POST', body)} /> : null}

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
                  {p.categoryName ?? 'uncategorised'} · {p.handling.toLowerCase().replace('_', ' ')} ·{' '}
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

            {editing === p.id && (
              <ProductFields
                product={p}
                busy={busy}
                onSave={(body) => call('PATCH', body)}
                onDelete={(id) => call('DELETE', { id })}
              />
            )}
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
  onDelete,
}: {
  product: AdminProduct;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(p.name);
  const [nameFr, setNameFr] = useState(p.nameFr ?? '');
  const [priceCents, setPriceCents] = useState(
    String(p.pricingMode === 'pack' ? (p.packPriceCents ?? 0) : (p.ratePerKgCents ?? 0)),
  );
  const [active, setActive] = useState(p.active);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-5" />
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
            ...(p.pricingMode === 'pack' ? { packPriceCents: cents } : { ratePerKgCents: cents }),
          })
        }
        className="tap-lg rounded-sm bg-accent text-lead font-semibold text-accent-ink disabled:opacity-50"
      >
        Save {p.name}
      </button>

      {!p.active ? (
        confirmDelete ? (
          <div className="grid gap-2 rounded-sm border border-danger bg-danger-wash p-3">
            <p className="text-meta text-danger">
              Permanently delete this unused item? Items on past orders will be refused and stay retired.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
                className="tap rounded-sm border border-line bg-raised text-meta font-semibold"
              >
                Keep item
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDelete(p.id)}
                className="tap rounded-sm bg-danger px-3 text-meta font-semibold text-white disabled:opacity-50"
              >
                Delete permanently
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
            className="tap text-meta text-danger underline underline-offset-4 disabled:opacity-50"
          >
            Delete this unused item
          </button>
        )
      ) : null}
    </div>
  );
}

function NewProductForm({
  categories,
  busy,
  onCreate,
}: {
  categories: readonly CategoryView[];
  busy: boolean;
  onCreate: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [nameFr, setNameFr] = useState('');
  const [description, setDescription] = useState('');
  const [descriptionFr, setDescriptionFr] = useState('');
  const [slug, setSlug] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [handling, setHandling] = useState<'RAW' | 'MARINATED' | 'COOKED_CHILLED' | 'COOKED_HOT'>('RAW');
  const [taxCode, setTaxCode] = useState<'ZERO_RATED_BASIC_GROCERY' | 'STANDARD'>('ZERO_RATED_BASIC_GROCERY');
  const [pricingMode, setPricingMode] = useState<'pack' | 'perKg'>('perKg');
  const [priceCents, setPriceCents] = useState('');
  const [minimumG, setMinimumG] = useState('');
  const [maximumOrStepG, setMaximumOrStepG] = useState('');

  const inputClass = 'tap-lg rounded-sm border border-line bg-raised px-3 text-body text-ink';
  const price = Number(priceCents);
  const minimum = Number(minimumG);
  const maximumOrStep = Number(maximumOrStepG);
  const valid =
    name.trim() !== '' &&
    nameFr.trim() !== '' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
    categoryId !== '' &&
    Number.isInteger(price) &&
    price > 0 &&
    Number.isInteger(minimum) &&
    minimum > 0 &&
    Number.isInteger(maximumOrStep) &&
    maximumOrStep > 0 &&
    (pricingMode === 'pack' ? minimum <= maximumOrStep : minimum >= maximumOrStep && minimum % maximumOrStep === 0);

  function changeName(value: string) {
    setName(value);
    setSlug((current) => (current === '' || current === slugFromName(name) ? slugFromName(value) : current));
  }

  return (
    <section className="mt-4 grid gap-4 rounded-md border border-line bg-soft p-4">
      <div>
        <h2 className="text-section font-semibold tracking-tight">New catalog item</h2>
        <p className="mt-1 text-meta text-muted">
          Pricing mode and handling cannot be changed after creation. Tax treatment is chosen separately.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name (English)">
          <input value={name} onChange={(e) => changeName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Name (French)">
          <input value={nameFr} onChange={(e) => setNameFr(e.target.value)} className={inputClass} />
        </Field>
        <Field label="URL slug">
          <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} className={inputClass} />
        </Field>
        <Field label="Category">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Handling">
          <select
            value={handling}
            onChange={(e) => setHandling(e.target.value as typeof handling)}
            className={inputClass}
          >
            <option value="RAW">Raw</option>
            <option value="MARINATED">Marinated</option>
            <option value="COOKED_CHILLED">Cooked, chilled</option>
            <option value="COOKED_HOT">Cooked, hot</option>
          </select>
        </Field>
        <Field label="Tax code">
          <select value={taxCode} onChange={(e) => setTaxCode(e.target.value as typeof taxCode)} className={inputClass}>
            <option value="ZERO_RATED_BASIC_GROCERY">Zero-rated basic grocery</option>
            <option value="STANDARD">Standard tax</option>
          </select>
        </Field>
        <Field label="Pricing mode">
          <select
            value={pricingMode}
            onChange={(e) => setPricingMode(e.target.value as typeof pricingMode)}
            className={inputClass}
          >
            <option value="perKg">Per kilogram</option>
            <option value="pack">Fixed-price pack</option>
          </select>
        </Field>
        <Field label={pricingMode === 'pack' ? 'Pack price (cents)' : 'Rate per kg (cents)'}>
          <input
            inputMode="numeric"
            value={priceCents}
            onChange={(e) => setPriceCents(e.target.value.replace(/\D/g, ''))}
            className={inputClass}
          />
        </Field>
        <Field label={pricingMode === 'pack' ? 'Minimum pack weight (g)' : 'Minimum order (g)'}>
          <input
            inputMode="numeric"
            value={minimumG}
            onChange={(e) => setMinimumG(e.target.value.replace(/\D/g, ''))}
            className={inputClass}
          />
        </Field>
        <Field label={pricingMode === 'pack' ? 'Maximum pack weight (g)' : 'Weight step (g)'}>
          <input
            inputMode="numeric"
            value={maximumOrStepG}
            onChange={(e) => setMaximumOrStepG(e.target.value.replace(/\D/g, ''))}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Description (English, optional)">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className={`${inputClass} py-3`}
        />
      </Field>
      <Field label="Description (French, optional)">
        <textarea
          value={descriptionFr}
          onChange={(e) => setDescriptionFr(e.target.value)}
          rows={3}
          className={`${inputClass} py-3`}
        />
      </Field>

      <button
        type="button"
        disabled={busy || !valid}
        onClick={() =>
          void onCreate({
            name: name.trim(),
            nameFr: nameFr.trim(),
            slug,
            categoryId,
            handling,
            taxCode,
            pricingMode,
            description: description.trim() || null,
            descriptionFr: descriptionFr.trim() || null,
            ...(pricingMode === 'pack'
              ? { packPriceCents: price, wMinG: minimum, wMaxG: maximumOrStep }
              : {
                  ratePerKgCents: price,
                  minOrderG: minimum,
                  stepG: maximumOrStep,
                }),
          })
        }
        className="tap-lg rounded-sm bg-accent px-4 text-lead font-semibold text-accent-ink disabled:opacity-50"
      >
        Add item to catalog
      </button>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-meta text-muted">{label}</span>
      {children}
    </label>
  );
}

function slugFromName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
