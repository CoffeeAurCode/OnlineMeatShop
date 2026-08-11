# Restoring the database

Read this before you need it. The moment you need it is the moment you cannot
think clearly.

This procedure was executed end to end on 2026-08-10 against a real dump. It is
not a sketch.

---

## What you have

There are two eras here, and which one you are in decides the first step.

### Now — a manual dump, taken by hand

There is **no automatic backup**. The scheduled dump workflow was deleted rather
than repaired: it was the project's only HIGH defect, and the subscription that
replaces it does the job properly. Until that subscription is active, the
discipline is:

> **Take a dump immediately before every migration, and once a week.**

Because the dominant way this database actually dies is a bad migration, not the
vendor losing it. What the discipline does not cover is *forgetting* — which is
the entire reason it is temporary.

**Recovery point objective: whenever the last dump was taken.** Those files are
the only copy. Keep them somewhere that is not the same laptop.

Take one like this — the scoping is not optional, see below:

```bash
PGSSLROOTCERT=certs/supabase-prod-ca-2021.crt \
pg_dump "$DIRECT_DATABASE_URL" \
  --format=custom --schema=public --schema=auth \
  --no-owner --no-privileges \
  --file "meatshop-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

> ⚠ **A full `pg_dump` of a Supabase database does not restore.** Measured:
> 274 errors into a clean PostgreSQL 17, starting at
> `relation "vault.secrets" does not exist`. Supabase's managed schemas —
> `vault`, `storage`, `realtime`, `extensions` — are created by a new project
> itself, and including them makes the dump unrestorable. Scoped to `public`
> (application data) and `auth` (customer accounts) it restores with **exit 0
> and zero errors**. That scoping *is* the procedure.

Files in Supabase Storage are not in the dump; product images are reproducible
from source.

### Later — the vendor's daily snapshots

Once the project is on the paid tier, restore is a **dashboard operation**:
Supabase → Database → Backups → pick a daily snapshot → restore. Dailies are
retained for 7 days, the RPO becomes 24 hours, and steps 1–2 below stop
applying. **Point-in-time recovery is deliberately not purchased** — it costs
roughly an order of magnitude more than the value of the orders at risk in a
single incident.

> ⚠ **The subscription *is* the backup.** Downgrading silently leaves the shop
> with none. Treat it as infrastructure, not as billing.

---

## Restore

### 1. Get the dump

Find the most recent `meatshop-<UTC timestamp>.dump` you took.

Pick deliberately. If you are recovering from **corruption noticed late** rather
than from deletion noticed immediately, the newest dump contains the corruption.
Keep more than one.

### 2. Inspect before restoring

```bash
pg_restore --list meatshop.dump | head -40
```

Confirm it holds what you expect. A dump that is short, or missing `product`, is
a dump of a broken database.

### 3. Restore into a scratch target first

Never restore straight over a live database. Into a local container:

```bash
docker run -d --name restore-check -e POSTGRES_PASSWORD=pw postgres:17
docker cp meatshop.dump restore-check:/tmp/
docker exec restore-check psql -U postgres -c 'create database r'

# Drop the empty public schema first. Every new database has one, and the dump
# also contains a CREATE SCHEMA public, so without this you get one benign
# "schema public already exists" error and a non-zero exit code — which is
# indistinguishable at a glance from a real failure.
docker exec restore-check psql -U postgres -d r -c 'drop schema public cascade'

docker exec restore-check pg_restore -U postgres -d r \
  --no-owner --no-privileges /tmp/meatshop.dump
```

Expect **exit 0 and no errors**. Anything else, stop and read them.

### 4. Check coherence, not just presence

Row counts prove the bytes arrived. They do not prove the data means anything.
Check that an order and its dependents came back together:

```sql
select count(*) from product where active;
select count(*) from "order";
-- every order has lines
select o.id from "order" o left join order_line l on l.order_id = o.id
  group by o.id having count(l.id) = 0;
-- every paid order has a payment
select o.id from "order" o left join payment p on p.order_id = o.id
  where o.status <> 'CANCELLED' and p.id is null;
```

### 5. Only then, restore for real

Into a **new** Supabase project in `ca-central-1` — not over the damaged one,
which you may still need to look at.

```bash
PGSSLROOTCERT=certs/supabase-prod-ca-2021.crt \
pg_restore "postgresql://postgres.<newref>:<pw>@aws-0-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=verify-full" \
  --no-owner --no-privileges -d postgres meatshop.dump
```

Then update `DATABASE_URL` and `DIRECT_DATABASE_URL` in the host's environment
and in the repository secrets, and redeploy.

---

## Reconstructing the gap

Everything between the last dump and the failure is gone from Postgres. It is
not necessarily gone.

**Stripe is the independent second ledger.** Every authorisation and capture
carries the order ID in its metadata, from day one, exactly for this. Orders
lost in the gap are reconstructable from the Stripe dashboard, plus the
notification outbox, plus the confirmation emails customers received.

Do that reconstruction before telling anyone their order is lost.

---

## Who to tell, and what to say

- The shop owner, immediately, by phone. They are the one who has to face the
  customers, and they need to know before a customer tells them.
- Customers with orders in the gap: contact directly. Do not wait for them to
  arrive at a closed door.
- Say what is known and what is not. "We are restoring from a backup taken at
  HH:MM; orders placed after that we are recovering from our payment records
  and will confirm individually within the hour."

---

## Rehearse it

Before go-live, and once a quarter after. An untested backup is a hope.

Last rehearsed: **2026-08-10** — scoped dump of the live `ca-central-1` project,
restored into a clean PostgreSQL 17 container: exit 0, zero errors, seeded row
returned intact, and all four catalog CHECK constraints verified still enforcing
in the restored copy.
