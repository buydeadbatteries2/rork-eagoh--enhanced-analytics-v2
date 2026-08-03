-- ──────────────────────────────────────────────────────────────────────────
-- FACTION JOIN REQUESTS — Migration
-- Replaces instant faction joining with a request + leader approval flow.
-- All mutations go through the secure worker (service_role).
-- RLS: requesters see their own requests; leaders see their faction's requests.
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

-- Partial unique constraint: only one pending request per user per faction
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'fjr_one_pending_per_user_faction'
  ) then
    create unique index fjr_one_pending_per_user_faction
      on public.faction_join_requests(faction_id, requester_id)
      where status = 'pending';
  end if;
end $$;

-- Indexes
create index if not exists fjr_faction_id_idx on public.faction_join_requests(faction_id, status);
create index if not exists fjr_requester_id_idx on public.faction_join_requests(requester_id, status);
create index if not exists fjr_requested_at_idx on public.faction_join_requests(requested_at desc);

-- ── 2. RLS ─────────────────────────────────────────────────────────────────

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

-- Requester can cancel their own pending request (update status only)
create policy "fjr_requester_update_cancel" on public.faction_join_requests
  for update using (
    requester_id = auth.uid()
    and status = 'pending'
  );

-- No client INSERT, no client DELETE.
-- All INSERT and approve/deny UPDATE go through the secure worker (service_role).

-- ── 3. Add faction join notification types ─────────────────────────────────

-- Drop and recreate the check constraint to add new notification types
do $$ begin
  -- Check if the old constraint exists and needs updating
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'intelligence_notifications'
    and constraint_name = 'intelligence_notifications_notification_type_check'
  ) then
    alter table public.intelligence_notifications
      drop constraint intelligence_notifications_notification_type_check;
  end if;
end $$;

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

-- ── 4. Add accepting_requests column to factions ───────────────────────────

alter table public.factions
  add column if not exists accepting_requests boolean not null default true;

-- ── 5. Add blocked_users column to factions (array of user IDs) ────────────

alter table public.factions
  add column if not exists blocked_user_ids uuid[] not null default '{}';

-- ── 6. RLS for accepting_requests (commander can update) ───────────────────
-- The existing factions_commander_update policy already covers this column,
-- but let's verify it exists.
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
