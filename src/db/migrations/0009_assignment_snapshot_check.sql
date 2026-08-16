-- 0009_assignment_snapshot_check
--
-- Take `delivery_partner_id` OUT of `order_assignment_coherent`.
--
-- ⚠ 0008 SHIPPED THIS CONSTRAINT WITH THE FK IN IT, AND THAT MADE
-- `on delete set null` BEHAVE AS `on delete restrict`. Measured against the
-- live database, not reasoned about:
--
--     delete from delivery_partner where id = '...';
--     ERROR 23514: new row for relation "order" violates check constraint
--                  "order_assignment_coherent"
--
-- The referential action's UPDATE is itself subject to CHECK constraints, so
-- nulling the FK while the name and phone snapshot remained broke a check that
-- demanded they move together. The result was the exact outcome 07-PLAN 3.1
-- set out to avoid: the owner could never remove a partner who did one
-- delivery in March.
--
-- What is worth enforcing is the SNAPSHOT's coherence. The snapshot is the
-- historical record and a delivered order must still say who took it; the FK
-- is a convenience join onto a roster that changes, and a null there means
-- only "no longer on the roster".
--
-- ✅ NO ROW CAN VIOLATE THE NEW CONSTRAINT THAT SATISFIED THE OLD ONE --
-- it is strictly weaker. So this cannot fail on live data.

ALTER TABLE "order" DROP CONSTRAINT "order_assignment_coherent";--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_assignment_coherent" CHECK (("order"."assigned_at" IS NULL AND "order"."partner_name" IS NULL AND "order"."partner_phone" IS NULL)
          OR ("order"."assigned_at" IS NOT NULL AND "order"."partner_name" IS NOT NULL
              AND "order"."partner_phone" IS NOT NULL));