-- =============================================================================
-- Exchange Vendor-Order Schema Correction Migration (Phase D2.3K)
--
-- Repairs the live schema drift pinpointed in D2.3J: the six-parameter
-- purchase_marketplace_sync_atomic() RPC (and the vendor-orders feature)
-- reference marketplace_sync_purchases.buyer_display_name / buyer_avatar_url,
-- but those columns were never materialized on the live table because the
-- vendor-orders migration was not applied. Every purchase therefore failed
-- in the RPC's §1 idempotency-replay SELECT with:
--   sqlstate=42703, detail=column "buyer_display_name" does not exist
-- before any deduction (no balance impact at any point).
--
-- This migration ONLY:
--   1. Adds the two nullable snapshot columns (idempotent).
--   2. Backfills them from profiles for historical purchases (NULL-only,
--      never overwrites an existing snapshot, no NOT NULL imposed).
--   3. Replaces the intelligence_notifications_notification_type_check
--      CHECK with the identical live value set + 'exchange_sale' — same
--      constraint name, nothing removed or renamed, with a hard safety
--      gate that aborts (rolling back the whole transaction) if the live
--      constraint allows any undocumented value.
--   4. Creates the vendor-order index (vendor_id, created_at DESC) only if
--      no equivalent index already exists under a different name.
--
-- Does NOT touch: buyer_eagoh_id, idempotency_key, purchase_status, RLS
-- policies, grants, RPC definitions, triggers, retention logic, balances,
-- or ledgers. No DELETE, TRUNCATE, or destructive data operation exists.
--
-- Rerun-safe: every statement is idempotent or guarded.
-- =============================================================================

begin;

-- =============================================================================
-- 1. Add the two missing snapshot columns (nullable, idempotent)
-- =============================================================================

alter table public.marketplace_sync_purchases
  add column if not exists buyer_display_name text;

alter table public.marketplace_sync_purchases
  add column if not exists buyer_avatar_url text;

-- =============================================================================
-- 2. Backfill historical purchases — NULL-only, never overwrite snapshots
-- =============================================================================

update public.marketplace_sync_purchases msp
   set buyer_display_name = p.username
  from public.profiles p
 where msp.buyer_id = p.id
   and msp.buyer_display_name is null
   and p.username is not null;

update public.marketplace_sync_purchases msp
   set buyer_avatar_url = p.avatar_url
  from public.profiles p
 where msp.buyer_id = p.id
   and msp.buyer_avatar_url is null
   and p.avatar_url is not null;

-- =============================================================================
-- 3. Replace ONLY intelligence_notifications_notification_type_check:
--    identical live value set + 'exchange_sale', same constraint name.
-- =============================================================================

do $d23k_constraint$
declare
  v_def        text;
  v_live_values text[];
  -- The 11 documented live values that must be preserved verbatim.
  v_known      text[] := array[
    'community_supported',
    'dispute_dismissed',
    'disputed',
    'exchange_sharing_disabled',
    'externally_supported',
    'faction_join_approved',
    'faction_join_denied',
    'faction_join_requested',
    'faction_sharing_removed',
    'outdated',
    'rejected'
  ];
begin
  select pg_get_constraintdef(oid)
    into v_def
    from pg_constraint
   where conname = 'intelligence_notifications_notification_type_check'
     and conrelid = 'public.intelligence_notifications'::regclass;

  if v_def is not null then
    -- Extract every quoted literal currently allowed by the live constraint
    -- (exact literal extraction — no substring false positives).
    select coalesce(array_agg(distinct m[1]), '{}')
      into v_live_values
      from regexp_matches(v_def, '''([^'']+)''', 'g') as m;

    -- Already applied: nothing to do, leave the live constraint untouched.
    if 'exchange_sale' = any (v_live_values) then
      raise notice 'D2.3K: notification_type check already permits exchange_sale — left untouched.';
      return;
    end if;

    -- Hard safety gate 1: refuse to replace if the live constraint allows any
    -- value outside the documented set (replacement would silently drop it).
    if exists (
      select 1 from unnest(v_live_values) as v
       where not v = any (v_known)
    ) then
      raise exception 'D2.3K: live constraint allows undocumented value(s) % — aborting instead of losing them.',
        (select string_agg(v, ', ') from unnest(v_live_values) as v where not v = any (v_known));
    end if;

    -- Hard safety gate 2: all 11 documented live values must be present.
    if exists (
      select 1 from unnest(v_known) as v
       where not v = any (v_live_values)
    ) then
      raise exception 'D2.3K: live constraint is missing documented value(s) % — aborting for manual review.',
        (select string_agg(v, ', ') from unnest(v_known) as v where not v = any (v_live_values));
    end if;

    execute 'alter table public.intelligence_notifications
      drop constraint intelligence_notifications_notification_type_check';
  end if;

  -- Same constraint name, same column, full preserved set + exchange_sale.
  execute 'alter table public.intelligence_notifications
    add constraint intelligence_notifications_notification_type_check
    check (notification_type in (
      ''community_supported'',
      ''dispute_dismissed'',
      ''disputed'',
      ''exchange_sale'',
      ''exchange_sharing_disabled'',
      ''externally_supported'',
      ''faction_join_approved'',
      ''faction_join_denied'',
      ''faction_join_requested'',
      ''faction_sharing_removed'',
      ''outdated'',
      ''rejected''
    ))';
end
$d23k_constraint$;

-- =============================================================================
-- 4. Vendor-order index — only when no equivalent (vendor_id, created_at DESC)
--    index exists, regardless of its name (no redundant duplicates).
-- =============================================================================

do $d23k_index$
declare
  v_equivalent_exists boolean;
begin
  select exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'marketplace_sync_purchases'
       and indexdef ~* '\(vendor_id, created_at( DESC)?\)'
  ) into v_equivalent_exists;

  if v_equivalent_exists then
    raise notice 'D2.3K: equivalent (vendor_id, created_at DESC) index already present — skipping.';
  else
    create index if not exists msp_vendor_orders_idx
      on public.marketplace_sync_purchases(vendor_id, created_at desc);
  end if;
end
$d23k_index$;

commit;
