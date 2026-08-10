# Online Meat Shop

An online store for a butcher: raw meat, marinated meat, packed cooked meat,
and hot cooked-to-order food. Home delivery only, within a local radius.

One Next.js application containing the customer storefront, the shop owner's
console, and the order rules — deployed as a single service against one
Postgres database.

> **Status: foundation.** The scaffold, lint boundaries and CI are in place.
> Domain logic lands increment by increment; see *Roadmap* below.

---

## Why this is not a generic store

Four requirements shape every design decision here.

**Per-kg items are billed on actual weight.** A customer orders "2 kg leg of
lamb, curry cut". The butcher cuts it, it weighs 1.93 kg, and the customer is
charged for 1.93 kg — never more than the amount they agreed to at checkout.
This is implemented as an authorisation for a ceiling amount, followed by a
capture of the exact final amount. The customer sees one hold and one charge,
not a charge and a refund.

**Hot food constrains the whole order.** If any line is hot cooked-to-order,
only a delivery slot flagged as hot-eligible may be selected. This is a
food-safety rule, so it is enforced in the placement transaction rather than
in the UI.

**Stock is per business day.** The owner opens the day and declares today's
sellable quantities. Nothing rolls over. Stock is reserved at order placement,
not when something is added to a cart.

**Order placement is atomic.** Serviceability, slot cutoff, slot capacity,
product validity, quantity legality, stock availability and hot-slot
eligibility are all checked together, in one transaction with row-level locks.
An order is either fully accepted or fully rejected with a specific reason,
and a rejection leaves no reserved stock and no phantom booking.

Overselling stock and charging a customer an amount they did not accept are
treated as the two highest-severity defect classes in the system.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router), Node runtime |
| Language | TypeScript, strict |
| Database | Postgres (Supabase, `ca-central-1`) |
| Query layer | Drizzle, with raw SQL where row locking is needed |
| Payments | Stripe, manual capture |
| Tests | Vitest — pure domain, integration, and concurrency suites |
| Hosting | Render |

---

## Layout

```
src/
├─ app/        (shop)/ public SSR · (admin)/ auth-gated PWA · api/ route handlers
├─ domain/     ★ PURE. No I/O of any kind. The formal specification, as code.
├─ db/         Drizzle schema, migrations, repositories — the only place SQL lives
├─ adapters/   payments / email / sms, each behind an interface
└─ jobs/       in-process scheduler and handlers
tests/
├─ domain/       fast, pure, property-based
├─ integration/  against a real Postgres
└─ concurrency/  ★ N buyers, 1 unit of stock
```

### The one rule worth knowing before reading the code

**`src/domain/` imports nothing that performs I/O** — no framework, no
database, no payment SDK, no `fetch`, not even the clock. Time is passed in as
a parameter.

This is enforced mechanically in `eslint.config.mjs`, not by convention. It
makes the rules that touch money exhaustively testable as pure functions, and
it keeps the deployment shape from dictating the code structure.

---

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in
npm run dev
```

`http://localhost:3000` · health check at `/healthz`

```bash
npm run lint         # includes the domain-purity boundary rules
npm run typecheck
npm test
```

> `.env.example` documents variable *names* only. Real configuration —
> including the shop's own details — lives in the deployment environment and
> is never committed. This repository is public.

---

## Roadmap

Built in verifiable increments, riskiest domain logic first, UI deliberately
last so it is a view over proven behaviour rather than the place the rules get
invented.

| # | Increment | Status |
|---|---|---|
| 0 | Foundation — scaffold, lint boundaries, CI | ✅ |
| 1 | Catalog & pricing — both pricing modes, handling classes, prep options | ⬜ |
| 2 | Availability — daily stock, reserve/release, sold-out state | ⬜ |
| 3 | Serviceability & slots — zones, fees, capacity, cutoffs, hot-eligibility | ⬜ |
| 4 | **Order placement** — the atomic transaction and every failure path | ⬜ |
| 5 | **Weighing & settlement** — actual weight, tolerance, capped total, capture | ⬜ |
| 6 | Lifecycle & notifications | ⬜ |
| 7 | Owner console, then storefront | ⬜ |

Increments 4 and 5 carry the invariants where a defect costs real money or
real food safety. They are gated on property-based and concurrency tests
rather than examples.

---

## Licence

Not yet determined.
