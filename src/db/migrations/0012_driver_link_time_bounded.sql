-- 0012_driver_link_time_bounded
--
-- Drop the single-use machinery from `driver_link`. The link is now bounded by
-- TIME alone: twelve hours, plus `delivery_partner.active` for revocation.
--
-- ══ WHY THIS IS A NEW MIGRATION AND NOT AN EDIT TO 0011 ═══════════════════
--
-- ⚠ 0011 WAS ALREADY APPLIED TO THE LIVE DATABASE, and I edited it in place
-- before checking. That was wrong, and this file is the correction.
--
-- The mistake is worth recording because it is easy to repeat: `git log` showed
-- 0011 sitting in an unpushed commit, so it LOOKED unapplied. It had in fact
-- been pushed, and `deploy.yml` runs `drizzle-kit migrate` before triggering
-- Render — so it had been live for four hours. Verified after the fact against
-- `drizzle.__drizzle_migrations`, which carried `created_at = 1786975200000`.
--
-- ⭐ EDITING AN APPLIED MIGRATION DOES NOT FAIL LOUDLY, WHICH IS WHY IT IS
-- DANGEROUS. Drizzle decides what to run from the journal TIMESTAMP, not from
-- the file's contents, so an edited-but-already-applied migration is silently
-- skipped. The database keeps the old shape, the schema file describes a new
-- one, and nothing ever reports the divergence.
--
-- **The rule, restated: an applied migration is history. Correct it forward.**
--
-- ══ WHAT IS BEING REMOVED, AND WHY IT IS SAFE ═════════════════════════════
--
-- The client removed single use on 2026-08-17: a driver who reopens their own
-- text, or whose carrier pre-fetched the URL to build a preview, must not find
-- themselves locked out of the job they are standing next to.
--
-- ✅ NO DATA IS LOST. `select count(*) from driver_link` was **0** on the live
-- database when this was written — the feature shipped hours ago and no
-- dispatch has been sent since. Both columns are dropped rather than left in
-- place because a column nothing writes is a column the next reader has to work
-- out the meaning of.

ALTER TABLE "driver_link" DROP CONSTRAINT IF EXISTS "driver_link_reuse_nonneg";--> statement-breakpoint
ALTER TABLE "driver_link" DROP COLUMN IF EXISTS "used_at";--> statement-breakpoint
ALTER TABLE "driver_link" DROP COLUMN IF EXISTS "reuse_attempts";
