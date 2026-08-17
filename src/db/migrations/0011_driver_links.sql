-- 0011_driver_links
--
-- The single-use sign-in link that rides in the dispatch SMS.
--
-- ══ WHY THIS NEEDS A TABLE AT ALL ═════════════════════════════════════════
--
-- ⭐ SINGLE USE IS THE ONLY DEFENCE AGAINST A FORWARDED TEXT, AND SINGLE USE
-- REQUIRES STATE.
--
-- A purely signed token — HMAC, expiry inside, nothing stored — is valid every
-- time it is presented, by anyone holding it, until it expires. That is fine
-- for a customer's tracking link (a receipt, deliberately durable) and wrong
-- here: this one is a CREDENTIAL, and a credential in an SMS can be forwarded,
-- screenshotted and posted. Recording that a token has been spent is the only
-- thing that makes the second holder's copy worthless.
--
-- ══ THE TOKEN IS HASHED, NOT STORED ═══════════════════════════════════════
--
-- ⚠ `token_hash` IS A SHA-256 AND THE TOKEN ITSELF IS NEVER WRITTEN DOWN.
-- Same reason a password is hashed: anybody who can read this table — a backup,
-- a support query, a leaked dump — would otherwise be holding working sign-in
-- links for every driver. A hash makes the table useless for that.
--
-- ══ `reuse_attempts` IS NOT A COUNTER FOR ITS OWN SAKE ════════════════════
--
-- ⭐ IT IS THE ONLY SIGNAL A FORWARD EVER PRODUCES. A spent link presented a
-- second time means either the driver double-tapped, or somebody else has the
-- text. Neither is provable from here, but a link with six attempts against it
-- is worth the shop asking about, and nothing else in the system would ever
-- notice.
--
-- ✅ CANNOT FAIL ON LIVE DATA — a new table with no dependents.

CREATE TABLE "driver_link" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  -- SHA-256 hex of the token. Never the token. See above.
  "token_hash" text NOT NULL,

  -- ⚠ CASCADE. A driver removed from the roster takes their unspent links with
  -- them; leaving orphans would mean a link that resolves to nobody, and the
  -- guard would have to decide what that means. Deleting is unambiguous.
  "partner_id" uuid NOT NULL REFERENCES "delivery_partner"("id") ON DELETE CASCADE,

  -- Where the link lands. Nullable and `set null`, because the LINK IS A
  -- SIGN-IN, not a permission to see one order: if the order is deleted the
  -- link still legitimately signs the driver in, it just lands on their list.
  "order_id" uuid REFERENCES "order"("id") ON DELETE SET NULL,

  "expires_at" timestamp with time zone NOT NULL,

  -- Null until somebody spends it. The conditional UPDATE on this column is
  -- what makes "single use" true under concurrency rather than aspirational.
  "used_at" timestamp with time zone,

  "reuse_attempts" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "driver_link_reuse_nonneg" CHECK ("reuse_attempts" >= 0)
);--> statement-breakpoint

-- The lookup is BY HASH on every visit, and it must be unique: two rows with
-- one hash would make "which link was spent" unanswerable.
CREATE UNIQUE INDEX "driver_link_token_hash" ON "driver_link" ("token_hash");--> statement-breakpoint

-- For the sweep of expired rows, and for showing a driver's live links.
CREATE INDEX "driver_link_partner_expiry" ON "driver_link" ("partner_id", "expires_at");
