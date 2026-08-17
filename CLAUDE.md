# CLAUDE.md — code conventions for this repository

> **This is the public application repository.** The full project rules, the
> formal specification, the delivery plan and the development log live in a
> **private parent repository**, which tracks this one as a git submodule.
> When working locally inside that checkout, both files apply — Claude Code
> merges `CLAUDE.md` up the directory tree.
>
> **Never copy content from the private repo into this one.** Reference
> documents by name; do not reproduce them.

---

## 1. This repository is public

**The client relaxed this rule on 2026-08-12**, having been told what it
protected and that git history is permanent. The shop's own identity may now
live here. What stays banned did not change, and the reason it stays banned is
that none of it has any upside in a public repository.

**Still banned outright** — in code, config, seed files, test fixtures,
migrations, comments or commit messages:

- Any **customer data**, real or realistic-looking. This is the important one.
- **Licence numbers** (CFIA, provincial), insurance or registration numbers
- **Cost figures**, invoices, margins, or anything about what the build cost
- **Client correspondence**, quotes, or messages

**Now permitted, by explicit client decision:** the shop's name, address,
phone, photography, brand assets, and its real product names and categories.

**Still a good idea, and still the default:** anything that varies by
deployment stays in an environment variable rather than a literal, because
that is configuration hygiene and not secrecy. `src/ui/shop-config.ts` reads
every presentation value from `.env`, and `.env.example` documents the names
only. Test fixtures stay fictional (`Sample Lamb Leg`, postal code `A1A 1A1`)
because a test that depends on real catalog data breaks when the catalog
changes.

**Git history is permanent.** Committing client data and removing it in the
next commit leaves it in the history, in every fork, and in anything that
scraped the repository in between. There is no clean-up path, only
prevention. If you think something slipped through, say so immediately —
the remedy differs once it has been pushed. **This is exactly why the four
categories above are still absolute: the relaxation above was reversible only
because it was decided BEFORE anything was pushed.**

---

## 2. What this application is

An online store for a **fishmonger**: raw fish and shellfish, marinated,
packed cooked, and hot cooked-to-order food. Home delivery only, within a
local radius. One Next.js app containing the customer storefront, the owner's
console, and the order rules.

> The repository is still named `OnlineMeatShop` and parts of the code still
> say butcher. The shop pivoted from meat to fish; the four handling classes
> and every domain rule survived the pivot unchanged, because none of them was
> ever about the species. Renaming the repository drags the submodule pin, the
> deploy hook and CI, so it has not been done.

Four things make it harder than a normal store:

1. **Two pricing modes in one cart.** Fixed-price packs, and per-kg items cut
   to order and billed on *actual* weight. Per-kg line amounts are not final
   at checkout.
2. **Hot food constrains the whole order.** If any line is hot cooked-to-order,
   only a hot-eligible delivery slot may be chosen. This is a food-safety rule.
3. **Stock is per business day.** The owner declares today's quantities each
   morning; nothing rolls over.
4. **The owner runs the shop from a phone**, one-handed, early in the morning.

---

## 3. Hard rules

These exist because the generic e-commerce instinct is wrong here in
specific, expensive ways.

### Money
- **All money is integer cents.** No `float`, no `double`, anywhere — not in
  the database, not in TypeScript, not in JSON. `src/domain/types.ts` brands
  the type and rejects non-integers at the boundary.
- **Weights are integer grams**, for the same reason.
- **Totals are always recomputed server-side** from the catalog. A price,
  quantity or total sent by the client is a display value, never an input.
- Rounding happens in exactly one place, and rounds **up**.

### Domain purity
- **`src/domain/**` imports nothing that performs I/O.** No framework, no
  database, no payment processor, no `fetch`, no clock. Time is passed in as a parameter.
- This is enforced by `eslint.config.mjs`. If you want to disable one of those
  rules, you are about to make a mistake.
- Two reasons: it makes the domain cheaply and exhaustively testable, and it
  keeps the deployment shape from dictating the code structure.

### Order placement — the highest-risk code here
- Placement is **one database transaction**. All preconditions, all-or-nothing.
- **Canonical lock order: slot → product (`FOR SHARE`, id ascending) → stock
  (`FOR UPDATE`, product id ascending).** Any other order deadlocks under
  concurrency. Admin writes use the same order.
