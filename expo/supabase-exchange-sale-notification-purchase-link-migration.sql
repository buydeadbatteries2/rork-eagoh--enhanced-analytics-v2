-- =============================================================================
-- D2.3P — Exchange Sale Notification Purchase-Link Migration
--
-- Purpose: the currently deployed Worker's POST /exchange/sale-notify handler
-- (dedup query at functions/index.ts:12097 and insert payload at 12109)
-- references intelligence_notifications.purchase_id, which does not exist on
-- the live table. This migration adds that link so the live schema matches the
-- deployed Worker with ZERO Worker code changes.
--
-- Scope (exact — nothing else):
--   1. Nullable uuid column purchase_id (idempotent).
--   2. Guarded FK purchase_id -> marketplace_sync_purchases(id)
--      ON DELETE SET NULL under a stable constraint name (rerun-safe).
--   3. Unique partial index (user_id, purchase_id) WHERE
--      notification_type = 'exchange_sale' AND purchase_id IS NOT NULL —
--      blocks duplicate vendor sale notifications even under concurrency
--      (the Worker's check-then-insert dedup alone is race-prone).
--
-- Explicitly untouched:
--   entry_id column AND its Open Intelligence FK (fully preserved),
--   notification_type CHECK constraint, RLS, grants, Worker code, purchase
--   RPC, balances, ledgers, purchases, retention, existing notification
--   contents. No backfill: the verified purchase has zero notification rows,
--   so no historical row needs repair — purchase_id stays NULL on legacy rows,
--   which remains valid (column is nullable, index predicate excludes NULLs).
--
-- Dependency note: the live notification_type CHECK must include
-- 'exchange_sale' for inserts to succeed — that is provided by
-- supabase-exchange-vendor-order-schema-correction-migration.sql (D2.3K).
-- Run D2.3K before or together with this file.
--
-- Run: Supabase SQL editor (Julius). Never execute from the app pipeline.
-- =============================================================================

begin;

-- 1. Nullable purchase link column (idempotent).
alter table public.intelligence_notifications
  add column if not exists purchase_id uuid;

-- 2. Guarded foreign key: purchase_id -> marketplace_sync_purchases(id).
--    ON DELETE SET NULL so deleting a purchase nulls the link instead of
--    cascading into notification history. Guarded by name + relation so
--    reruns are no-ops and never duplicate the constraint.
do $d23p_fk$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'intelligence_notifications_purchase_id_fkey'
       and conrelid = 'public.intelligence_notifications'::regclass
  ) then
    alter table public.intelligence_notifications
      add constraint intelligence_notifications_purchase_id_fkey
      foreign key (purchase_id)
      references public.marketplace_sync_purchases (id)
      on delete set null;
  end if;
end
$d23p_fk$;

-- 3. Unique partial index: at most one exchange_sale notification per
--    (vendor user, purchase). Enforced by the database, so concurrent
--    duplicate sale-notify calls are blocked at insert time, not just by the
--    Worker's dedup select. Legacy/NULL purchase_id rows are outside the
--    predicate and unaffected.
create unique index if not exists intelligence_notifications_exchange_sale_purchase_unique
  on public.intelligence_notifications (user_id, purchase_id)
  where notification_type = 'exchange_sale'
    and purchase_id is not null;

commit;
