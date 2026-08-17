-- 0010_cod_and_driver_jobs
--
-- Two columns, three constraints. They exist because CASH ON DELIVERY became a
-- real branch (the client chose it 2026-08-17), and a cash order settles at a
-- door rather than at a processor.
--
-- ══ WHY THE MONEY IS RECORDED AT ALL ══════════════════════════════════════
--
-- Spec §5.8 has always said an order closes only when it is prepaid, or the
-- rider collected EXACTLY the final amount. `canDeliver` in
-- `src/domain/lifecycle.ts` has taken `cashCollectedCents` since it was
-- written -- and nothing ever passed it anything, because every order was
-- PREPAID. This is the column that argument was always waiting for.
--
-- ⚠ EXACTLY, NOT "AT LEAST". A driver who collected more has taken money the
-- customer did not agree to; one who collected less leaves a shortfall
-- somebody must account for. Both have to be caught at the door, on the day,
-- while the driver still remembers -- not at the end of a week against a till.
--
-- ══ WHY `order_cod_settled_on_delivery` IS A CHECK AND NOT ONLY CODE ══════
--
-- Same reasoning as `reserved_g <= stocked_g` (CLAUDE.md §7, "database as a
-- backstop"). If the application has a bug, the correct outcome is a failed
-- transaction, not a cash order silently marked DELIVERED with no money
-- recorded against it. Unlike overselling, the loss here is not recoverable by
-- re-cutting a piece of fish.
--
-- ✅ CANNOT FAIL ON LIVE DATA. Every existing order is PREPAID (verified:
-- `/api/checkout` hard-coded `payMode: 'PREPAID'` until this change), so both
-- new columns are NULL everywhere and all three constraints are vacuously
-- satisfied by every row that exists.

ALTER TABLE "order" ADD COLUMN "cash_collected_cents" integer;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "cash_reported_at" timestamp with time zone;--> statement-breakpoint

-- Money is a non-negative integer of cents. Never a float, nowhere.
ALTER TABLE "order" ADD CONSTRAINT "order_cash_nonneg"
  CHECK ("order"."cash_collected_cents" IS NULL OR "order"."cash_collected_cents" >= 0);--> statement-breakpoint

-- Cash is only ever reported against a cash order. A prepaid order carrying a
-- collected amount means two rails took money for one basket.
ALTER TABLE "order" ADD CONSTRAINT "order_cash_only_on_cod"
  CHECK ("order"."cash_collected_cents" IS NULL OR "order"."pay_mode" = 'COD');--> statement-breakpoint

-- The two columns move together, so "how much" always has a "when" beside it.
ALTER TABLE "order" ADD CONSTRAINT "order_cash_coherent"
  CHECK (("order"."cash_collected_cents" IS NULL) = ("order"."cash_reported_at" IS NULL));--> statement-breakpoint

-- ⭐ THE BACKSTOP. A cash order cannot reach DELIVERED without the exact money
-- recorded against it. This is spec §5.8 expressed where it cannot be bypassed
-- by a future route handler that forgets to ask.
ALTER TABLE "order" ADD CONSTRAINT "order_cod_settled_on_delivery"
  CHECK (
    "order"."status" <> 'DELIVERED'
    OR "order"."pay_mode" <> 'COD'
    OR ("order"."cash_collected_cents" IS NOT NULL
        AND "order"."cash_collected_cents" = "order"."final_total_cents")
  );