- **Demand aggregates across lines.** The same product legitimately appears on
  several lines — cut preferences do not create separate products — so
  checking each line separately oversells.
- Every failure path leaves reserved stock and slot bookings **byte-identical**.
- **Never call a payment processor, email, SMS or any HTTP inside a database
  transaction.**

### Connecting to the database
- Three endpoints exist and they are not interchangeable:
  - **`DATABASE_URL`** — transaction pooler, port **6543**. The application.
    Prepared statements and session state do not survive it.
  - **`DIRECT_DATABASE_URL`** — session pooler, port **5432**. Migrations and
    `pg_dump` only. Never in the web service's environment.
  - `db.<ref>.supabase.co:5432` — what the dashboard calls the "direct
    connection". **Do not use it.** It is IPv6-only, and CI runners have no
    IPv6, so anything relying on it fails with `ENOTFOUND`.
- TLS is verified against a pinned root in `certs/`, not disabled. See
  `src/db/ssl.ts` for why `rejectUnauthorized: false` is not an option here.
  The **only** exception is a loopback host, which is how the integration and
  concurrency suites reach a local plaintext Postgres — `postgresTls()` decides
  that from the connection string, and both the application and `drizzle.config.ts`
  call the same function so they cannot drift apart. Do not add an environment
  variable to override it: the failure mode of such a variable is that it gets
  set in the wrong environment.

### The database is a backstop, not just a store
- Anti-overselling and anti-overbooking are **CHECK constraints in Postgres**,
  not only application logic. If the code has a bug, the correct outcome is a
  failed transaction, not silently selling stock that does not exist.

### Payments

> The processor is **Moneris** (since 2026-08-17; it replaced Clover, which
> replaced Stripe). Nothing below depends on the vendor: every rule here is
> about the SHAPE of the flow, and everything goes through `PaymentAdapter` in
> `src/adapters/payments.ts` rather than talking to a processor directly. The
> interface has not changed once across three processors.
>
> 🔴 **`MonerisPaymentAdapter` has never spoken to Moneris.** There are no
> credentials yet, so it is unreachable at runtime and the stub still runs. Its
> XML field names are written against the classic Gateway API and **must be
> checked against the merchant's own integration guide** before the first real
> transaction. See the header of `src/adapters/moneris.ts`.
>
> ⭐ Moneris closes both items that blocked Clover: `order_id` must be unique
> per store, which IS an idempotency mechanism, and a store is provisioned in a
> currency, so CAD cannot be got wrong from this side.

- Authorise a **ceiling**, capture the **exact** final amount. Authorising the
  estimate itself fails whenever a cut comes in heavy, which is normal here.
- **Exactly one capture per authorisation.** A partial capture automatically
  releases the remainder; you cannot capture again for a difference.
- Checkout has a **durable idempotency boundary** created before any payment
  intent, plus stable idempotency keys that change when the amount changes.
  Without it, a double-tap puts two holds on a customer's card.
- Every webhook handler is **idempotent** and processes the event, its effects
  and its completion marker in **one transaction**. Otherwise a crash mid-handler
  loses the event permanently and silently.
- **The capture happens AFTER the transaction commits, never inside it.** A
  capture that succeeded inside a transaction which then rolled back is money
  taken for an order that does not exist in that state, and it cannot be
  un-taken. A crash between the two is the recoverable direction, and only
  because `captureExact` is idempotent on the authorisation.
- **A second capture is a REPLAY, not an error.** It is what a retry after that
  crash looks like; the right answer is the amount actually taken.
- Order status and payment status are **separate state machines** joined by an
  ID. Never derive one from the other.
- ⚠ **`pay_mode` selects a CODE PATH, it does not describe whether money
  moved.** `COD` skips authorisation and settlement entirely, so a stub-adapter
  order marked `COD` would never exercise the path worth testing. Prototype
  orders are `PREPAID`, which means **nothing in the data distinguishes them
  from real prepaid orders except `payment.provider`.** Anything that reads
  takings must filter on `provider <> 'stub'`.
- **Cash on delivery is real, and it is the customer's choice** (since
  2026-08-17). A `COD` order has **no `payment` row at all** — not a zero
  authorisation, not a stub one. It is gated by the `checkout.codEnabled`
  shop setting, re-read server-side at `/api/checkout`; a hidden control on the
  page is a display decision and never the one that binds.
