-- ──────────────────────────────────────────────────────────────────────────
-- FACTION JOIN REQUESTS — Migration (v3: safety corrections)
-- Replaces instant faction joining with a request + leader approval flow.
-- All mutations go through the secure worker (service_role).
-- RLS: requesters see their own requests; leaders see their faction's requests.
-- Approval is a single SECURITY DEFINER RPC — one PostgreSQL transaction.
-- ──────────────────────────────────────────────────────────────────────────

-- ── 1. faction_join_requests table ────────────────────────────────────────

create table if not exists public.faction_join_requests (
  id uuid primary key default gen_random_uuid(),
  faction_id uuid not null references public.factions(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'cancelled')),
  message text null,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz null,
  reviewed_by uuid null references auth.users(id) on delete set null,
  decision_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Legacy column migration for existing tables
alter table public.faction_join_requests
  add column if not exists faction_id uuid,
  add column if not exists requester_id uuid,
  add column if not exists status text default 'pending',
  add column if not exists message text,
  add column if not exists requested_at timestamptz default now(),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists decision_reason text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

-- Partial unique index: only one pending request per user per faction
-- Uses IF NOT EXISTS — idempotent. Partial unique indexes live in
-- pg_class/pg_indexes, NOT pg_constraint, so the previous DO block that
-- checked pg_constraint would never find it and would attempt to recreate
-- it, causing "relation already exists" on repeated runs.
create unique index if not exists fjr_one_pending_per_user_faction
  on public.faction_join_requests(faction_id, requester_id)
  where status = 'pending';

-- Indexes
create index if not exists fjr_faction_id_idx on public.faction_join_requests(faction_id, status);
create index if not exists fjr_requester_id_idx on public.faction_join_requests(requester_id, status);
create index if not exists fjr_requested_at_idx on public.faction_join_requests(requested_at desc);

-- ── 2. Ensure unique constraint on faction_members(faction_id, user_id) ────
-- The base schema has unique(faction_id, user_id) in the CREATE TABLE,
-- but older live databases may be missing it or may have an unrelated
-- two-column unique constraint. We check for the EXACT column names
-- (faction_id, user_id) by joining pg_constraint → pg_attribute.
-- An unrelated two-column unique constraint is NOT sufficient.

do $$
declare
  v_has_exact boolean;
begin
  -- Check for a unique constraint whose columns are exactly faction_id and user_id
  select exists(
    select 1
    from pg_constraint c
    join pg_attribute a1
      on a1.attrelid = c.conrelid
      and a1.attnum = c.conkey[1]
      and a1.attname = 'faction_id'
    join pg_attribute a2
      on a2.attrelid = c.conrelid
      and a2.attnum = c.conkey[2]
      and a2.attname = 'user_id'
    where c.conrelid = 'public.faction_members'::regclass
      and c.contype = 'u'
      and array_length(c.conkey, 1) = 2
  ) into v_has_exact;

  if not v_has_exact then
    -- Remove duplicate rows first (keep the one with the smallest id)
    delete from public.faction_members fm
    using public.faction_members fm2
    where fm.faction_id = fm2.faction_id
      and fm.user_id = fm2.user_id
      and fm.id > fm2.id;

    alter table public.faction_members
      add constraint faction_members_faction_user_unique
      unique (faction_id, user_id);
  end if;
end $$;

-- ── 3. RLS ─────────────────────────────────────────────────────────────────

alter table public.faction_join_requests enable row level security;

drop policy if exists "fjr_select_own" on public.faction_join_requests;
drop policy if exists "fjr_select_leader" on public.faction_join_requests;
drop policy if exists "fjr_requester_update_cancel" on public.faction_join_requests;

-- Requester can see their own requests
create policy "fjr_select_own" on public.faction_join_requests
  for select using (requester_id = auth.uid());

-- Leader can see requests for their faction
create policy "fjr_select_leader" on public.faction_join_requests
  for select using (
    exists (
      select 1 from public.factions f
      where f.id = faction_id and f.commander_id = auth.uid()
    )
  );

-- No client INSERT, UPDATE, or DELETE.
-- All mutations (create, cancel, approve, deny) go through the secure
-- worker (service_role), which bypasses RLS.
-- The requester UPDATE policy was removed to prevent modified clients from
-- self-approving or altering status/faction_id/requester_id/reviewed_by/etc.
-- Cancellation is handled by POST /factions/join-requests/cancel (worker endpoint).

