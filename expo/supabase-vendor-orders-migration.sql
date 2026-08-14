-- ──────────────────────────────────────────────────────────────────────────
-- VENDOR PURCHASE ORDERS — Migration
--
-- Adds the "exchange_sale" notification type so the worker can create
-- in-app notifications for vendors when a buyer purchases their EAGOH sync.
--
-- Vendor purchase order data is derived from the EXISTING
-- marketplace_sync_purchases table (no new order table needed). The table
-- already stores: buyer_id, vendor_id, eagoh_id, sync_level, days,
-- edge_cost, started_at, expires_at, active, purchase_status, created_at.
--
-- Vendor earnings are already tracked in:
--   - edge_transactions (kind='addition', reason='marketplace')
--   - marketplace_vendor_stats (total_edge_earned, edge_earned_this_month)
--
-- This migration only:
--   1. Adds the 'exchange_sale' notification type to the CHECK constraint
--   2. Adds a buyer_username column to marketplace_sync_purchases (denormalized
--      at purchase time so the vendor can see a display name without N+1 joins)
-- ──────────────────────────────────────────────────────────────────────────

-- ── 1. Add 'exchange_sale' to intelligence_notifications CHECK constraint ──

do $$
declare
  v_constraint_name text;
  v_definition text;
begin
  -- Find the existing CHECK constraint on notification_type
  select con.conname
    into v_constraint_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
   where nsp.nspname = 'public'
     and rel.relname = 'intelligence_notifications'
     and att.attname = 'notification_type'
     and con.contype = 'c';

  if v_constraint_name is not null then
    -- Get the constraint definition
    select pg_get_constraintdef(con.oid)
      into v_definition
      from pg_constraint con
     where con.conname = v_constraint_name
       and con.conrelid = 'public.intelligence_notifications'::regclass;

    -- Only recreate if 'exchange_sale' is NOT already in the definition
    if v_definition is not null and v_definition not ilike '%exchange_sale%' then
      execute format('alter table public.intelligence_notifications drop constraint %I', v_constraint_name);
      execute 'alter table public.intelligence_notifications
        add constraint intelligence_notifications_notification_type_check
        check (notification_type in (
          ''community_supported'',
          ''externally_supported'',
          ''disputed'',
          ''rejected'',
          ''dispute_dismissed'',
          ''outdated'',
          ''exchange_sharing_disabled'',
          ''faction_sharing_removed'',
          ''faction_join_requested'',
          ''faction_join_approved'',
          ''faction_join_denied'',
          ''exchange_sale''
        ))';
    end if;
  else
    -- No constraint exists at all — add it
    execute 'alter table public.intelligence_notifications
      add constraint intelligence_notifications_notification_type_check
      check (notification_type in (
        ''community_supported'',
        ''externally_supported'',
        ''disputed'',
        ''rejected'',
        ''dispute_dismissed'',
        ''outdated'',
        ''exchange_sharing_disabled'',
        ''faction_sharing_removed'',
        ''faction_join_requested'',
        ''faction_join_approved'',
        ''faction_join_denied'',
        ''exchange_sale''
      ))';
  end if;
end $$;

-- ── 2. Add buyer_display_name to marketplace_sync_purchases ──
-- Denormalized at purchase time so vendors can see who bought without
-- joining profiles (avoids RLS issues + N+1 queries). Set by the worker
-- at purchase completion from the buyer's username.
alter table public.marketplace_sync_purchases
  add column if not exists buyer_display_name text;

alter table public.marketplace_sync_purchases
  add column if not exists buyer_avatar_url text;

-- Backfill buyer_display_name from profiles for existing purchases
update public.marketplace_sync_purchases msp
  set buyer_display_name = p.username
  from public.profiles p
  where msp.buyer_id = p.id
    and msp.buyer_display_name is null
    and p.username is not null;

-- Backfill buyer_avatar_url from profiles for existing purchases
update public.marketplace_sync_purchases msp
  set buyer_avatar_url = p.avatar_url
  from public.profiles p
  where msp.buyer_id = p.id
    and msp.buyer_avatar_url is null
    and p.avatar_url is not null;

-- ── 3. Index for vendor order queries (already exists but ensure) ──
create index if not exists msp_vendor_idx
  on public.marketplace_sync_purchases(vendor_id, created_at desc);