- ⭐ **A cash order closes only on the EXACT amount** (spec §5.8). The driver
  reports what they collected; equal closes the order, anything else is
  RECORDED and the order deliberately stays `OUT` for the shop to resolve.
  Enforced in `src/db/repositories/driver.ts` **and** by the
  `order_cod_settled_on_delivery` CHECK — "exactly", never "at least", because
  an over-payment means the customer was charged more than they agreed to.

### Security
- The service-role key is **server-only**. Never in a `NEXT_PUBLIC_*` variable,
  never in the client bundle, never committed.
- Every admin mutation re-checks the staff role **server-side against the
  database** — never from a token claim alone. The driver portal follows the
  same rule against `delivery_partner.active` (`src/app/driver-guard.ts`): the
  cookie says WHO, the database says WHETHER, and nothing caches the answer.
- **A driver sees only orders assigned to them, and the filter is in the SQL**
  (`src/db/repositories/driver.ts`). The partner id is part of the LOOKUP KEY,
  never a comparison made after the row is read — what it protects is every
  customer's home address and phone number.
- **The dispatch SMS carries a sign-in link** (`/d/<token>`), and **TIME IS ITS
  ONLY BOUND: 12 hours.** It is deliberately **not** single use — a driver who
  reopens their own text must not be locked out. ⚠ **A forwarded text therefore
  works until it expires. That is an accepted trade, not an oversight;** do not
  "fix" it by spending the token on first use without asking.
- The token is **random and stored as a SHA-256 hash**, never signed-and-
  stateless: a row can be swept and cascaded away, an expiry baked into a signed
  token cannot. Reading the table yields nothing usable.
- ⚠ **Never put a login code in an SMS.** A code is minted on request and
  expires; one printed into a text sent hours earlier is either already dead or
  a standing password sitting in a forwardable message. The link replaces it.
- `sweepDriverLinksJob` is **the only thing bounding `driver_link`** now that
  nothing deletes a row on use. ⚠ Nothing invokes the scheduler yet.
- Validate at every route-handler boundary.

### Admin console
- **Never cache order or stock data in the service worker.** A cached stock
  number at 6am is a wrong stock number. Cache the app shell only.
- Do not queue writes offline. An order placed against stale stock is the
  highest-severity defect class in this system.

---

## 4. Layout

```
src/
├─ app/        (shop)/ public SSR · (admin)/ auth-gated PWA · api/ route handlers
├─ domain/     ★ PURE. No I/O. The formal spec, as TypeScript.
├─ db/         Drizzle schema, migrations, repositories — the only place SQL lives
├─ adapters/   payments / email / sms, each behind an interface
└─ jobs/       scheduler + handlers
certs/         Supabase's Postgres root CA. Public certificate, not a secret.
docs/          restore-procedure.md — read it before you need it
tests/
├─ domain/     fast, pure, property-based
├─ integration/against a real Postgres
└─ concurrency/★ the gate: N buyers, 1 unit of stock
```

---

## 5. Conventions

- **Verify, don't assume.** Run the tests. Paste real output. If something was
  not run, say "not verified" rather than implying it passed.
- **The concurrency suite is the gate.** N concurrent placements against one
  unit of stock must yield exactly one acceptance. If it is not in CI and
  green, order placement is not done.
- Prefer editing existing files over adding new ones. Prefer deleting.
- Match the surrounding style, naming and comment density.
- Commit messages describe *why*; the diff already says *what*.

---

## 6. Scheduled work

Runs in-process, guarded by **transaction-scoped** advisory locks — one per
job, never session-scoped, because session locks attach to a pooled connection
and leak. Every job is independently idempotent;
the lock reduces duplicate work, it does not guarantee its absence.

In-process work presumes the process is running. On a **free** instance it is
not: the host spins the service down after 15 minutes without traffic, and a
spun-down process runs no jobs. `render.yaml` is on `free` deliberately while
the shop is not trading. Nothing invokes the scheduler yet, so nothing is
currently broken — but **do not wire a job to the request lifecycle and call it
scheduled until the instance is always-on**, and make every job tolerate having
been asleep for hours rather than assuming a regular tick.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
