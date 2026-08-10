# Restoring the database

Read this before you need it. The moment you need it is the moment you cannot
think clearly.

This procedure was executed end to end on 2026-08-10 against a real dump. It is
not a sketch.

---

## What you have

Backups are written by `.github/workflows/backup.yml` every 6 hours to
S3-compatible object storage, as `postgres/meatshop-<UTC timestamp>.dump.gpg`.
Fourteen days are retained.

**Recovery point objective: 6 hours.** There is no vendor-side backup — Supabase's
free tier takes none at all. These files are the only copy.

Each dump contains the `public` schema (all application data) and the `auth`
schema (customer accounts). It deliberately does not contain Supabase's managed
schemas — `vault`, `storage`, `realtime`, `extensions` — because a new project
creates those itself and including them makes the dump unrestorable. Files in
Supabase Storage are not in the dump; product images are reproducible from
source.

---

## Restore

### 1. Get the dump

```bash
aws s3 ls s3://$BUCKET/postgres/ --endpoint-url "$ENDPOINT"
aws s3 cp s3://$BUCKET/postgres/meatshop-<stamp>.dump.gpg . --endpoint-url "$ENDPOINT"
```

Pick deliberately. If you are recovering from **corruption noticed late** rather
than from deletion noticed immediately, the newest dump contains the corruption.
That is why fourteen days are kept.

### 2. Decrypt

```bash
gpg --batch --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
    --decrypt meatshop-<stamp>.dump.gpg > meatshop.dump
```

### 3. Inspect before restoring

```bash
pg_restore --list meatshop.dump | head -40
```

Confirm it holds what you expect. A dump that is short, or missing `product`, is
a dump of a broken database.

### 4. Restore into a scratch target first

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

### 5. Check coherence, not just presence

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

### 6. Only then, restore for real

Into a **new** Supabase project in `ca-central-1` — not over the damaged one,
which you may still need to look at.

```bash
PGSSLROOTCERT=certs/supabase-prod-ca-2021.crt \
pg_restore "postgresql://postgres.<newref>:<pw>@aws-0-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=verify-full" \
  --no-owner --no-privileges -d postgres meatshop.dump
```

Then update `DATABASE_URL` and `DIRECT_DATABASE_URL` in Render and in the
repository secrets, and redeploy.

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