-- ── 4. Preserve all existing notification types + add faction join types ───
-- Instead of blindly dropping and recreating from a hardcoded list, we:
--   1. Read the existing constraint definition from pg_constraint
--   2. Check for any rows with notification_type values absent from the
--      complete list (8 original + 3 new = 11 total)
--   3. If orphaned values exist, abort with an error so no data is invalidated
--   4. Drop the old constraint and recreate with the full 11-type list
--
-- Complete notification type list (verified from base schema + worker + app):
--   Original 8 (from supabase-schema.sql):
--     community_supported, externally_supported, disputed, rejected,
--     dispute_dismissed, outdated, exchange_sharing_disabled,
--     faction_sharing_removed
--   New 3 (faction join request system):
--     faction_join_requested, faction_join_approved, faction_join_denied

do $$
declare
  v_constraint_exists boolean;
  v_orphaned_count integer;
  v_existing_def text;
begin
  -- Check if the constraint exists
  select exists(
    select 1 from information_schema.table_constraints
    where table_name = 'intelligence_notifications'
      and constraint_name = 'intelligence_notifications_notification_type_check'
  ) into v_constraint_exists;

  if v_constraint_exists then
    -- Read the existing constraint definition for audit purposes
    select pg_get_constraintdef(c.oid)
      into v_existing_def
    from pg_constraint c
    where c.conrelid = 'public.intelligence_notifications'::regclass
      and c.conname = 'intelligence_notifications_notification_type_check';

    -- Check for any rows with notification_type values not in the complete list
    -- This prevents accidentally invalidating existing data
    select count(*) into v_orphaned_count
    from public.intelligence_notifications
    where notification_type not in (
      'community_supported',
      'externally_supported',
      'disputed',
      'rejected',
      'dispute_dismissed',
      'outdated',
      'exchange_sharing_disabled',
      'faction_sharing_removed',
      'faction_join_requested',
      'faction_join_approved',
      'faction_join_denied'
    );

    if v_orphaned_count > 0 then
      raise exception
        'ABORTING: Found % row(s) with notification_type values not in the new constraint. '
        'Existing constraint: %. '
        'Please review and add the missing type(s) before re-running this migration.',
        v_orphaned_count, v_existing_def
        using errcode = 'check_violation';
    end if;

    -- Safe to drop — no orphaned data
    alter table public.intelligence_notifications
      drop constraint intelligence_notifications_notification_type_check;
  end if;

  -- Create the constraint with all 11 types
  alter table public.intelligence_notifications
    add constraint intelligence_notifications_notification_type_check
    check (notification_type in (
      'community_supported',
      'externally_supported',
      'disputed',
      'rejected',
      'dispute_dismissed',
      'outdated',
      'exchange_sharing_disabled',
      'faction_sharing_removed',
      'faction_join_requested',
      'faction_join_approved',
      'faction_join_denied'
    ));
end $$;

-- ── 5. Add accepting_requests column to factions ───────────────────────────

alter table public.factions
  add column if not exists accepting_requests boolean not null default true;

-- ── 6. Add blocked_users column to factions (array of user IDs) ────────────

alter table public.factions
  add column if not exists blocked_user_ids uuid[] not null default '{}';

-- ── 7. RLS for accepting_requests (commander can update) ───────────────────
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'factions'
    and policyname = 'factions_commander_update'
  ) then
    create policy "factions_commander_update" on public.factions
      for update using (commander_id = auth.uid());
  end if;
end $$;

-- ── 8. Atomic approval RPC ─────────────────────────────────────────────────
-- SECURITY DEFINER: runs with the function owner's privileges (service_role).
-- All critical membership work happens in one PostgreSQL transaction.
-- If any step fails, the entire operation rolls back.
-- Notification is NOT included here — it is sent by the worker AFTER the RPC
-- succeeds, and notification failure does not undo the approval.

