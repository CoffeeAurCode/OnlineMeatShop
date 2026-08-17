-- 0011_driver_links
--
-- The sign-in link that rides in the dispatch SMS.
--
-- ══ WHY THIS NEEDS A TABLE AT ALL ═════════════════════════════════════════
--
-- ⚠ NOT FOR SINGLE USE. An earlier draft of this table recorded `used_at` and
-- `reuse_attempts` so a link would die the moment it was opened. The client
-- removed that on 2026-08-17: a driver who reopens their own text should not
-- be locked out, and the 12-hour expiry is the bound they wanted.
--
-- What is left still needs a row, for two reasons:
--
--   1. **The token has to be revocable and time-bounded**, and an expiry that
--      lives inside a signed token cannot be shortened, cancelled or swept.
--   2. **A hash is stored, never the token.** A signed token would have to be
--      verifiable from itself, so there would be nothing to store and nothing
--      to expire early.
--
-- ══ THE TOKEN IS HASHED ═══════════════════════════════════════════════════
--
-- ⚠ `token_hash` IS A SHA-256 AND THE TOKEN IS NEVER WRITTEN DOWN. Same reason
-- a password is hashed: anybody reading this table — a backup, a support query,
-- a leaked dump — would otherwise hold working sign-in links for every driver
-- for the next twelve hours.
--
-- ✅ CANNOT FAIL ON LIVE DATA — a new table with no dependents.

CREATE TABLE "driver_link" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  -- SHA-256 hex of the token. Never the token. See above.
  "token_hash" text NOT NULL,

  -- ⚠ CASCADE. A driver removed from the roster takes their links with them;
  -- an orphan would resolve to nobody and the guard would have to decide what
  -- that means. Deleting is unambiguous.
  "partner_id" uuid NOT NULL REFERENCES "delivery_partner"("id") ON DELETE CASCADE,

  -- Where the link lands. Nullable and `set null`, because THE LINK IS A
  -- SIGN-IN, not permission to see one order: if the order is deleted the link
  -- still legitimately signs the driver in, it just lands on their list.
  "order_id" uuid REFERENCES "order"("id") ON DELETE SET NULL,

  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- The lookup is BY HASH on every visit.
CREATE UNIQUE INDEX "driver_link_token_hash" ON "driver_link" ("token_hash");--> statement-breakpoint

-- For the sweep of expired rows, which is what stops the table growing without
-- bound now that nothing deletes a link on use.
CREATE INDEX "driver_link_partner_expiry" ON "driver_link" ("partner_id", "expires_at");