create or replace function public.approve_faction_join_request(
  p_request_id uuid,
  p_leader_id uuid
)
returns table(
  success boolean,
  error_code text,
  error_message text,
  member_id uuid,
  faction_id uuid,
  requester_id uuid,
  faction_name text,
  actual_member_count integer,
  already_member boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request    record;
  v_faction    record;
  v_profile    record;
  v_member_id  uuid;
  v_count      integer;
  v_already    boolean := false;
begin
  -- 1. Lock the join request row FOR UPDATE
  select * into v_request
    from faction_join_requests
    where id = p_request_id
    for update;

  -- 2. Confirm the request exists
  if not found then
    return query select false, 'NOT_FOUND', 'Join request not found.',
      null::uuid, null::uuid, null::uuid, null::text, null::integer, false;
    return;
  end if;

  -- 3. Confirm status = 'pending'
  if v_request.status <> 'pending' then
    -- If already approved and the requester is already a member, return idempotent
    if v_request.status = 'approved' then
      select exists(
        select 1 from faction_members
        where faction_id = v_request.faction_id
          and user_id = v_request.requester_id
      ) into v_already;

      if v_already then
        select count(*) into v_count
          from faction_members
          where faction_id = v_request.faction_id
            and status = 'active';

        select name into v_faction.name from factions where id = v_request.faction_id;

        return query select true, null, null,
          null::uuid, v_request.faction_id, v_request.requester_id,
          v_faction.name, v_count, true;
        return;
      end if;
    end if;

    return query select false, 'ALREADY_PROCESSED',
      'This request has already been processed.',
      null::uuid, null::uuid, null::uuid, null::text, null::integer, false;
    return;
  end if;

  -- 4. Lock the faction row FOR UPDATE
  select * into v_faction
    from factions
    where id = v_request.faction_id
    for update;

  if not found then
    return query select false, 'FACTION_NOT_FOUND', 'Faction not found.',
      null::uuid, null::uuid, null::uuid, null::text, null::integer, false;
    return;
  end if;

  -- 5. Confirm p_leader_id is the current faction leader
  if v_faction.commander_id <> p_leader_id then
    return query select false, 'NOT_LEADER',
      'Only the Faction leader can approve requests.',
      null::uuid, null::uuid, null::uuid, null::text, null::integer, false;
    return;
  end if;

  -- 6. Confirm requester is not already a member
  select exists(
    select 1 from faction_members
    where faction_id = v_request.faction_id
      and user_id = v_request.requester_id
  ) into v_already;

  if v_already then
    -- Mark as approved and skip member insert — idempotent
    update faction_join_requests
      set status = 'approved',
          reviewed_at = now(),
          reviewed_by = p_leader_id
      where id = v_request.id;

    -- Count actual members
    select count(*) into v_count
      from faction_members
      where faction_id = v_request.faction_id
        and status = 'active';

    -- Sync current_members to actual count
    update factions
      set current_members = v_count
      where id = v_request.faction_id;

    return query select true, null, null,
      null::uuid, v_request.faction_id, v_request.requester_id,
      v_faction.name, v_count, true;
    return;
  end if;

  -- 7. Confirm requester is still eligible (tier check)
  select subscription_tier into v_profile
    from profiles
    where id = v_request.requester_id;

  if v_profile.subscription_tier is null or v_profile.subscription_tier = 'free' then
    -- Mark as denied — requester is no longer eligible
    update faction_join_requests
      set status = 'denied',
          reviewed_at = now(),
          reviewed_by = p_leader_id,
          decision_reason = 'Requester no longer has a paid subscription.'
      where id = v_request.id;

    return query select false, 'NOT_ELIGIBLE',
      'Requester no longer has an eligible subscription.',
      null::uuid, null::uuid, null::uuid, null::text, null::integer, false;
    return;
  end if;

  -- 8. Count actual faction_members rows (do NOT trust stored current_members)
  select count(*) into v_count
    from faction_members
    where faction_id = v_request.faction_id
      and status = 'active';

  -- 9. Confirm capacity is available
  if v_count >= v_faction.max_members then
    return query select false, 'FACTION_FULL',
      'This Faction no longer has an available member slot.',
      null::uuid, null::uuid, null::uuid, null::text, v_count, false;
    return;
  end if;

  -- 10. Insert requester into faction_members
  insert into faction_members (faction_id, user_id, role, status)
    values (v_request.faction_id, v_request.requester_id, 'recruit', 'active')
    returning id into v_member_id;

  -- 11. Update current_members using the actual member count
  v_count := v_count + 1;

  update factions
    set current_members = v_count
    where id = v_request.faction_id;

  -- 12. Mark the request approved
  -- 13. Set reviewed_at and reviewed_by
  update faction_join_requests
    set status = 'approved',
        reviewed_at = now(),
        reviewed_by = p_leader_id
    where id = v_request.id;

  -- 14. Insert the faction activity row
  insert into faction_activity (faction_id, user_id, kind, details)
    values (
      v_request.faction_id,
      v_request.requester_id,
      'member_joined',
      jsonb_build_object('faction_name', v_faction.name, 'via', 'join_request')
    );

  -- 15. Return the approved member and updated member count
  return query select true, null, null,
    v_member_id, v_request.faction_id, v_request.requester_id,
    v_faction.name, v_count, false;
end;
$$;

-- Grant execute to the service role (used by the Cloudflare Worker)
-- and revoke from public/anon so only the worker can call it.
grant execute on function public.approve_faction_join_request(uuid, uuid)
  to service_role;
revoke execute on function public.approve_faction_join_request(uuid, uuid)
  from public, anon;
