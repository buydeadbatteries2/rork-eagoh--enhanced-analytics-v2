-- =============================================================================
-- EAGOH Supabase Schema — production-ready, single-pass executable
-- Run once in the Supabase SQL editor to bootstrap the entire data layer.
-- =============================================================================

-- =============================================================================
-- PROFILES (extends auth.users)
-- =============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  subscription_tier text default 'free',
  edge_subscription int default 0,
  edge_purchased int default 0,
  selected_labs jsonb default '[]'::jsonb,
  selected_eagohs jsonb default '[]'::jsonb,
  preferences jsonb default '{}'::jsonb,
  last_rollover_at timestamptz,
  last_allocation int default 0,
  admin_tier_override text,
  admin_tier_expires_at timestamptz,
  admin_tier_note text,
  is_admin boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.profiles
  add column if not exists username text,
  add column if not exists subscription_tier text,
  add column if not exists edge_subscription integer,
  add column if not exists edge_purchased integer,
  add column if not exists selected_labs jsonb,
  add column if not exists selected_eagohs jsonb,
  add column if not exists preferences jsonb,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists last_rollover_at timestamptz,
  add column if not exists last_allocation int,
  add column if not exists admin_tier_override text,
  add column if not exists admin_tier_expires_at timestamptz,
  add column if not exists admin_tier_note text,
  add column if not exists is_admin boolean,
  add column if not exists avatar_url text,
  add column if not exists banner_url text,
  add column if not exists public_display_title text,
  add column if not exists is_social_verified boolean,
  add column if not exists social_verified_platform text,
  add column if not exists bio text,
  add column if not exists display_name text,
  add column if not exists public_profile_enabled boolean,
  add column if not exists show_social_accounts boolean,
  add column if not exists show_credentials boolean,
  add column if not exists show_public_eagohs boolean,
  add column if not exists show_faction boolean;

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──

alter table public.profiles enable row level security;

drop policy if exists "profiles_self_select" on public.profiles;
drop policy if exists "profiles_self_insert" on public.profiles;
drop policy if exists "profiles_self_update" on public.profiles;
drop policy if exists "profiles_marketplace_select" on public.profiles;
drop policy if exists "profiles_public_profile_select" on public.profiles;

-- Owner can read/write their own profile
create policy "profiles_self_select"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_self_insert"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_self_update"
  on public.profiles for update
  using (auth.uid() = id);

-- Marketplace: anyone can read basic profile info for users who are active vendors
create policy "profiles_marketplace_select" on public.profiles
  for select using (
    exists (
      select 1 from public.marketplace_listings ml
      where ml.vendor_id = profiles.id and ml.active = true
    )
  );

-- Public Profile: any authenticated user can read public profiles
-- where public_profile_enabled is true (opt-in visibility)
create policy "profiles_public_profile_select"
  on public.profiles for select
  to authenticated
  using (public_profile_enabled = true);

-- ---------------------------------------------------------------------------
-- Trigger: auto-create public.profiles when a new auth.users row is inserted
-- The app may also handle this client-side; this trigger acts as a safe fallback.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- EAGOHS (core identity)
-- =============================================================================
create table if not exists public.eagohs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sport text,
  gender text,
  domain text,
  body_type text,
  style_notes text,
  cybernetic_intensity text,
  pose text,
  lab text,
  dna jsonb default '[]'::jsonb,
  image_url text,
  image_thumb_url text,
  image_prompt text,
  image_generated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.eagohs
  add column if not exists user_id uuid,
  add column if not exists name text,
  add column if not exists sport text,
  add column if not exists gender text,
  add column if not exists cybernetic_intensity text,
  add column if not exists pose text,
  add column if not exists lab text,
  add column if not exists dna jsonb,
  add column if not exists image_url text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists domain text,
  add column if not exists body_type text,
  add column if not exists style_notes text,
  add column if not exists image_thumb_url text,
  add column if not exists image_prompt text,
  add column if not exists image_generated_at timestamptz,
  add column if not exists last_name_change timestamptz,
  add column if not exists team_focus_mode text,
  add column if not exists pro_team_focus_id text,
  add column if not exists pro_team_focus_name text,
  add column if not exists college_team_focus_id text,
  add column if not exists college_team_focus_name text,
  add column if not exists music_genre text,
  add column if not exists music_role text,
  add column if not exists film_tv_category text,
  add column if not exists film_tv_genre text,
  add column if not exists film_tv_role text,
  add column if not exists fashion_style_category text,
  add column if not exists fashion_role text,
  add column if not exists education_subject text,
  add column if not exists education_role text,
  add column if not exists gaming_genre text,
  add column if not exists gaming_role text,
  add column if not exists business_industry text,
  add column if not exists business_role text,
  add column if not exists finance_focus text,
  add column if not exists finance_role text,
  add column if not exists technology_area text,
  add column if not exists technology_role text,
  add column if not exists health_fitness_area text,
  add column if not exists health_fitness_role text,
  add column if not exists is_default_shell boolean,
  add column if not exists is_user_forged boolean,
  add column if not exists status text;

create index if not exists eagohs_user_id_idx on public.eagohs(user_id);
create index if not exists eagohs_user_default_shell_idx on public.eagohs(user_id, is_default_shell);

-- ── Dev test subscriptions (Expo Go / Rork development only) ─────────────────
-- Stores per-user development test tiers so the secure Cloudflare Worker can
-- recognise them without trusting a client-supplied tier. The worker only
-- reads this table when ENABLE_DEV_TEST_SUBSCRIPTIONS env flag is "true".
-- Never used in production / TestFlight.
create table if not exists public.dev_test_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  test_tier text not null check (test_tier in ('free','pro','oracle_elite','syndicate')),
  expires_at timestamptz default (now() + interval '30 days'),
  created_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.dev_test_subscriptions
  add column if not exists user_id uuid,
  add column if not exists test_tier text,
  add column if not exists expires_at timestamptz,
  add column if not exists created_at timestamptz;

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──

alter table public.dev_test_subscriptions enable row level security;

drop policy if exists "dev_test_subscriptions_self_select" on public.dev_test_subscriptions;
drop policy if exists "dev_test_subscriptions_self_upsert" on public.dev_test_subscriptions;
drop policy if exists "dev_test_subscriptions_self_delete" on public.dev_test_subscriptions;

create policy "dev_test_subscriptions_self_select" on public.dev_test_subscriptions
  for select using (auth.uid() = user_id);
create policy "dev_test_subscriptions_self_upsert" on public.dev_test_subscriptions
  for insert with check (auth.uid() = user_id);
drop policy if exists "dev_test_subscriptions_self_update" on public.dev_test_subscriptions;
create policy "dev_test_subscriptions_self_update" on public.dev_test_subscriptions
  for update using (auth.uid() = user_id);
create policy "dev_test_subscriptions_self_delete" on public.dev_test_subscriptions
  for delete using (auth.uid() = user_id);

alter table public.eagohs enable row level security;

drop policy if exists "eagohs_self_select" on public.eagohs;
drop policy if exists "eagohs_self_insert" on public.eagohs;
drop policy if exists "eagohs_self_update" on public.eagohs;
drop policy if exists "eagohs_self_delete" on public.eagohs;
drop policy if exists "eagohs_marketplace_select" on public.eagohs;

-- Owner can read/write their own EAGOHs
create policy "eagohs_self_select" on public.eagohs for select using (auth.uid() = user_id);
create policy "eagohs_self_insert" on public.eagohs for insert with check (auth.uid() = user_id);
create policy "eagohs_self_update" on public.eagohs for update using (auth.uid() = user_id);
create policy "eagohs_self_delete" on public.eagohs for delete using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════
-- CRITICAL: Marketplace image visibility depends on this policy.
-- Without it, the eagoh join in marketplace_listings queries returns NULL
-- for EAGOHs owned by other users, and their images will not display.
-- This policy is read-only — it does NOT grant write access.
-- ═══════════════════════════════════════════════════════════════════════
create policy "eagohs_marketplace_select" on public.eagohs
  for select using (
    exists (
      select 1 from public.marketplace_listings ml
      where ml.eagoh_id = eagohs.id and ml.active = true
    )
  );

-- =============================================================================
-- EAGOH CUSTOMIZATION (appearance map)
-- =============================================================================
create table if not exists public.eagoh_customization (
  eagoh_id uuid primary key references public.eagohs(id) on delete cascade,
  appearance jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.eagoh_customization
  add column if not exists eagoh_id uuid,
  add column if not exists appearance jsonb,
  add column if not exists updated_at timestamptz;

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──

alter table public.eagoh_customization enable row level security;

drop policy if exists "eagoh_customization_self_all" on public.eagoh_customization;

create policy "eagoh_customization_self_all" on public.eagoh_customization
  for all
  using (exists (select 1 from public.eagohs e where e.id = eagoh_id and e.user_id = auth.uid()))
  with check (exists (select 1 from public.eagohs e where e.id = eagoh_id and e.user_id = auth.uid()));

-- =============================================================================
-- EAGOH FANATIC TEAMS (many-to-many)
-- =============================================================================
create table if not exists public.eagoh_fanatic_teams (
  eagoh_id uuid not null references public.eagohs(id) on delete cascade,
  team_id text not null,
  created_at timestamptz default now(),
  primary key (eagoh_id, team_id)
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.eagoh_fanatic_teams
  add column if not exists eagoh_id uuid,
  add column if not exists team_id text,
  add column if not exists created_at timestamptz;

create index if not exists eagoh_fanatic_teams_eagoh_idx on public.eagoh_fanatic_teams(eagoh_id);

alter table public.eagoh_fanatic_teams enable row level security;

drop policy if exists "eagoh_fanatic_teams_self_all" on public.eagoh_fanatic_teams;

create policy "eagoh_fanatic_teams_self_all" on public.eagoh_fanatic_teams
  for all
  using (exists (select 1 from public.eagohs e where e.id = eagoh_id and e.user_id = auth.uid()))
  with check (exists (select 1 from public.eagohs e where e.id = eagoh_id and e.user_id = auth.uid()));

-- =============================================================================
-- EAGOH LABS (selected labs per EAGOH)
-- =============================================================================
create table if not exists public.eagoh_labs (
  eagoh_id uuid not null references public.eagohs(id) on delete cascade,
  lab_id text not null,
  created_at timestamptz default now(),
  primary key (eagoh_id, lab_id)
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.eagoh_labs
  add column if not exists eagoh_id uuid,
  add column if not exists lab_id text,
  add column if not exists created_at timestamptz;

create index if not exists eagoh_labs_eagoh_idx on public.eagoh_labs(eagoh_id);

alter table public.eagoh_labs enable row level security;

drop policy if exists "eagoh_labs_self_all" on public.eagoh_labs;

create policy "eagoh_labs_self_all" on public.eagoh_labs
  for all
  using (exists (select 1 from public.eagohs e where e.id = eagoh_id and e.user_id = auth.uid()))
  with check (exists (select 1 from public.eagohs e where e.id = eagoh_id and e.user_id = auth.uid()));

-- =============================================================================
-- EDGE TRANSACTIONS (wallet history)
-- =============================================================================
create table if not exists public.edge_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  reason text not null,
  amount int not null,
  bucket text not null,
  from_subscription int default 0,
  from_purchased int default 0,
  balance_subscription_after int default 0,
  balance_purchased_after int default 0,
  note text,
  created_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.edge_transactions
  add column if not exists user_id uuid,
  add column if not exists kind text,
  add column if not exists reason text,
  add column if not exists amount integer,
  add column if not exists bucket text,
  add column if not exists from_subscription integer,
  add column if not exists from_purchased integer,
  add column if not exists balance_subscription_after integer,
  add column if not exists balance_purchased_after integer,
  add column if not exists note text,
  add column if not exists created_at timestamptz;

create index if not exists edge_transactions_user_idx on public.edge_transactions(user_id, created_at desc);

alter table public.edge_transactions enable row level security;

drop policy if exists "edge_transactions_self_select" on public.edge_transactions;
drop policy if exists "edge_transactions_self_insert" on public.edge_transactions;

create policy "edge_transactions_self_select" on public.edge_transactions
  for select using (auth.uid() = user_id);

create policy "edge_transactions_self_insert" on public.edge_transactions
  for insert with check (auth.uid() = user_id);

-- =============================================================================
-- EAGOH IMAGE GENERATIONS (history of forge renders)
-- =============================================================================
create table if not exists public.eagoh_image_generations (
  id uuid primary key default gen_random_uuid(),
  eagoh_id uuid not null references public.eagohs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  prompt text not null,
  image_url text not null,
  thumb_url text,
  edge_cost int default 0,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.eagoh_image_generations
  add column if not exists eagoh_id uuid,
  add column if not exists user_id uuid,
  add column if not exists mode text,
  add column if not exists prompt text,
  add column if not exists image_url text,
  add column if not exists thumb_url text,
  add column if not exists edge_cost integer,
  add column if not exists meta jsonb,
  add column if not exists created_at timestamptz;

create index if not exists eagoh_image_generations_eagoh_idx on public.eagoh_image_generations(eagoh_id, created_at desc);
create index if not exists eagoh_image_generations_user_idx on public.eagoh_image_generations(user_id, created_at desc);

alter table public.eagoh_image_generations enable row level security;

drop policy if exists "eagoh_image_generations_self_select" on public.eagoh_image_generations;
drop policy if exists "eagoh_image_generations_self_insert" on public.eagoh_image_generations;

create policy "eagoh_image_generations_self_select" on public.eagoh_image_generations
  for select using (auth.uid() = user_id);

create policy "eagoh_image_generations_self_insert" on public.eagoh_image_generations
  for insert with check (auth.uid() = user_id);

-- =============================================================================
-- OPEN INTELLIGENCE (user-submitted observation entries per EAGOH)
-- =============================================================================
create table if not exists public.open_intelligence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  eagoh_id uuid not null references public.eagohs(id) on delete cascade,
  intelligence_domain text not null,
  entry_type text not null,
  tag text not null,
  content text not null,
  character_count_no_spaces int not null default 0,
  confidence_level text not null default 'moderate_confidence',
  quality_score int not null default 0,
  validation_status text not null default 'pending_review',
  influence_score int not null default 0,
  selected_category text,
  selected_subtags jsonb default '[]'::jsonb,
  custom_tags jsonb default '[]'::jsonb,
  exchange_share_enabled boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.open_intelligence
  add column if not exists user_id uuid,
  add column if not exists eagoh_id uuid,
  add column if not exists intelligence_domain text,
  add column if not exists entry_type text,
  add column if not exists tag text,
  add column if not exists content text,
  add column if not exists character_count_no_spaces integer,
  add column if not exists confidence_level text,
  add column if not exists quality_score integer,
  add column if not exists validation_status text,
  add column if not exists influence_score integer,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists selected_category text,
  add column if not exists selected_subtags jsonb,
  add column if not exists custom_tags jsonb,
  add column if not exists exchange_share_enabled boolean,
  add column if not exists staleness_score numeric,
  add column if not exists staleness_evaluated_at timestamptz,
  add column if not exists outdated_flag boolean,
  add column if not exists content_hash text,
  add column if not exists duplicate_flag boolean,
  add column if not exists duplicate_of uuid,
  add column if not exists version_number int,
  add column if not exists last_major_edit_at timestamptz,
  add column if not exists active_dispute_count int;

create index if not exists oi_user_id_idx on public.open_intelligence(user_id, created_at desc);
create index if not exists oi_eagoh_id_idx on public.open_intelligence(eagoh_id, created_at desc);
create index if not exists oi_domain_idx on public.open_intelligence(intelligence_domain);

alter table public.open_intelligence enable row level security;

drop policy if exists "oi_self_select" on public.open_intelligence;
drop policy if exists "oi_self_insert" on public.open_intelligence;

create policy "oi_self_select" on public.open_intelligence
  for select using (auth.uid() = user_id);

create policy "oi_self_insert" on public.open_intelligence
  for insert with check (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════
-- FACTION INTELLIGENCE: Allow authenticated faction members to read
-- Open Intelligence entries that have been explicitly shared with their
-- active Faction. This is read-only — write access remains owner-only.
-- The fsi_select_faction_members policy on faction_shared_intelligence
-- already gates which shared-intel rows a user can see (active members
-- in the same faction). This policy extends that to the OI table so the
-- Cloudflare Worker can resolve the shared entry content server-side.
-- ═══════════════════════════════════════════════════════════════════════
drop policy if exists "oi_faction_shared_select" on public.open_intelligence;
create policy "oi_faction_shared_select" on public.open_intelligence
  for select using (
    exists (
      select 1 from public.faction_shared_intelligence fsi
      join public.faction_members fm on fm.faction_id = fsi.faction_id
      where fsi.oi_entry_id = open_intelligence.id
        and fm.user_id = auth.uid()
        and fm.status in ('active', 'grace_period')
    )
  );

-- Backfill: add columns if table already exists in production
select 1 from pg_catalog.pg_tables where schemaname = 'public' and tablename = 'open_intelligence';

do $$
begin
exception when others then null;
end $$;

-- =============================================================================
-- FACTIONS (intelligence alliances)
-- =============================================================================
create table if not exists public.factions (
  id uuid primary key default gen_random_uuid(),
  commander_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  motto text,
  fanatic_team_focus text,
  emblem text,
  intelligence_domain text not null default 'sports',
  included_members int not null default 3,
  max_members int not null default 10,
  current_members int not null default 1,
  influence_score int not null default 0,
  created_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.factions
  add column if not exists commander_id uuid,
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists emblem text,
  add column if not exists intelligence_domain text,
  add column if not exists included_members integer,
  add column if not exists max_members integer,
  add column if not exists current_members integer,
  add column if not exists influence_score integer,
  add column if not exists created_at timestamptz,
  add column if not exists motto text,
  add column if not exists fanatic_team_focus text;

create index if not exists factions_commander_id_idx on public.factions(commander_id);

alter table public.factions enable row level security;

drop policy if exists "factions_select_all" on public.factions;
drop policy if exists "factions_commander_insert" on public.factions;
drop policy if exists "factions_commander_update" on public.factions;
drop policy if exists "factions_commander_delete" on public.factions;

create policy "factions_select_all" on public.factions
  for select using (true);

create policy "factions_commander_insert" on public.factions
  for insert with check (auth.uid() = commander_id);

create policy "factions_commander_update" on public.factions
  for update using (auth.uid() = commander_id);

create policy "factions_commander_delete" on public.factions
  for delete using (auth.uid() = commander_id);

-- =============================================================================
-- FACTION MEMBERS (roles and statuses)
-- =============================================================================
create table if not exists public.faction_members (
  id uuid primary key default gen_random_uuid(),
  faction_id uuid not null references public.factions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'analyst',
  status text not null default 'active',
  downgrade_at timestamptz,
  joined_at timestamptz default now(),
  unique(faction_id, user_id)
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.faction_members
  add column if not exists faction_id uuid,
  add column if not exists user_id uuid,
  add column if not exists role text,
  add column if not exists status text,
  add column if not exists downgrade_at timestamptz,
  add column if not exists joined_at timestamptz;

create index if not exists fm_faction_id_idx on public.faction_members(faction_id);
create index if not exists fm_user_id_idx on public.faction_members(user_id);

alter table public.faction_members enable row level security;

drop policy if exists "fm_select_all" on public.faction_members;
drop policy if exists "fm_self_insert" on public.faction_members;
drop policy if exists "fm_self_update" on public.faction_members;
drop policy if exists "fm_commander_delete" on public.faction_members;

create policy "fm_select_all" on public.faction_members
  for select using (true);

create policy "fm_self_insert" on public.faction_members
  for insert with check (auth.uid() = user_id);

create policy "fm_self_update" on public.faction_members
  for update using (auth.uid() = user_id);

create policy "fm_commander_delete" on public.faction_members
  for delete using (
    exists (
      select 1 from public.factions f
      where f.id = faction_id and f.commander_id = auth.uid()
    )
  );

-- =============================================================================
-- FACTION INVITES
-- =============================================================================
create table if not exists public.faction_invites (
  id uuid primary key default gen_random_uuid(),
  faction_id uuid not null references public.factions(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'analyst',
  status text not null default 'pending',
  expires_at timestamptz default (now() + interval '7 days'),
  created_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.faction_invites
  add column if not exists faction_id uuid,
  add column if not exists inviter_id uuid,
  add column if not exists invitee_id uuid,
  add column if not exists role text,
  add column if not exists status text,
  add column if not exists expires_at timestamptz,
  add column if not exists created_at timestamptz;

create index if not exists fi_invitee_idx on public.faction_invites(invitee_id, status);
create index if not exists fi_faction_idx on public.faction_invites(faction_id);

alter table public.faction_invites enable row level security;

drop policy if exists "fi_select_self" on public.faction_invites;
drop policy if exists "fi_commander_insert" on public.faction_invites;
drop policy if exists "fi_invitee_update" on public.faction_invites;

create policy "fi_select_self" on public.faction_invites
  for select using (auth.uid() = inviter_id or auth.uid() = invitee_id);

create policy "fi_commander_insert" on public.faction_invites
  for insert with check (
    exists (
      select 1 from public.factions f
      where f.id = faction_id and f.commander_id = auth.uid()
    )
  );

create policy "fi_invitee_update" on public.faction_invites
  for update using (auth.uid() = invitee_id);

-- =============================================================================
-- FACTION ACTIVITY (event log)
-- =============================================================================
create table if not exists public.faction_activity (
  id uuid primary key default gen_random_uuid(),
  faction_id uuid not null references public.factions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  details jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.faction_activity
  add column if not exists faction_id uuid,
  add column if not exists user_id uuid,
  add column if not exists kind text,
  add column if not exists details jsonb,
  add column if not exists created_at timestamptz;

create index if not exists fa_faction_idx on public.faction_activity(faction_id, created_at desc);

alter table public.faction_activity enable row level security;

drop policy if exists "fa_select_all" on public.faction_activity;
drop policy if exists "fa_self_insert" on public.faction_activity;

create policy "fa_select_all" on public.faction_activity
  for select using (true);

create policy "fa_self_insert" on public.faction_activity
  for insert with check (auth.uid() = user_id);

-- =============================================================================
-- FACTION SHARED INTELLIGENCE (links OI entries to factions)
-- =============================================================================
create table if not exists public.faction_shared_intelligence (
  id uuid primary key default gen_random_uuid(),
  faction_id uuid not null references public.factions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  oi_entry_id uuid not null references public.open_intelligence(id) on delete cascade,
  shared_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.faction_shared_intelligence
  add column if not exists faction_id uuid,
  add column if not exists user_id uuid,
  add column if not exists oi_entry_id uuid,
  add column if not exists shared_at timestamptz;

create index if not exists fsi_faction_idx on public.faction_shared_intelligence(faction_id, shared_at desc);
create index if not exists fsi_user_idx on public.faction_shared_intelligence(user_id);

alter table public.faction_shared_intelligence enable row level security;

-- Idempotent RLS policies for faction_shared_intelligence
do $$
declare
  already_exists boolean;
begin
  select exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'faction_shared_intelligence'
      and policyname = 'fsi_select_faction_members'
  ) into already_exists;
  if not already_exists then
    execute $policy$
      create policy "fsi_select_faction_members" on public.faction_shared_intelligence
        for select using (
          exists (
            select 1 from public.faction_members fm
            where fm.faction_id = faction_id
              and fm.user_id = auth.uid()
              and fm.status = 'active'
          )
        )
    $policy$;
  end if;
end;
$$;

do $$
declare
  already_exists boolean;
begin
  select exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'faction_shared_intelligence'
      and policyname = 'fsi_self_insert'
  ) into already_exists;
  if not already_exists then
    execute $policy$
      create policy "fsi_self_insert" on public.faction_shared_intelligence
        for insert with check (auth.uid() = user_id)
    $policy$;
  end if;
end;
$$;

do $$
declare
  already_exists boolean;
begin
  select exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'faction_shared_intelligence'
      and policyname = 'fsi_commander_delete'
  ) into already_exists;
  if not already_exists then
    execute $policy$
      create policy "fsi_commander_delete" on public.faction_shared_intelligence
        for delete using (
          exists (
            select 1 from public.factions f
            where f.id = faction_id and f.commander_id = auth.uid()
          )
        )
    $policy$;
  end if;
end;
$$;

-- =============================================================================
-- FACTION SLOT PURCHASES (expansion history)
-- =============================================================================
create table if not exists public.faction_slot_purchases (
  id uuid primary key default gen_random_uuid(),
  faction_id uuid not null references public.factions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  slots_purchased int not null,
  edge_cost int not null,
  purchased_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.faction_slot_purchases
  add column if not exists faction_id uuid,
  add column if not exists user_id uuid,
  add column if not exists slots_purchased integer,
  add column if not exists edge_cost integer,
  add column if not exists purchased_at timestamptz;

create index if not exists fsp_faction_idx on public.faction_slot_purchases(faction_id, purchased_at desc);

alter table public.faction_slot_purchases enable row level security;

drop policy if exists "fsp_select_all" on public.faction_slot_purchases;
drop policy if exists "fsp_self_insert" on public.faction_slot_purchases;

create policy "fsp_select_all" on public.faction_slot_purchases
  for select using (true);

create policy "fsp_self_insert" on public.faction_slot_purchases
  for insert with check (auth.uid() = user_id);

-- =============================================================================
-- MARKETPLACE LISTINGS (EAGOHs listed for sync sale by vendors)
-- =============================================================================
create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references auth.users(id) on delete cascade,
  eagoh_id uuid not null references public.eagohs(id) on delete cascade,
  active boolean not null default true,
  price_25_per_day int not null default 0,
  price_50_per_day int not null default 0,
  price_75_per_day int not null default 0,
  price_100_per_day int not null default 0,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.marketplace_listings
  add column if not exists vendor_id uuid,
  add column if not exists eagoh_id uuid,
  add column if not exists active boolean,
  add column if not exists price_25_per_day integer,
  add column if not exists price_50_per_day integer,
  add column if not exists price_75_per_day integer,
  add column if not exists price_100_per_day integer,
  add column if not exists description text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

create index if not exists ml_vendor_idx on public.marketplace_listings(vendor_id);
create index if not exists ml_eagoh_idx on public.marketplace_listings(eagoh_id);
create index if not exists ml_active_idx on public.marketplace_listings(active) where active = true;

alter table public.marketplace_listings enable row level security;

drop policy if exists "ml_select_all" on public.marketplace_listings;
drop policy if exists "ml_vendor_insert" on public.marketplace_listings;
drop policy if exists "ml_vendor_update" on public.marketplace_listings;
drop policy if exists "ml_vendor_delete" on public.marketplace_listings;

create policy "ml_select_all" on public.marketplace_listings
  for select using (active = true or auth.uid() = vendor_id);

create policy "ml_vendor_insert" on public.marketplace_listings
  for insert with check (auth.uid() = vendor_id);

create policy "ml_vendor_update" on public.marketplace_listings
  for update using (auth.uid() = vendor_id);

create policy "ml_vendor_delete" on public.marketplace_listings
  for delete using (auth.uid() = vendor_id);

-- =============================================================================
-- MARKETPLACE SYNC PURCHASES
-- =============================================================================
create table if not exists public.marketplace_sync_purchases (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.marketplace_listings(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  vendor_id uuid not null references auth.users(id) on delete cascade,
  eagoh_id uuid not null references public.eagohs(id) on delete cascade,
  sync_level text not null check (sync_level in ('25%', '50%', '75%', '100%')),
  days int not null check (days between 1 and 5),
  edge_cost int not null,
  started_at timestamptz default now(),
  expires_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.marketplace_sync_purchases
  add column if not exists listing_id uuid,
  add column if not exists buyer_id uuid,
  add column if not exists vendor_id uuid,
  add column if not exists eagoh_id uuid,
  add column if not exists sync_level text,
  add column if not exists days integer,
  add column if not exists edge_cost integer,
  add column if not exists started_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists active boolean,
  add column if not exists created_at timestamptz;

create index if not exists msp_buyer_idx on public.marketplace_sync_purchases(buyer_id, created_at desc);
create index if not exists msp_vendor_idx on public.marketplace_sync_purchases(vendor_id, created_at desc);
create index if not exists msp_expires_idx on public.marketplace_sync_purchases(expires_at) where active = true;
create index if not exists msp_active_idx on public.marketplace_sync_purchases(buyer_id, eagoh_id, active);

alter table public.marketplace_sync_purchases enable row level security;

drop policy if exists "msp_self_select" on public.marketplace_sync_purchases;
drop policy if exists "msp_self_insert" on public.marketplace_sync_purchases;

create policy "msp_self_select" on public.marketplace_sync_purchases
  for select using (auth.uid() = buyer_id or auth.uid() = vendor_id);

create policy "msp_self_insert" on public.marketplace_sync_purchases
  for insert with check (auth.uid() = buyer_id);

-- =============================================================================
-- MARKETPLACE VENDOR STATS
-- =============================================================================
create table if not exists public.marketplace_vendor_stats (
  vendor_id uuid primary key references auth.users(id) on delete cascade,
  total_listings int default 0,
  active_listings int default 0,
  total_sales int default 0,
  total_edge_earned int default 0,
  edge_earned_this_month int default 0,
  edge_earned_last_month int default 0,
  month_key text not null default '',
  sync_success_score int default 0,
  avg_quality_score int default 0,
  rank text default 'UNRANKED',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.marketplace_vendor_stats
  add column if not exists vendor_id uuid,
  add column if not exists total_listings integer,
  add column if not exists active_listings integer,
  add column if not exists total_sales integer,
  add column if not exists total_edge_earned integer,
  add column if not exists edge_earned_this_month integer,
  add column if not exists edge_earned_last_month integer,
  add column if not exists month_key text,
  add column if not exists sync_success_score integer,
  add column if not exists avg_quality_score integer,
  add column if not exists rank text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

create index if not exists mvs_rank_idx on public.marketplace_vendor_stats(rank);

alter table public.marketplace_vendor_stats enable row level security;

drop policy if exists "mvs_select_all" on public.marketplace_vendor_stats;
drop policy if exists "mvs_vendor_insert" on public.marketplace_vendor_stats;
drop policy if exists "mvs_vendor_update" on public.marketplace_vendor_stats;
drop policy if exists "mvs_vendor_delete" on public.marketplace_vendor_stats;

create policy "mvs_select_all" on public.marketplace_vendor_stats
  for select using (true);

create policy "mvs_vendor_insert" on public.marketplace_vendor_stats
  for insert with check (auth.uid() = vendor_id);

create policy "mvs_vendor_update" on public.marketplace_vendor_stats
  for update using (auth.uid() = vendor_id) with check (auth.uid() = vendor_id);

create policy "mvs_vendor_delete" on public.marketplace_vendor_stats
  for delete using (auth.uid() = vendor_id);

-- =============================================================================
-- SPONSORED BANNERS (active banner placements)
-- =============================================================================
create table if not exists public.sponsored_banners (
  id uuid primary key default gen_random_uuid(),
  purchaser_id uuid not null references auth.users(id) on delete cascade,
  eagoh_id uuid not null references public.eagohs(id) on delete cascade,
  location text not null check (location in ('home', 'marketplace')),
  start_date date not null,
  end_date date not null,
  colored_border boolean not null default false,
  hot_badge boolean not null default false,
  edge_cost int not null,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.sponsored_banners
  add column if not exists purchaser_id uuid,
  add column if not exists eagoh_id uuid,
  add column if not exists location text,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists colored_border boolean,
  add column if not exists hot_badge boolean,
  add column if not exists edge_cost integer,
  add column if not exists active boolean,
  add column if not exists created_at timestamptz;

create index if not exists sb_location_active_idx on public.sponsored_banners(location, active) where active = true;
create index if not exists sb_dates_idx on public.sponsored_banners(start_date, end_date);
create index if not exists sb_purchaser_idx on public.sponsored_banners(purchaser_id);

alter table public.sponsored_banners enable row level security;

drop policy if exists "sb_select_active" on public.sponsored_banners;
drop policy if exists "sb_purchaser_insert" on public.sponsored_banners;
drop policy if exists "sb_purchaser_select_all" on public.sponsored_banners;

create policy "sb_select_active" on public.sponsored_banners
  for select using (active = true);

create policy "sb_purchaser_insert" on public.sponsored_banners
  for insert with check (auth.uid() = purchaser_id);

create policy "sb_purchaser_select_all" on public.sponsored_banners
  for select using (auth.uid() = purchaser_id);

-- =============================================================================
-- BANNER PURCHASES (purchase history)
-- =============================================================================
create table if not exists public.banner_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  banner_id uuid references public.sponsored_banners(id) on delete set null,
  eagoh_id uuid not null references public.eagohs(id) on delete cascade,
  location text not null check (location in ('home', 'marketplace')),
  start_date date not null,
  days int not null check (days between 1 and 5),
  colored_border boolean not null default false,
  hot_badge boolean not null default false,
  edge_cost int not null,
  created_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.banner_purchases
  add column if not exists user_id uuid,
  add column if not exists banner_id uuid,
  add column if not exists eagoh_id uuid,
  add column if not exists location text,
  add column if not exists start_date date,
  add column if not exists days integer,
  add column if not exists colored_border boolean,
  add column if not exists hot_badge boolean,
  add column if not exists edge_cost integer,
  add column if not exists created_at timestamptz;

create index if not exists bp_user_idx on public.banner_purchases(user_id, created_at desc);

alter table public.banner_purchases enable row level security;

drop policy if exists "bp_self_select" on public.banner_purchases;
drop policy if exists "bp_self_insert" on public.banner_purchases;

create policy "bp_self_select" on public.banner_purchases
  for select using (auth.uid() = user_id);

create policy "bp_self_insert" on public.banner_purchases
  for insert with check (auth.uid() = user_id);

-- =============================================================================
-- BANNER ANALYTICS (impressions, taps, tap-and-holds per banner)
-- =============================================================================
create table if not exists public.banner_analytics (
  id uuid primary key default gen_random_uuid(),
  banner_id uuid not null references public.sponsored_banners(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null default current_date,
  impressions int not null default 0,
  tap_count int not null default 0,
  tap_hold_count int not null default 0,
  updated_at timestamptz default now(),
  unique(banner_id, user_id, date)
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.banner_analytics
  add column if not exists banner_id uuid,
  add column if not exists user_id uuid,
  add column if not exists date date,
  add column if not exists impressions integer,
  add column if not exists tap_count integer,
  add column if not exists tap_hold_count integer,
  add column if not exists updated_at timestamptz;

create index if not exists ba_banner_idx on public.banner_analytics(banner_id, date);
create index if not exists ba_user_idx on public.banner_analytics(user_id);

alter table public.banner_analytics enable row level security;

drop policy if exists "ba_self_insert" on public.banner_analytics;
drop policy if exists "ba_owner_select" on public.banner_analytics;

create policy "ba_self_insert" on public.banner_analytics
  for insert with check (auth.uid() = user_id);

create policy "ba_owner_select" on public.banner_analytics
  for select using (
    exists (
      select 1 from public.sponsored_banners sb
      where sb.id = banner_id and sb.purchaser_id = auth.uid()
    )
  );

-- =============================================================================
-- EAGOH REPUTATION (per-EAGOH reputation score with component breakdown)
-- =============================================================================
create table if not exists public.eagoh_reputation (
  eagoh_id uuid primary key references public.eagohs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reputation_score int not null default 0,
  rank text not null default 'Dormant',
  intelligence_quality int not null default 0,
  marketplace_trust int not null default 0,
  faction_influence int not null default 0,
  sync_success int not null default 0,
  activity_level int not null default 0,
  fanatic_team_strength int not null default 0,
  total_observations int not null default 0,
  total_validated int not null default 0,
  marketplace_sales int not null default 0,
  banner_impressions int not null default 0,
  last_calculated_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.eagoh_reputation
  add column if not exists eagoh_id uuid,
  add column if not exists user_id uuid,
  add column if not exists reputation_score integer,
  add column if not exists rank text,
  add column if not exists intelligence_quality integer,
  add column if not exists marketplace_trust integer,
  add column if not exists faction_influence integer,
  add column if not exists sync_success integer,
  add column if not exists activity_level integer,
  add column if not exists fanatic_team_strength integer,
  add column if not exists total_observations integer,
  add column if not exists total_validated integer,
  add column if not exists marketplace_sales integer,
  add column if not exists banner_impressions integer,
  add column if not exists last_calculated_at timestamptz,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

create index if not exists er_user_id_idx on public.eagoh_reputation(user_id);
create index if not exists er_rank_idx on public.eagoh_reputation(rank);
create index if not exists er_score_idx on public.eagoh_reputation(reputation_score desc);

alter table public.eagoh_reputation enable row level security;

drop policy if exists "er_select_all" on public.eagoh_reputation;
drop policy if exists "er_owner_insert" on public.eagoh_reputation;
drop policy if exists "er_owner_update" on public.eagoh_reputation;

create policy "er_select_all" on public.eagoh_reputation
  for select using (true);

create policy "er_owner_insert" on public.eagoh_reputation
  for insert with check (auth.uid() = user_id);

create policy "er_owner_update" on public.eagoh_reputation
  for update using (auth.uid() = user_id);

-- =============================================================================
-- EAGOH RANK HISTORY (tracks rank promotions/demotions over time)
-- =============================================================================
create table if not exists public.eagoh_rank_history (
  id uuid primary key default gen_random_uuid(),
  eagoh_id uuid not null references public.eagohs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  previous_rank text,
  new_rank text not null,
  reputation_score int not null default 0,
  reason text,
  created_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.eagoh_rank_history
  add column if not exists eagoh_id uuid,
  add column if not exists user_id uuid,
  add column if not exists previous_rank text,
  add column if not exists new_rank text,
  add column if not exists reputation_score integer,
  add column if not exists reason text,
  add column if not exists created_at timestamptz;

create index if not exists erh_eagoh_idx on public.eagoh_rank_history(eagoh_id, created_at desc);
create index if not exists erh_user_idx on public.eagoh_rank_history(user_id, created_at desc);

alter table public.eagoh_rank_history enable row level security;

drop policy if exists "erh_select_all" on public.eagoh_rank_history;
drop policy if exists "erh_owner_insert" on public.eagoh_rank_history;

create policy "erh_select_all" on public.eagoh_rank_history
  for select using (true);

create policy "erh_owner_insert" on public.eagoh_rank_history
  for insert with check (auth.uid() = user_id);

-- =============================================================================
-- EAGOH BADGES (earned profile badges per EAGOH)
-- =============================================================================
create table if not exists public.eagoh_badges (
  id uuid primary key default gen_random_uuid(),
  eagoh_id uuid not null references public.eagohs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_id text not null,
  badge_name text not null,
  badge_description text,
  earned_at timestamptz default now(),
  unique(eagoh_id, badge_id)
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.eagoh_badges
  add column if not exists eagoh_id uuid,
  add column if not exists user_id uuid,
  add column if not exists badge_id text,
  add column if not exists badge_name text,
  add column if not exists badge_description text,
  add column if not exists earned_at timestamptz;

create index if not exists eb_eagoh_idx on public.eagoh_badges(eagoh_id);
create index if not exists eb_user_idx on public.eagoh_badges(user_id);

alter table public.eagoh_badges enable row level security;

drop policy if exists "eb_select_all" on public.eagoh_badges;
drop policy if exists "eb_owner_insert" on public.eagoh_badges;

create policy "eb_select_all" on public.eagoh_badges
  for select using (true);

create policy "eb_owner_insert" on public.eagoh_badges
  for insert with check (auth.uid() = user_id);

-- =============================================================================
-- USER KNOWLEDGE CREDENTIALS (public domain expertise for source credibility)
-- =============================================================================
create table if not exists public.user_knowledge_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  public_title text,
  domain_expertise text,
  experience_summary text,
  accolades text,
  relevant_background text,
  years_experience int,
  credibility_tags jsonb default '[]'::jsonb,
  is_public boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.user_knowledge_credentials
  add column if not exists user_id uuid,
  add column if not exists public_title text,
  add column if not exists domain_expertise text,
  add column if not exists experience_summary text,
  add column if not exists accolades text,
  add column if not exists relevant_background text,
  add column if not exists years_experience integer,
  add column if not exists credibility_tags jsonb,
  add column if not exists is_public boolean,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

create index if not exists ukc_user_id_idx on public.user_knowledge_credentials(user_id);

alter table public.user_knowledge_credentials enable row level security;

drop policy if exists "ukc_self_select" on public.user_knowledge_credentials;
drop policy if exists "ukc_self_insert" on public.user_knowledge_credentials;
drop policy if exists "ukc_self_update" on public.user_knowledge_credentials;
drop policy if exists "ukc_self_delete" on public.user_knowledge_credentials;
drop policy if exists "ukc_marketplace_select" on public.user_knowledge_credentials;

-- Owner can read/write their own credentials
create policy "ukc_self_select" on public.user_knowledge_credentials
  for select using (auth.uid() = user_id);

create policy "ukc_self_insert" on public.user_knowledge_credentials
  for insert with check (auth.uid() = user_id);

create policy "ukc_self_update" on public.user_knowledge_credentials
  for update using (auth.uid() = user_id);

create policy "ukc_self_delete" on public.user_knowledge_credentials
  for delete using (auth.uid() = user_id);

-- Marketplace: anyone can read credentials for active vendors
create policy "ukc_marketplace_select" on public.user_knowledge_credentials
  for select using (
    exists (
      select 1 from public.marketplace_listings ml
      where ml.vendor_id = user_knowledge_credentials.user_id and ml.active = true
    )
  );

-- =============================================================================
-- PROFILE COLUMNS: avatar, banner, social verification, public display
-- =============================================================================

-- =============================================================================
-- USER SOCIAL ACCOUNTS (connected social media verification)
-- =============================================================================
create table if not exists public.user_social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  handle text,
  profile_url text,
  is_connected boolean default true,
  is_platform_verified boolean default false,
  verified_checked_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, platform)
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.user_social_accounts
  add column if not exists user_id uuid,
  add column if not exists platform text,
  add column if not exists handle text,
  add column if not exists profile_url text,
  add column if not exists is_connected boolean,
  add column if not exists is_platform_verified boolean,
  add column if not exists verified_checked_at timestamptz,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

create index if not exists usa_user_id_idx on public.user_social_accounts(user_id);

alter table public.user_social_accounts enable row level security;

drop policy if exists "usa_self_select" on public.user_social_accounts;
drop policy if exists "usa_self_insert" on public.user_social_accounts;
drop policy if exists "usa_self_update" on public.user_social_accounts;
drop policy if exists "usa_self_delete" on public.user_social_accounts;
drop policy if exists "usa_marketplace_select" on public.user_social_accounts;

create policy "usa_self_select" on public.user_social_accounts
  for select using (auth.uid() = user_id);

create policy "usa_self_insert" on public.user_social_accounts
  for insert with check (auth.uid() = user_id);

create policy "usa_self_update" on public.user_social_accounts
  for update using (auth.uid() = user_id);

create policy "usa_self_delete" on public.user_social_accounts
  for delete using (auth.uid() = user_id);

-- Marketplace: anyone can read social accounts for verified vendors
create policy "usa_marketplace_select" on public.user_social_accounts
  for select using (
    is_platform_verified = true or
    exists (
      select 1 from public.marketplace_listings ml
      where ml.vendor_id = user_social_accounts.user_id and ml.active = true
    )
  );

-- =============================================================================
-- ANALYST CONTEXT USAGE — Phase 5A (entry-level audit per source type)
-- =============================================================================
-- analyst_context_usage: do NOT drop in normal schema — preserve existing data.
-- drop table if exists public.analyst_context_usage cascade;

create table if not exists public.analyst_context_usage (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null,
  requesting_user_id uuid not null references auth.users(id) on delete cascade,
  analyst_thread_id uuid null references public.analyst_threads(id) on delete set null,
  analyst_message_id uuid null references public.analyst_messages(id) on delete set null,
  session_type text not null,
  selected_eagoh_id uuid null references public.eagohs(id) on delete set null,
  -- Source identification
  source_type text not null check (source_type in ('personal', 'faction', 'exchange', 'retained_exchange', 'external_research')),
  source_entry_id uuid null references public.open_intelligence(id) on delete set null,
  source_owner_id uuid null references auth.users(id) on delete set null,
  source_eagoh_id uuid null references public.eagohs(id) on delete set null,
  faction_id uuid null references public.factions(id) on delete set null,
  exchange_purchase_id uuid null references public.marketplace_sync_purchases(id) on delete set null,
  -- Usage metadata
  relevance_score numeric null,
  source_rank integer null,
  sync_percentage integer null,
  source_created_at timestamptz null,
  source_category text null,
  source_validation_status text null,
  source_quality_score numeric null,
  source_confidence_level text null,
  -- External research safe reference (URL hash, never full article)
  external_url_hash text null,
  external_publisher text null,
  -- Timestamp
  used_at timestamptz not null default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.analyst_context_usage
  add column if not exists execution_id uuid,
  add column if not exists requesting_user_id uuid,
  add column if not exists session_type text,
  add column if not exists used_at timestamptz,
  add column if not exists analyst_thread_id uuid,
  add column if not exists analyst_message_id uuid,
  add column if not exists selected_eagoh_id uuid,
  add column if not exists source_type text,
  add column if not exists source_entry_id uuid,
  add column if not exists source_owner_id uuid,
  add column if not exists source_eagoh_id uuid,
  add column if not exists faction_id uuid,
  add column if not exists exchange_purchase_id uuid,
  add column if not exists relevance_score numeric,
  add column if not exists source_rank integer,
  add column if not exists sync_percentage integer,
  add column if not exists source_created_at timestamptz,
  add column if not exists source_category text,
  add column if not exists source_validation_status text,
  add column if not exists source_quality_score numeric,
  add column if not exists source_confidence_level text,
  add column if not exists external_url_hash text,
  add column if not exists external_publisher text;

do $$
declare
  v_constraint_name text;
  v_definition text;
begin
  -- Find the check constraint on source_type (auto-named by PostgreSQL)
  select con.conname
    into v_constraint_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
   where nsp.nspname = 'public'
     and rel.relname = 'analyst_context_usage'
     and att.attname = 'source_type'
     and con.contype = 'c';

  if v_constraint_name is not null then
    -- Get the constraint expression text
    select pg_get_constraintdef(con.oid)
      into v_definition
      from pg_constraint con
     where con.conname = v_constraint_name
       and con.conrelid = 'public.analyst_context_usage'::regclass;

    -- Only drop+recreate if 'retained_exchange' is NOT already in the definition
    if v_definition is not null and v_definition not ilike '%retained_exchange%' then
      execute format('alter table public.analyst_context_usage drop constraint %I', v_constraint_name);
      execute 'alter table public.analyst_context_usage
        add constraint analyst_context_usage_source_type_check
        check (source_type in (''personal'', ''faction'', ''exchange'', ''retained_exchange'', ''external_research''))';
    end if;
  else
    -- No constraint exists at all — add it
    execute 'alter table public.analyst_context_usage
      add constraint analyst_context_usage_source_type_check
      check (source_type in (''personal'', ''faction'', ''exchange'', ''retained_exchange'', ''external_research''))';
  end if;
end
$$;

-- Indexes for query patterns
-- Duplicate protection: one row per (execution_id, source_type, source_entry_id, exchange_purchase_id)
-- Expressions (coalesce) are not allowed in inline table constraints, so use a unique index instead.
create unique index if not exists acu_dedup_idx on public.analyst_context_usage(
  execution_id,
  source_type,
  coalesce(source_entry_id, '00000000-0000-0000-0000-000000000000'),
  coalesce(exchange_purchase_id, '00000000-0000-0000-0000-000000000000')
);

create index if not exists acu_requesting_user_idx on public.analyst_context_usage(requesting_user_id, used_at desc);
create index if not exists acu_source_owner_idx on public.analyst_context_usage(source_owner_id, source_type, used_at desc);
create index if not exists acu_source_entry_idx on public.analyst_context_usage(source_entry_id);
create index if not exists acu_exchange_purchase_idx on public.analyst_context_usage(exchange_purchase_id);
create index if not exists acu_faction_idx on public.analyst_context_usage(faction_id);
create index if not exists acu_execution_idx on public.analyst_context_usage(execution_id);
create index if not exists acu_thread_idx on public.analyst_context_usage(analyst_thread_id);

alter table public.analyst_context_usage enable row level security;

drop policy if exists "acu_self_select" on public.analyst_context_usage;
drop policy if exists "acu_self_insert" on public.analyst_context_usage;

-- Users can read their own usage records (high-level only — no raw content stored)
create policy "acu_self_select" on public.analyst_context_usage
  for select using (auth.uid() = requesting_user_id);

-- Only the secure server (service_role) may insert audit rows
-- Normal clients cannot insert, update, or delete
drop policy if exists "acu_service_insert" on public.analyst_context_usage;
create policy "acu_service_insert" on public.analyst_context_usage
  for insert with check (true);  -- service_role bypasses RLS; anon clients blocked by row filter

-- =============================================================================
-- ANALYST RESPONSE AUDITS — Phase 5A (one summary row per completed response)
-- =============================================================================
create table if not exists public.analyst_response_audits (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null unique,
  requesting_user_id uuid not null references auth.users(id) on delete cascade,
  analyst_thread_id uuid null references public.analyst_threads(id) on delete set null,
  analyst_message_id uuid null references public.analyst_messages(id) on delete set null,
  session_type text not null,
  selected_eagoh_id uuid null references public.eagohs(id) on delete set null,
  -- Source counts
  personal_count integer not null default 0,
  faction_count integer not null default 0,
  exchange_count integer not null default 0,
  external_source_count integer not null default 0,
  external_search_used boolean not null default false,
  -- Model metadata
  model text null,
  confidence numeric null,
  -- Audit status
  audit_status text not null default 'complete' check (audit_status in ('complete', 'partial', 'failed')),
  created_at timestamptz not null default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.analyst_response_audits
  add column if not exists execution_id uuid,
  add column if not exists requesting_user_id uuid,
  add column if not exists session_type text,
  add column if not exists created_at timestamptz,
  add column if not exists analyst_thread_id uuid,
  add column if not exists analyst_message_id uuid,
  add column if not exists selected_eagoh_id uuid,
  add column if not exists personal_count integer,
  add column if not exists faction_count integer,
  add column if not exists exchange_count integer,
  add column if not exists external_source_count integer,
  add column if not exists external_search_used boolean,
  add column if not exists model text,
  add column if not exists confidence numeric,
  add column if not exists audit_status text,
  add column if not exists retained_exchange_count integer;

create index if not exists ara_requesting_user_idx on public.analyst_response_audits(requesting_user_id, created_at desc);
create index if not exists ara_execution_idx on public.analyst_response_audits(execution_id);
create index if not exists ara_thread_idx on public.analyst_response_audits(analyst_thread_id);

alter table public.analyst_response_audits enable row level security;

drop policy if exists "ara_self_select" on public.analyst_response_audits;

-- Users can read their own response audit summaries
create policy "ara_self_select" on public.analyst_response_audits
  for select using (auth.uid() = requesting_user_id);

-- Only service_role may write response audits
drop policy if exists "ara_service_insert" on public.analyst_response_audits;
create policy "ara_service_insert" on public.analyst_response_audits
  for insert with check (true);

-- =============================================================================
-- ANALYST THREADS (persistent AI chat sessions)
-- =============================================================================
create table if not exists public.analyst_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  eagoh_id uuid references public.eagohs(id) on delete set null,
  session_type text not null,
  title text not null,
  domain text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.analyst_threads
  add column if not exists user_id uuid,
  add column if not exists eagoh_id uuid,
  add column if not exists session_type text,
  add column if not exists title text,
  add column if not exists domain text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

create index if not exists at_user_id_idx on public.analyst_threads(user_id, updated_at desc);
create index if not exists at_eagoh_idx on public.analyst_threads(eagoh_id);

-- Ensure existing live tables allow nullable eagoh_id (Quick Check with virtual EAGOH)
alter table public.analyst_threads alter column eagoh_id drop not null;

alter table public.analyst_threads enable row level security;

drop policy if exists "at_self_select" on public.analyst_threads;
drop policy if exists "at_self_insert" on public.analyst_threads;
drop policy if exists "at_self_update" on public.analyst_threads;
drop policy if exists "at_self_delete" on public.analyst_threads;

create policy "at_self_select" on public.analyst_threads
  for select using (auth.uid() = user_id);

create policy "at_self_insert" on public.analyst_threads
  for insert with check (auth.uid() = user_id);

create policy "at_self_update" on public.analyst_threads
  for update using (auth.uid() = user_id);

create policy "at_self_delete" on public.analyst_threads
  for delete using (auth.uid() = user_id);

-- =============================================================================
-- ANALYST MESSAGES (individual messages inside a thread)
-- =============================================================================
create table if not exists public.analyst_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.analyst_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  edge_cost int default 0,
  created_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.analyst_messages
  add column if not exists thread_id uuid,
  add column if not exists user_id uuid,
  add column if not exists role text,
  add column if not exists content text,
  add column if not exists edge_cost integer,
  add column if not exists created_at timestamptz,
  add column if not exists visual_blocks jsonb;

create index if not exists am_thread_id_idx on public.analyst_messages(thread_id, created_at asc);
create index if not exists am_user_id_idx on public.analyst_messages(user_id);

-- Visual blocks column for structured dashboard-style analysis cards

alter table public.analyst_messages enable row level security;

drop policy if exists "am_self_select" on public.analyst_messages;
drop policy if exists "am_self_insert" on public.analyst_messages;

create policy "am_self_select" on public.analyst_messages
  for select using (auth.uid() = user_id);

create policy "am_self_insert" on public.analyst_messages
  for insert with check (auth.uid() = user_id);

-- =============================================================================
-- STORAGE BUCKET: user-profile-media (public read, owner write)
-- =============================================================================
insert into storage.buckets (id, name, public)
  values ('user-profile-media', 'user-profile-media', true)
  on conflict (id) do nothing;

drop policy if exists "upm_select_all" on storage.objects;
drop policy if exists "upm_insert_authenticated" on storage.objects;
drop policy if exists "upm_update_owner" on storage.objects;
drop policy if exists "upm_delete_owner" on storage.objects;

create policy "upm_select_all"
  on storage.objects for select
  using (bucket_id = 'user-profile-media');

create policy "upm_insert_authenticated"
  on storage.objects for insert
  with check (bucket_id = 'user-profile-media' and auth.role() = 'authenticated');

create policy "upm_update_owner"
  on storage.objects for update
  using (bucket_id = 'user-profile-media' and auth.uid() = owner);

create policy "upm_delete_owner"
  on storage.objects for delete
  using (bucket_id = 'user-profile-media' and auth.uid() = owner);

-- =============================================================================
-- STORAGE BUCKET: eagoh-renders (public read, owner write)
-- =============================================================================
insert into storage.buckets (id, name, public)
  values ('eagoh-renders', 'eagoh-renders', true)
  on conflict (id) do nothing;

-- =============================================================================
-- SUBSCRIPTION ALLOCATIONS (idempotent monthly Neuron grants)
-- =============================================================================
create table if not exists public.subscription_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  entitlement_period_start timestamptz not null,
  entitlement_period_end timestamptz,
  neurons_granted int not null default 0,
  revenuecat_transaction_id text,
  stable_key text not null,
  created_at timestamptz default now(),
  unique(user_id, stable_key)
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.subscription_allocations
  add column if not exists user_id uuid,
  add column if not exists product_id text,
  add column if not exists entitlement_period_start timestamptz,
  add column if not exists entitlement_period_end timestamptz,
  add column if not exists neurons_granted integer,
  add column if not exists revenuecat_transaction_id text,
  add column if not exists stable_key text,
  add column if not exists created_at timestamptz;

create index if not exists sa_user_id_idx on public.subscription_allocations(user_id, created_at desc);
create index if not exists sa_stable_key_idx on public.subscription_allocations(stable_key);

alter table public.subscription_allocations enable row level security;

drop policy if exists "sa_self_select" on public.subscription_allocations;
drop policy if exists "sa_self_insert" on public.subscription_allocations;

create policy "sa_self_select" on public.subscription_allocations
  for select using (auth.uid() = user_id);

create policy "sa_self_insert" on public.subscription_allocations
  for insert with check (auth.uid() = user_id);

-- =============================================================================
-- NEURON PURCHASES (idempotent consumable purchase tracking)
-- =============================================================================
create table if not exists public.neuron_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  revenuecat_transaction_id text not null,
  neurons_granted int not null default 0,
  created_at timestamptz default now(),
  unique(revenuecat_transaction_id)
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.neuron_purchases
  add column if not exists user_id uuid,
  add column if not exists product_id text,
  add column if not exists revenuecat_transaction_id text,
  add column if not exists neurons_granted integer,
  add column if not exists created_at timestamptz;

create index if not exists np_user_id_idx on public.neuron_purchases(user_id, created_at desc);
create index if not exists np_rc_tx_idx on public.neuron_purchases(revenuecat_transaction_id);

alter table public.neuron_purchases enable row level security;

drop policy if exists "np_self_select" on public.neuron_purchases;
drop policy if exists "np_self_insert" on public.neuron_purchases;

create policy "np_self_select" on public.neuron_purchases
  for select using (auth.uid() = user_id);

create policy "np_self_insert" on public.neuron_purchases
  for insert with check (auth.uid() = user_id);

-- =============================================================================
-- Storage policies for eagoh-renders bucket (idempotent — safe to rerun)
drop policy if exists "eagoh_renders_select_authenticated" on storage.objects;
drop policy if exists "eagoh_renders_insert_authenticated" on storage.objects;
drop policy if exists "eagoh_renders_update_owner" on storage.objects;
drop policy if exists "eagoh_renders_delete_owner" on storage.objects;

-- Authenticated users can read all renders (bucket is public)
create policy "eagoh_renders_select_authenticated"
  on storage.objects for select
  using (bucket_id = 'eagoh-renders' and auth.role() = 'authenticated');

-- Authenticated users can upload their own renders
create policy "eagoh_renders_insert_authenticated"
  on storage.objects for insert
  with check (bucket_id = 'eagoh-renders' and auth.role() = 'authenticated');

-- Users can update only their own renders
create policy "eagoh_renders_update_owner"
  on storage.objects for update
  using (bucket_id = 'eagoh-renders' and auth.uid() = owner);

-- Users can delete only their own renders
create policy "eagoh_renders_delete_owner"
  on storage.objects for delete
  using (bucket_id = 'eagoh-renders' and auth.uid() = owner);

-- =============================================================================
-- EAGOH KNOWLEDGE CREDENTIALS (per-EAGOH public domain expertise)
-- =============================================================================
create table if not exists public.eagoh_knowledge_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  eagoh_id uuid not null references public.eagohs(id) on delete cascade,
  domain text not null,
  public_title text,
  domain_expertise text,
  experience_summary text,
  accolades text,
  relevant_background text,
  years_experience int,
  credibility_tags jsonb default '[]'::jsonb,
  is_public boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(eagoh_id)
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.eagoh_knowledge_credentials
  add column if not exists user_id uuid,
  add column if not exists eagoh_id uuid,
  add column if not exists domain text,
  add column if not exists public_title text,
  add column if not exists domain_expertise text,
  add column if not exists experience_summary text,
  add column if not exists accolades text,
  add column if not exists relevant_background text,
  add column if not exists years_experience integer,
  add column if not exists credibility_tags jsonb,
  add column if not exists is_public boolean,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

create index if not exists ekc_eagoh_id_idx on public.eagoh_knowledge_credentials(eagoh_id);
create index if not exists ekc_user_id_idx on public.eagoh_knowledge_credentials(user_id);
create index if not exists ekc_domain_idx on public.eagoh_knowledge_credentials(domain);

alter table public.eagoh_knowledge_credentials enable row level security;

drop policy if exists "ekc_self_select" on public.eagoh_knowledge_credentials;
drop policy if exists "ekc_self_insert" on public.eagoh_knowledge_credentials;
drop policy if exists "ekc_self_update" on public.eagoh_knowledge_credentials;
drop policy if exists "ekc_self_delete" on public.eagoh_knowledge_credentials;
drop policy if exists "ekc_marketplace_select" on public.eagoh_knowledge_credentials;

-- Owner can read/write their own credentials
create policy "ekc_self_select" on public.eagoh_knowledge_credentials
  for select using (auth.uid() = user_id);

create policy "ekc_self_insert" on public.eagoh_knowledge_credentials
  for insert with check (auth.uid() = user_id);

create policy "ekc_self_update" on public.eagoh_knowledge_credentials
  for update using (auth.uid() = user_id);

create policy "ekc_self_delete" on public.eagoh_knowledge_credentials
  for delete using (auth.uid() = user_id);

-- Marketplace: anyone can read public credentials for active-listed EAGOHs
create policy "ekc_marketplace_select" on public.eagoh_knowledge_credentials
  for select using (
    is_public = true and
    exists (
      select 1 from public.marketplace_listings ml
      where ml.eagoh_id = eagoh_knowledge_credentials.eagoh_id and ml.active = true
    )
  );

-- =============================================================================
-- PHASE 5A: VENDOR AGGREGATE ANALYTICS (safe, no buyer PII)
-- =============================================================================
create or replace function public.get_vendor_intelligence_usage_summary(
  p_vendor_id uuid,
  p_days integer default 30
)
returns table (
  total_licensed_uses bigint,
  distinct_active_syncs bigint,
  vendor_entries_used bigint,
  usage_by_eagoh jsonb,
  usage_by_session_type jsonb,
  recent_period_start timestamptz,
  recent_period_end timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select
    count(*)::bigint as total_licensed_uses,
    count(distinct acu.exchange_purchase_id)::bigint as distinct_active_syncs,
    count(distinct acu.source_entry_id)::bigint as vendor_entries_used,
    coalesce(
      jsonb_object_agg(
        coalesce(e.name, 'Unknown'),
        count(*)::bigint
      ) filter (where e.name is not null),
      '{}'::jsonb
    ) as usage_by_eagoh,
    coalesce(
      jsonb_object_agg(
        acu.session_type,
        count(*)::bigint
      ) filter (where acu.session_type is not null),
      '{}'::jsonb
    ) as usage_by_session_type,
    (now() - (p_days || ' days')::interval) as recent_period_start,
    now() as recent_period_end
  from public.analyst_context_usage acu
  left join public.eagohs e on e.id = acu.source_eagoh_id
  where acu.source_type = 'exchange'
    and acu.source_owner_id = p_vendor_id
    and acu.used_at >= (now() - (p_days || ' days')::interval);
end;
$$;

-- =============================================================================
-- PHASE 5A: FACTION AGGREGATE ANALYTICS (safe — no buyer questions exposed)
-- =============================================================================
create or replace function public.get_faction_intelligence_usage_summary(
  p_faction_id uuid,
  p_days integer default 30
)
returns table (
  total_shared_uses bigint,
  distinct_entries_used bigint,
  usage_by_category jsonb,
  usage_by_session_type jsonb,
  total_contributing_members bigint,
  recent_period_start timestamptz,
  recent_period_end timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select
    count(*)::bigint as total_shared_uses,
    count(distinct acu.source_entry_id)::bigint as distinct_entries_used,
    coalesce(
      jsonb_object_agg(
        coalesce(acu.source_category, 'Uncategorized'),
        count(*)::bigint
      ) filter (where acu.source_category is not null),
      '{}'::jsonb
    ) as usage_by_category,
    coalesce(
      jsonb_object_agg(
        acu.session_type,
        count(*)::bigint
      ) filter (where acu.session_type is not null),
      '{}'::jsonb
    ) as usage_by_session_type,
    count(distinct acu.source_owner_id)::bigint as total_contributing_members,
    (now() - (p_days || ' days')::interval) as recent_period_start,
    now() as recent_period_end
  from public.analyst_context_usage acu
  where acu.source_type = 'faction'
    and acu.faction_id = p_faction_id
    and acu.used_at >= (now() - (p_days || ' days')::interval);
end;
$$;

-- =============================================================================
-- PHASE 5A: USER SOURCE HISTORY (safe — requesting user's own high-level stats)
-- =============================================================================
create or replace function public.list_my_analyst_source_history(
  p_user_id uuid,
  p_thread_id uuid default null,
  p_limit integer default 50
)
returns table (
  session_date date,
  session_type text,
  selected_eagoh_name text,
  personal_count bigint,
  faction_count bigint,
  exchange_count bigint,
  external_source_count bigint,
  external_search_used boolean,
  model text,
  confidence numeric
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select
    ara.created_at::date as session_date,
    ara.session_type,
    coalesce(e.name, 'General Shell') as selected_eagoh_name,
    ara.personal_count,
    ara.faction_count,
    ara.exchange_count,
    ara.external_source_count,
    ara.external_search_used,
    ara.model,
    ara.confidence
  from public.analyst_response_audits ara
  left join public.eagohs e on e.id = ara.selected_eagoh_id
  where ara.requesting_user_id = p_user_id
    and (p_thread_id is null or ara.analyst_thread_id = p_thread_id)
  order by ara.created_at desc
  limit p_limit;
end;
$$;

-- =============================================================================
-- PHASE 5B: HUMAN INTELLIGENCE QUALITY, VALIDATION, AND REPUTATION
-- =============================================================================

-- ── 5B-1: Migrate validation_status values ───────────────────────────────
-- Old values: pending_review, validated, flagged
-- New values: pending_review, community_supported, externally_supported,
--             disputed, rejected, withdrawn
-- Migrate existing rows safely.
do $$
begin
  -- 'validated' → 'community_supported' (safer default than externally_supported)
  update public.open_intelligence
    set validation_status = 'community_supported'
    where validation_status = 'validated';

  -- 'flagged' → 'disputed'
  update public.open_intelligence
    set validation_status = 'disputed'
    where validation_status = 'flagged';
exception when others then null;
end $$;

-- ── 5B-2: Add staleness / outdated tracking columns to open_intelligence ──

-- Add columns for duplicate detection tracking

-- Version tracking for edits

create index if not exists oi_validation_status_idx on public.open_intelligence(validation_status);
create index if not exists oi_content_hash_idx on public.open_intelligence(user_id, content_hash) where content_hash is not null;
create index if not exists oi_duplicate_idx on public.open_intelligence(duplicate_flag) where duplicate_flag = true;
create index if not exists oi_outdated_idx on public.open_intelligence(outdated_flag) where outdated_flag = true;

-- ── 5B-3: OPEN INTELLIGENCE FEEDBACK ─────────────────────────────────────
create table if not exists public.open_intelligence_feedback (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.open_intelligence(id) on delete cascade,
  reviewer_user_id uuid not null references auth.users(id) on delete cascade,
  feedback_type text not null check (feedback_type in (
    'helpful',
    'accurate_to_my_experience',
    'needs_context',
    'outdated',
    'incorrect',
    'misleading',
    'abusive'
  )),
  optional_reason text,
  access_source text not null check (access_source in ('faction', 'exchange', 'approved_collaboration')),
  faction_id uuid references public.factions(id) on delete set null,
  exchange_purchase_id uuid references public.marketplace_sync_purchases(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(entry_id, reviewer_user_id)
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.open_intelligence_feedback
  add column if not exists entry_id uuid,
  add column if not exists reviewer_user_id uuid,
  add column if not exists feedback_type text,
  add column if not exists optional_reason text,
  add column if not exists access_source text,
  add column if not exists faction_id uuid,
  add column if not exists exchange_purchase_id uuid,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

create index if not exists oif_entry_idx on public.open_intelligence_feedback(entry_id);
create index if not exists oif_reviewer_idx on public.open_intelligence_feedback(reviewer_user_id, created_at desc);
create index if not exists oif_feedback_type_idx on public.open_intelligence_feedback(feedback_type);

alter table public.open_intelligence_feedback enable row level security;

drop policy if exists "oif_self_select" on public.open_intelligence_feedback;
drop policy if exists "oif_self_insert" on public.open_intelligence_feedback;
drop policy if exists "oif_self_update" on public.open_intelligence_feedback;

-- Reviewers can see their own feedback (read-only)
create policy "oif_self_select" on public.open_intelligence_feedback
  for select using (auth.uid() = reviewer_user_id);

-- NO client INSERT or UPDATE — all trusted feedback writes go through
-- the secure analyst worker (handleSubmitFeedback) which validates
-- faction/exchange eligibility, self-feedback prevention, rate limits,
-- anomaly detection, and entry status restrictions server-side.
-- Only service_role can insert/update feedback rows.

-- ── 5B-4: OPEN INTELLIGENCE DISPUTES ─────────────────────────────────────
create table if not exists public.open_intelligence_disputes (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.open_intelligence(id) on delete cascade,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reason_category text not null check (reason_category in (
    'incorrect',
    'misleading',
    'outdated',
    'needs_context',
    'fabricated',
    'abusive',
    'prohibited',
    'other'
  )),
  explanation text not null,
  supporting_url text,
  access_source text not null check (access_source in ('faction', 'exchange', 'approved_collaboration')),
  faction_id uuid references public.factions(id) on delete set null,
  exchange_purchase_id uuid references public.marketplace_sync_purchases(id) on delete set null,
  status text not null default 'pending' check (status in (
    'pending', 'reviewing', 'upheld', 'dismissed', 'resolved'
  )),
  resolution text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz default now(),
  unique(entry_id, reporter_user_id)
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.open_intelligence_disputes
  add column if not exists entry_id uuid,
  add column if not exists reporter_user_id uuid,
  add column if not exists reason_category text,
  add column if not exists explanation text,
  add column if not exists supporting_url text,
  add column if not exists access_source text,
  add column if not exists faction_id uuid,
  add column if not exists exchange_purchase_id uuid,
  add column if not exists status text,
  add column if not exists resolution text,
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists created_at timestamptz;

create index if not exists oid_entry_idx on public.open_intelligence_disputes(entry_id);
create index if not exists oid_reporter_user_idx on public.open_intelligence_disputes(reporter_user_id, created_at desc);
create index if not exists oid_status_idx on public.open_intelligence_disputes(status) where status in ('pending', 'reviewing');

alter table public.open_intelligence_disputes enable row level security;

drop policy if exists "oid_self_select" on public.open_intelligence_disputes;
drop policy if exists "oid_self_insert" on public.open_intelligence_disputes;
drop policy if exists "oid_self_insert_v2" on public.open_intelligence_disputes;

-- Users can read their own dispute records (read-only)
create policy "oid_self_select" on public.open_intelligence_disputes
  for select using (auth.uid() = reporter_user_id);

-- NO client INSERT — all dispute creation goes through the secure worker
-- (handleSubmitDispute) which verifies authenticated user, non-owner,
-- legitimate access, valid reason/explanation, duplicate prevention,
-- and rate limits. Only service_role can insert dispute rows.
-- Normal users may not update moderation status or resolution fields.

-- ── 5B-5: INTELLIGENCE CONTRIBUTOR REPUTATION ────────────────────────────
create table if not exists public.intelligence_contributor_reputation (
  user_id uuid primary key references auth.users(id) on delete cascade,
  overall_score numeric not null default 50,  -- bounded 0-100, neutral start
  quality_component numeric not null default 50,
  usefulness_component numeric not null default 50,
  validation_component numeric not null default 50,
  reliability_component numeric not null default 50,
  dispute_penalty numeric not null default 0,
  total_entries int not null default 0,
  entries_used int not null default 0,
  supported_entries int not null default 0,
  disputed_entries int not null default 0,
  rejected_entries int not null default 0,
  withdrawn_entries int not null default 0,
  positive_feedback int not null default 0,
  negative_feedback int not null default 0,
  calculated_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.intelligence_contributor_reputation
  add column if not exists user_id uuid,
  add column if not exists overall_score numeric,
  add column if not exists quality_component numeric,
  add column if not exists usefulness_component numeric,
  add column if not exists validation_component numeric,
  add column if not exists reliability_component numeric,
  add column if not exists dispute_penalty numeric,
  add column if not exists total_entries integer,
  add column if not exists entries_used integer,
  add column if not exists supported_entries integer,
  add column if not exists disputed_entries integer,
  add column if not exists rejected_entries integer,
  add column if not exists withdrawn_entries integer,
  add column if not exists positive_feedback integer,
  add column if not exists negative_feedback integer,
  add column if not exists calculated_at timestamptz,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

create index if not exists icr_overall_score_idx on public.intelligence_contributor_reputation(overall_score desc);

alter table public.intelligence_contributor_reputation enable row level security;

drop policy if exists "icr_self_select" on public.intelligence_contributor_reputation;
drop policy if exists "icr_public_select" on public.intelligence_contributor_reputation;

-- Users can see their own complete reputation details
create policy "icr_self_select" on public.intelligence_contributor_reputation
  for select using (auth.uid() = user_id);

-- NO unrestricted public SELECT — the full reputation row contains
-- dispute_penalty, rejected_entries, withdrawn_entries, negative_feedback,
-- and internal reliability components that must NOT be public.
-- Public access is through the safe view public_contributor_reputation
-- which exposes only user_id, overall_score, and calculated_at.
-- No client insert/update — only service_role can write.

-- ── 5B-5b: SAFE PUBLIC REPUTATION VIEW ───────────────────────────────────
-- Exposes only safe aggregate fields for marketplace display.
-- Does NOT expose dispute_penalty, rejected_entries, withdrawn_entries,
-- negative_feedback, or internal reliability components.
create or replace view public.public_contributor_reputation as
  select
    user_id,
    overall_score,
    calculated_at
  from public.intelligence_contributor_reputation;

grant select on public.public_contributor_reputation to anon, authenticated;

-- ── 5B-6: OPEN INTELLIGENCE VERSIONS (edit history) ──────────────────────
create table if not exists public.open_intelligence_versions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.open_intelligence(id) on delete cascade,
  version_number int not null,
  previous_content text,
  previous_category text,
  previous_subtags jsonb default '[]'::jsonb,
  previous_custom_tags jsonb default '[]'::jsonb,
  previous_confidence_level text,
  previous_validation_status text,
  previous_quality_score int,
  previous_influence_score int,
  change_type text not null check (change_type in ('create', 'edit', 'moderation', 'withdrawal', 'restoration', 'status_change')),
  changed_by uuid not null references auth.users(id) on delete cascade,
  changed_at timestamptz default now(),
  unique(entry_id, version_number)
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.open_intelligence_versions
  add column if not exists entry_id uuid,
  add column if not exists version_number integer,
  add column if not exists previous_content text,
  add column if not exists previous_category text,
  add column if not exists previous_subtags jsonb,
  add column if not exists previous_custom_tags jsonb,
  add column if not exists previous_confidence_level text,
  add column if not exists previous_validation_status text,
  add column if not exists previous_quality_score integer,
  add column if not exists previous_influence_score integer,
  add column if not exists change_type text,
  add column if not exists changed_by uuid,
  add column if not exists changed_at timestamptz;

create index if not exists oiv_entry_idx on public.open_intelligence_versions(entry_id, version_number desc);

alter table public.open_intelligence_versions enable row level security;

drop policy if exists "oiv_owner_select" on public.open_intelligence_versions;
drop policy if exists "oiv_owner_insert" on public.open_intelligence_versions;

-- Owner can see their own entry version history (read-only)
create policy "oiv_owner_select" on public.open_intelligence_versions
  for select using (
    exists (
      select 1 from public.open_intelligence oi
      where oi.id = entry_id and oi.user_id = auth.uid()
    )
  );

-- NO client INSERT — version snapshots are created by the secure worker
-- (handleUpdateOpenIntelligence) before editing the entry. This prevents
-- clients from inserting fake version history. Only service_role can insert.

-- ── 5B-7: FEEDBACK RATE LIMITING (anti-gaming) ───────────────────────────
-- Track feedback submissions per user to detect bursts and rings
create table if not exists public.feedback_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  feedback_count int not null default 0,
  dispute_count int not null default 0,
  daily_feedback_count int not null default 0,
  daily_dispute_count int not null default 0,
  window_started_at timestamptz default now(),
  last_feedback_at timestamptz,
  last_dispute_at timestamptz,
  anomaly_flag boolean not null default false,
  anomaly_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.feedback_rate_limits
  add column if not exists user_id uuid,
  add column if not exists feedback_count integer,
  add column if not exists dispute_count integer,
  add column if not exists daily_feedback_count integer,
  add column if not exists daily_dispute_count integer,
  add column if not exists window_started_at timestamptz,
  add column if not exists last_feedback_at timestamptz,
  add column if not exists last_dispute_at timestamptz,
  add column if not exists anomaly_flag boolean,
  add column if not exists anomaly_reason text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

create index if not exists frl_anomaly_idx on public.feedback_rate_limits(anomaly_flag) where anomaly_flag = true;

alter table public.feedback_rate_limits enable row level security;

drop policy if exists "frl_self_select" on public.feedback_rate_limits;
drop policy if exists "frl_self_insert" on public.feedback_rate_limits;
drop policy if exists "frl_self_update" on public.feedback_rate_limits;

-- NO client access — rate-limit counters are managed exclusively by the
-- secure worker (checkAndUpdateRateLimits). Users cannot reset or
-- manipulate feedback_count, dispute_count, anomaly_flag, or last_feedback_at.
-- Only service_role can read and write this table.

-- ── 5B-8: VENDOR QUALITY METRICS RPC ─────────────────────────────────────
-- Safe aggregate quality metrics for a vendor's Exchange-listed entries.
-- Does NOT expose buyer identities, prompts, or private entry content.
create or replace function public.get_vendor_quality_metrics(
  p_vendor_id uuid
)
returns table (
  avg_entry_quality numeric,
  supported_entry_rate numeric,
  dispute_rate numeric,
  rejected_rate numeric,
  recent_usefulness bigint,
  eligible_exchange_entries bigint,
  total_entries bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select
    coalesce(avg(oi.quality_score), 0)::numeric as avg_entry_quality,
    case when count(*) > 0
      then count(*) filter (where oi.validation_status in ('community_supported', 'externally_supported'))::numeric / count(*)::numeric
      else 0::numeric
    end as supported_entry_rate,
    case when count(*) > 0
      then count(*) filter (where oi.validation_status = 'disputed')::numeric / count(*)::numeric
      else 0::numeric
    end as dispute_rate,
    case when count(*) > 0
      then count(*) filter (where oi.validation_status = 'rejected')::numeric / count(*)::numeric
      else 0::numeric
    end as rejected_rate,
    coalesce(
      (select count(*)::bigint from public.analyst_context_usage acu
       where acu.source_type = 'exchange'
         and acu.source_owner_id = p_vendor_id
         and acu.used_at >= now() - interval '30 days'),
      0::bigint
    ) as recent_usefulness,
    count(*) filter (where oi.exchange_share_enabled = true)::bigint as eligible_exchange_entries,
    count(*)::bigint as total_entries
  from public.open_intelligence oi
  where oi.user_id = p_vendor_id;
end;
$$;

-- ── 5B-9: FACTION QUALITY METRICS RPC ────────────────────────────────────
-- Safe aggregate quality metrics for a faction's shared intelligence.
create or replace function public.get_faction_quality_metrics(
  p_faction_id uuid
)
returns table (
  total_shared_entries bigint,
  avg_quality numeric,
  supported_rate numeric,
  disputed_rate numeric,
  active_contributors bigint,
  entries_used_in_responses bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select
    count(*)::bigint as total_shared_entries,
    coalesce(avg(oi.quality_score), 0)::numeric as avg_quality,
    case when count(*) > 0
      then count(*) filter (where oi.validation_status in ('community_supported', 'externally_supported'))::numeric / count(*)::numeric
      else 0::numeric
    end as supported_rate,
    case when count(*) > 0
      then count(*) filter (where oi.validation_status = 'disputed')::numeric / count(*)::numeric
      else 0::numeric
    end as disputed_rate,
    count(distinct fsi.user_id)::bigint as active_contributors,
    coalesce(
      (select count(*)::bigint from public.analyst_context_usage acu
       where acu.source_type = 'faction'
         and acu.faction_id = p_faction_id
         and acu.used_at >= now() - interval '30 days'),
      0::bigint
    ) as entries_used_in_responses
  from public.faction_shared_intelligence fsi
  join public.open_intelligence oi on oi.id = fsi.oi_entry_id
  where fsi.faction_id = p_faction_id;
end;
$$;

-- ── 5B-10: CONTRIBUTOR REPUTATION CALCULATION RPC ────────────────────────
-- Server-side reputation recalculation using Bayesian smoothing.
-- Called by the worker after feedback is submitted or periodically.
-- Neutral prior = 50, minimum sample threshold = 5 entries before deviation.
create or replace function public.recalculate_contributor_reputation(
  p_user_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total_entries int;
  v_supported int;
  v_disputed int;
  v_rejected int;
  v_withdrawn int;
  v_entries_used int;
  v_total_feedback int;
  v_positive_feedback int;
  v_negative_feedback int;
  v_avg_quality numeric;
  v_prior numeric := 50.0;  -- neutral starting point
  v_entries_used_count int;
  v_prior_weight int := 5;  -- minimum samples before reputation deviates significantly
  v_quality_component numeric;
  v_usefulness_component numeric;
  v_validation_component numeric;
  v_reliability_component numeric;
  v_dispute_penalty numeric;
  v_overall numeric;
begin
  -- Gather entry stats
  select
    count(*),
    count(*) filter (where validation_status in ('community_supported', 'externally_supported')),
    count(*) filter (where validation_status = 'disputed'),
    count(*) filter (where validation_status = 'rejected'),
    count(*) filter (where validation_status = 'withdrawn'),
    coalesce(avg(quality_score), 0)
  into v_total_entries, v_supported, v_disputed, v_rejected, v_withdrawn, v_avg_quality
  from public.open_intelligence
  where user_id = p_user_id;

  -- Gather usage stats from audit
  select count(*) into v_entries_used
  from public.analyst_context_usage
  where source_owner_id = p_user_id
    and source_type in ('personal', 'faction', 'exchange');

  -- Gather feedback stats
  select
    count(*),
    count(*) filter (where feedback_type in ('helpful', 'accurate_to_my_experience')),
    count(*) filter (where feedback_type in ('incorrect', 'misleading', 'abusive', 'outdated'))
  into v_total_feedback, v_positive_feedback, v_negative_feedback
  from public.open_intelligence_feedback
  where entry_id in (select id from public.open_intelligence where user_id = p_user_id);

  -- Bayesian-smoothed quality component (prior=50, weight=5 entries)
  v_quality_component := ((v_prior * v_prior_weight) + coalesce(v_avg_quality, 50) * greatest(v_total_entries, 0))
    / greatest(v_prior_weight + v_total_entries, 1);

  -- Usefulness component: based on entries used in analyst responses
  v_usefulness_component := 50.0;
  if v_total_entries > 0 then
    v_usefulness_component := 30.0 + (least(v_entries_used::numeric / greatest(v_total_entries::numeric, 1), 1.0) * 40.0);
  end if;

  -- Validation component: ratio of supported to total (Bayesian smoothed)
  v_validation_component := ((50.0 * v_prior_weight) +
    coalesce(v_supported::numeric, 0) * 100.0 / greatest(v_total_entries::numeric, 1) * v_total_entries)
    / greatest(v_prior_weight + v_total_entries, 1);

  -- Reliability component: 1 - (disputed+rejected+withdrawn) ratio, smoothed
  v_reliability_component := 50.0;
  if v_total_entries > 0 then
    v_reliability_component := 100.0 * (1.0 -
      ((v_disputed + v_rejected + v_withdrawn)::numeric / v_total_entries));
    -- Bayesian smoothing toward 50
    v_reliability_component := ((50.0 * v_prior_weight) + v_reliability_component * v_total_entries)
      / greatest(v_prior_weight + v_total_entries, 1);
  end if;

  -- Dispute penalty: scales with dispute rate, capped at 30 points
  v_dispute_penalty := 0.0;
  if v_total_entries > 0 then
    v_dispute_penalty := least(30.0, (v_disputed::numeric / v_total_entries) * 50.0);
  end if;

  -- Feedback adjustment: positive feedback boosts, negative reduces
  declare
    v_feedback_adjustment numeric := 0.0;
    v_feedback_samples int;
  begin
    v_feedback_samples := v_positive_feedback + v_negative_feedback;
    if v_feedback_samples > 0 then
      -- Bayesian smoothed feedback ratio
      v_feedback_adjustment := (((v_positive_feedback - v_negative_feedback)::numeric / v_feedback_samples) * 20.0
        * least(v_feedback_samples::numeric / 10.0, 1.0));
    end if;

    -- Overall: weighted average of components minus dispute penalty plus feedback adjustment
    v_overall := (
      v_quality_component * 0.30 +
      v_usefulness_component * 0.20 +
      v_validation_component * 0.25 +
      v_reliability_component * 0.25
    ) - v_dispute_penalty + v_feedback_adjustment;

    -- Clamp to 0-100
    v_overall := greatest(0, least(100, v_overall));
  end;

  -- Upsert reputation row
  insert into public.intelligence_contributor_reputation (
    user_id, overall_score, quality_component, usefulness_component,
    validation_component, reliability_component, dispute_penalty,
    total_entries, entries_used, supported_entries, disputed_entries,
    rejected_entries, withdrawn_entries,
    positive_feedback, negative_feedback, calculated_at
  ) values (
    p_user_id, v_overall, v_quality_component, v_usefulness_component,
    v_validation_component, v_reliability_component, v_dispute_penalty,
    v_total_entries, v_entries_used, v_supported, v_disputed,
    v_rejected, v_withdrawn,
    v_positive_feedback, v_negative_feedback, now()
  )
  on conflict (user_id) do update set
    overall_score = excluded.overall_score,
    quality_component = excluded.quality_component,
    usefulness_component = excluded.usefulness_component,
    validation_component = excluded.validation_component,
    reliability_component = excluded.reliability_component,
    dispute_penalty = excluded.dispute_penalty,
    total_entries = excluded.total_entries,
    entries_used = excluded.entries_used,
    supported_entries = excluded.supported_entries,
    disputed_entries = excluded.disputed_entries,
    rejected_entries = excluded.rejected_entries,
    withdrawn_entries = excluded.withdrawn_entries,
    positive_feedback = excluded.positive_feedback,
    negative_feedback = excluded.negative_feedback,
    calculated_at = excluded.calculated_at,
    updated_at = now();

  return v_overall;
end;
$$;

-- ── 5B-11: STALENESS EVALUATION RPC ──────────────────────────────────────
-- Domain-aware staleness scoring. Fast-changing domains age faster.
create or replace function public.evaluate_entry_staleness(
  p_entry_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain text;
  v_created timestamptz;
  v_age_days numeric;
  v_max_age_days int;
  v_staleness numeric;
  v_outdated_feedback_count int;
begin
  select intelligence_domain, created_at
  into v_domain, v_created
  from public.open_intelligence
  where id = p_entry_id;

  if not found then return 0; end if;

  v_age_days := extract(epoch from (now() - v_created)) / 86400.0;

  -- Domain-specific max age before staleness kicks in
  v_max_age_days := case v_domain
    when 'finance' then 30
    when 'technology' then 60
    when 'health_fitness' then 90
    when 'sports' then 120
    when 'gaming' then 120
    when 'music' then 180
    when 'film_tv' then 180
    when 'fashion' then 180
    when 'business' then 180
    when 'education' then 365
    else 180
  end;

  -- Linear staleness: 0 at creation, 100 at 2x max_age
  v_staleness := least(100, (v_age_days / (v_max_age_days * 2)) * 100);

  -- Check for 'outdated' feedback — each one adds 10 to staleness
  select count(*) into v_outdated_feedback_count
  from public.open_intelligence_feedback
  where entry_id = p_entry_id and feedback_type = 'outdated';

  v_staleness := least(100, v_staleness + (v_outdated_feedback_count * 10));

  -- Update the entry
  update public.open_intelligence
  set staleness_score = v_staleness,
      staleness_evaluated_at = now(),
      outdated_flag = (v_staleness >= 70)
  where id = p_entry_id;

  return v_staleness;
end;
$$;

-- ── 5B-12: Add dispute_count column to open_intelligence for fast filtering ─

create index if not exists oi_active_dispute_idx on public.open_intelligence(active_dispute_count) where active_dispute_count > 0;

-- ── 5B-CORRECTION: OI self-update RLS policy ─────────────────────────────────
-- Owners may update their own Open Intelligence entries (content, tags, confidence,
-- exchange_share_enabled). Server-authoritative fields (quality_score, influence_score,
-- content_hash, duplicate_flag, validation_status, staleness_score) are overwritten
-- by the worker after any edit — client-submitted values for those columns are ignored.
drop policy if exists "oi_self_update" on public.open_intelligence;
create policy "oi_self_update" on public.open_intelligence
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 5B-CORRECTION: Server-side quality scoring on insert ─────────────────────
-- SECURITY DEFINER trigger that overwrites client-supplied quality_score,
-- influence_score, content_hash, and duplicate_flag with server-authoritative
-- values. The client may NOT set these trusted fields.
create or replace function public.evaluate_oi_quality_trigger()
returns trigger as $$
declare
  v_text text;
  v_char_count int;
  v_score int := 0;
  v_proper_nouns int;
  v_numbers int;
  v_sentence_count int;
  v_avg_sentence_len numeric;
  v_tag_count int;
  v_confidence_boost numeric;
  v_support_count int;
  v_lower_text text;
  v_support_keywords text[] := array['because','according to','source','evidence','observed','measured','reported','data','study','analysis'];
  v_negation_count int;
  v_word_freq jsonb;
  v_repeated_words int;
  v_meaningful_words int;
  v_entry_type_bonus int;
  v_influence int;
  v_new_hash text;
  v_dup_entry_id uuid;
begin
  v_text := trim(coalesce(new.content, ''));
  if v_text = '' then
    new.quality_score := 0;
    new.influence_score := 0;
    new.content_hash := null;
    new.duplicate_flag := false;
    return new;
  end if;

  v_char_count := length(replace(replace(replace(replace(v_text, ' ', ''), chr(9), ''), chr(10), ''), chr(13), ''));

  -- 1. Detail
  if v_char_count >= 200 then v_score := v_score + 20;
  elsif v_char_count >= 100 then v_score := v_score + 15;
  elsif v_char_count >= 50 then v_score := v_score + 10;
  elsif v_char_count >= 20 then v_score := v_score + 5;
  end if;

  -- 2. Clarity
  v_sentence_count := array_length(string_to_array(v_text, '.'), 1) - 1;
  if v_sentence_count > 0 then
    v_avg_sentence_len := length(v_text) / v_sentence_count;
    if v_avg_sentence_len > 0 and v_avg_sentence_len < 200 then v_score := v_score + 10;
    else v_score := v_score + 5; end if;
  end if;

  -- 3. Specificity
  v_proper_nouns := array_length(regexp_matches(v_text, '\b[A-Z][a-z]{2,}\b', 'g'), 1);
  v_numbers := array_length(regexp_matches(v_text, '\b\d+', 'g'), 1);
  v_score := v_score + least(15, coalesce(v_proper_nouns, 0) * 3 + coalesce(v_numbers, 0) * 2);

  -- 4. Category/tag alignment
  v_tag_count := coalesce(array_length(coalesce(new.selected_subtags, '{}'::jsonb), 1), 0)
    + coalesce(array_length(coalesce(new.custom_tags, '{}'::jsonb), 1), 0)
    + case when new.selected_category is not null then 1 else 0 end;
  v_score := v_score + least(10, v_tag_count * 3);

  -- 5. Entry-type depth bonus
  v_entry_type_bonus := case new.entry_type
    when 'quick_observation' then 0
    when 'basic_deep_entry' then 4
    when 'advanced_deep_entry' then 8
    else 0 end;
  v_score := v_score + v_entry_type_bonus;

  -- 6. Confidence boost
  v_confidence_boost := case new.confidence_level
    when 'verified_observation' then 5
    when 'strong_confidence' then 4
    when 'moderate_confidence' then 3
    when 'weak_suspicion' then 1
    else 2 end;
  v_score := v_score + v_confidence_boost;

  -- 7. Supporting context
  v_lower_text := lower(v_text);
  select count(*) into v_support_count
  from unnest(v_support_keywords) as kw
  where v_lower_text like '%' || kw || '%';
  v_score := v_score + least(10, v_support_count * 3);

  -- 8. Internal consistency (simplified)
  v_negation_count := coalesce(array_length(regexp_matches(v_text, '\bnot\b|\bnever\b|\bcannot\b', 'gi'), 1), 0);
  if v_negation_count <= 2 then v_score := v_score + 5; end if;

  -- 9. Non-duplicative (keyword stuffing check — simplified)
  v_meaningful_words := array_length(
    array_remove(
      array(SELECT word FROM unnest(string_to_array(lower(v_text), ' ')) AS word WHERE char_length(word) > 2),
      NULL
    ), 1);
  if coalesce(v_meaningful_words, 0) < 5 then v_score := v_score - 15; end if;

  -- Clamp
  v_score := greatest(0, least(100, v_score));
  new.quality_score := v_score;

  -- Influence baseline
  v_influence := round(
    v_score * 0.7 *
    case new.confidence_level
      when 'verified_observation' then 1.15
      when 'strong_confidence' then 1.0
      when 'moderate_confidence' then 0.85
      else 0.65 end *
    case new.entry_type
      when 'quick_observation' then 0.8
      when 'basic_deep_entry' then 1.0
      when 'advanced_deep_entry' then 1.15
      else 1.0 end
    + v_score * 0.3
  );
  new.influence_score := greatest(0, least(100, v_influence));

  -- Content hash
  v_new_hash := 'ch_' || substring(md5(lower(regexp_replace(v_text, '[^a-zA-Z0-9]', '', 'g'))) from 1 for 16);
  new.content_hash := v_new_hash;

  -- Duplicate detection (same user, other entries)
  select id into v_dup_entry_id
  from public.open_intelligence
  where user_id = new.user_id
    and id != new.id
    and content_hash = v_new_hash
  limit 1;
  new.duplicate_flag := v_dup_entry_id is not null;

  -- Ensure version_number starts at 1 on insert
  if TG_OP = 'INSERT' and new.version_number is null then
    new.version_number := 1;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = '';

drop trigger if exists oi_quality_on_insert on public.open_intelligence;
create trigger oi_quality_on_insert
  before insert on public.open_intelligence
  for each row execute function public.evaluate_oi_quality_trigger();

drop trigger if exists oi_quality_on_update on public.open_intelligence;
create trigger oi_quality_on_update
  before update on public.open_intelligence
  for each row execute function public.evaluate_oi_quality_trigger();

-- Comment: The trigger overwrites client-supplied quality_score, influence_score,
-- content_hash, and duplicate_flag on every INSERT and UPDATE. Client values for
-- these fields are ignored. validation_status is NOT overwritten by this trigger
-- (it is managed by the worker via disputes/feedback/moderation flows).

-- ── 5B-CORRECTION: Legacy status migration (idempotent) ─────────────────────
-- Map remaining legacy 'validated' and 'flagged' values to new statuses.
do $$
begin
  update public.open_intelligence set validation_status = 'community_supported'
    where validation_status = 'validated';
  update public.open_intelligence set validation_status = 'disputed'
    where validation_status = 'flagged';
exception when others then null;
end $$;

-- ── 6C-1: INTELLIGENCE NOTIFICATIONS ──────────────────────────────────────
-- Secure notification system for Open Intelligence events.
-- Only the secure worker (service_role) creates notifications.
-- Users can read only their own and mark only their own as read.
create table if not exists public.intelligence_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid references public.open_intelligence(id) on delete set null,
  notification_type text not null check (notification_type in (
    'community_supported',
    'externally_supported',
    'disputed',
    'rejected',
    'dispute_dismissed',
    'outdated',
    'exchange_sharing_disabled',
    'faction_sharing_removed'
  )),
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.intelligence_notifications
  add column if not exists user_id uuid,
  add column if not exists entry_id uuid,
  add column if not exists notification_type text,
  add column if not exists title text,
  add column if not exists message text,
  add column if not exists is_read boolean,
  add column if not exists created_at timestamptz;

create index if not exists in_user_unread_idx
  on public.intelligence_notifications(user_id, is_read, created_at desc);
create index if not exists in_user_created_idx
  on public.intelligence_notifications(user_id, created_at desc);

alter table public.intelligence_notifications enable row level security;

drop policy if exists "in_self_select" on public.intelligence_notifications;
drop policy if exists "in_self_update_read" on public.intelligence_notifications;
drop policy if exists "in_self_insert" on public.intelligence_notifications;

-- Users can read only their own notifications
create policy "in_self_select" on public.intelligence_notifications
  for select using (auth.uid() = user_id);

-- Users can mark only their own notifications as read (update is_read only)
create policy "in_self_update_read" on public.intelligence_notifications
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- NO client INSERT policy — only service_role (secure worker) creates notifications.
-- This prevents users from creating fake notifications.

-- ── 6C-2: INTELLIGENCE MODERATION AUDIT ────────────────────────────────────
-- Secure audit trail for all moderation actions.
-- Normal users cannot insert, update, or delete audit records.
-- Only verified admins via the secure worker (service_role) create audit records.
create table if not exists public.intelligence_moderation_audit (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.open_intelligence(id) on delete cascade,
  moderator_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in (
    'dismiss_dispute',
    'mark_community_supported',
    'mark_externally_supported',
    'mark_disputed',
    'reject_entry'
  )),
  previous_status text,
  new_status text,
  dispute_id uuid,
  optional_note text,
  created_at timestamptz not null default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.intelligence_moderation_audit
  add column if not exists entry_id uuid,
  add column if not exists moderator_user_id uuid,
  add column if not exists action text,
  add column if not exists previous_status text,
  add column if not exists new_status text,
  add column if not exists dispute_id uuid,
  add column if not exists optional_note text,
  add column if not exists created_at timestamptz;

create index if not exists ima_entry_idx
  on public.intelligence_moderation_audit(entry_id, created_at desc);
create index if not exists ima_moderator_idx
  on public.intelligence_moderation_audit(moderator_user_id, created_at desc);

alter table public.intelligence_moderation_audit enable row level security;

drop policy if exists "ima_admin_select" on public.intelligence_moderation_audit;
drop policy if exists "ima_self_select" on public.intelligence_moderation_audit;
drop policy if exists "ima_admin_insert" on public.intelligence_moderation_audit;

-- Admins can read audit records (verified server-side via is_admin).
-- For client RLS, we allow self-referencing select: moderators can see audit
-- records they performed. Full queue access is via the secure worker.
create policy "ima_self_select" on public.intelligence_moderation_audit
  for select using (auth.uid() = moderator_user_id);

-- NO client INSERT/UPDATE/DELETE — audit records are created exclusively
-- by the secure worker (service_role) after verifying is_admin = true.
-- This prevents users from creating fake audit records.

-- ── 6C-3: PUBLIC MODERATION AUDIT VIEW (safe, no moderator identity) ──────
-- Exposes audit history without revealing moderator identity.
-- Admins access full details via the secure worker; this view provides
-- a safe summary for the moderation screen's audit history section.
create or replace view public.intelligence_moderation_audit_public as
select
  id,
  entry_id,
  action,
  previous_status,
  new_status,
  dispute_id,
  optional_note,
  created_at
from public.intelligence_moderation_audit;

grant select on public.intelligence_moderation_audit_public to anon, authenticated;

-- =============================================================================
-- PHASE 8A: INTELLIGENCE ANALYTICS RPCs (owner-scoped, safe aggregates)
-- =============================================================================
-- These RPCs compute aggregate analytics for the authenticated owner using
-- security definer. They do NOT expose reviewer identities, buyer identities,
-- or internal anti-gaming/moderation data. Only the secure worker calls them
-- after verifying the authenticated user; results are owner-scoped by p_user_id.

-- ── 8A-1: OWNER ENTRY STATUS COUNTS ──────────────────────────────────────────
-- Returns counts of the user's own entries grouped by validation status,
-- plus active, outdated, and sharing totals. Uses a single scan.
create or replace function public.get_owner_intelligence_summary(
  p_user_id uuid
)
returns table (
  total_entries bigint,
  active_entries bigint,
  pending_review bigint,
  community_supported bigint,
  externally_supported bigint,
  disputed bigint,
  withdrawn bigint,
  rejected bigint,
  outdated bigint,
  avg_quality numeric,
  avg_influence numeric,
  shared_with_faction bigint,
  shared_on_exchange bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select
    count(*)::bigint as total_entries,
    count(*) filter (where oi.validation_status not in ('rejected', 'withdrawn'))::bigint as active_entries,
    count(*) filter (where oi.validation_status = 'pending_review')::bigint as pending_review,
    count(*) filter (where oi.validation_status in ('community_supported', 'validated'))::bigint as community_supported,
    count(*) filter (where oi.validation_status = 'externally_supported')::bigint as externally_supported,
    count(*) filter (where oi.validation_status = 'disputed')::bigint as disputed,
    count(*) filter (where oi.validation_status = 'withdrawn')::bigint as withdrawn,
    count(*) filter (where oi.validation_status = 'rejected')::bigint as rejected,
    count(*) filter (where oi.outdated_flag = true)::bigint as outdated,
    coalesce(avg(oi.quality_score), 0)::numeric as avg_quality,
    coalesce(avg(oi.influence_score), 0)::numeric as avg_influence,
    coalesce((
      select count(distinct fsi.oi_entry_id)::bigint
      from public.faction_shared_intelligence fsi
      where fsi.user_id = p_user_id
    ), 0::bigint) as shared_with_faction,
    count(*) filter (where oi.exchange_share_enabled = true)::bigint as shared_on_exchange
  from public.open_intelligence oi
  where oi.user_id = p_user_id;
end;
$$;

-- ── 8A-2: OWNER ENTRY PERFORMANCE (per-entry safe metrics) ──────────────────
-- Returns safe per-entry performance metrics for the authenticated owner.
-- Does NOT expose reviewer identities, dispute reporters, or buyer identities.
create or replace function public.get_owner_entry_performance(
  p_user_id uuid,
  p_limit int default 100
)
returns table (
  entry_id uuid,
  quality_score numeric,
  influence_score numeric,
  validation_status text,
  analyst_use_count bigint,
  helpful_count bigint,
  support_count bigint,
  dispute_count bigint,
  outdated_flag boolean,
  last_used_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select
    oi.id as entry_id,
    oi.quality_score::numeric as quality_score,
    oi.influence_score::numeric as influence_score,
    oi.validation_status as validation_status,
    coalesce((
      select count(*)::bigint from public.analyst_context_usage acu
      where acu.source_entry_id = oi.id
        and acu.source_type in ('personal', 'faction', 'exchange')
    ), 0::bigint) as analyst_use_count,
    coalesce((
      select count(*)::bigint from public.open_intelligence_feedback oif
      where oif.entry_id = oi.id
        and oif.feedback_type in ('helpful', 'accurate_to_my_experience')
    ), 0::bigint) as helpful_count,
    coalesce((
      select count(*)::bigint from public.open_intelligence_feedback oif
      where oif.entry_id = oi.id
        and oif.feedback_type = 'helpful'
    ), 0::bigint) as support_count,
    coalesce(oi.active_dispute_count, 0)::bigint as dispute_count,
    oi.outdated_flag as outdated_flag,
    (select max(acu.used_at) from public.analyst_context_usage acu
     where acu.source_entry_id = oi.id) as last_used_at
  from public.open_intelligence oi
  where oi.user_id = p_user_id
  order by oi.created_at desc
  limit p_limit;
end;
$$;

-- ── 8A-3: OWNER WEEKLY TREND ────────────────────────────────────────────────
-- Returns weekly buckets of entries created, avg quality, and analyst usage
-- for the authenticated owner over the last p_weeks weeks.
create or replace function public.get_owner_weekly_trend(
  p_user_id uuid,
  p_weeks int default 12
)
returns table (
  week_start date,
  entries_created bigint,
  avg_quality numeric,
  analyst_uses bigint,
  feedback_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select
    d::date as week_start,
    count(*) filter (
      where oi.created_at >= d and oi.created_at < d + interval '7 days'
    )::bigint as entries_created,
    coalesce(avg(oi.quality_score) filter (
      where oi.created_at >= d and oi.created_at < d + interval '7 days'
    ), 0)::numeric as avg_quality,
    coalesce((
      select count(*)::bigint from public.analyst_context_usage acu
      where acu.source_owner_id = p_user_id
        and acu.source_type in ('personal', 'faction', 'exchange')
        and acu.used_at >= d and acu.used_at < d + interval '7 days'
    ), 0::bigint) as analyst_uses,
    coalesce((
      select count(*)::bigint
      from public.open_intelligence_feedback oif
      join public.open_intelligence oi2 on oi2.id = oif.entry_id
      where oi2.user_id = p_user_id
        and oif.created_at >= d and oif.created_at < d + interval '7 days'
    ), 0::bigint) as feedback_count
  from generate_series(
    date_trunc('week', now() - ((p_weeks - 1) || ' weeks')::interval),
    date_trunc('week', now()),
    interval '7 days'
  ) as d
  left join public.open_intelligence oi on oi.user_id = p_user_id
  group by d
  order by d;
end;
$$;

-- ── 8A-4: OWNER FACTION CONTRIBUTION INSIGHTS ──────────────────────────────
-- Returns the user's contribution summary for each faction they belong to.
-- Does NOT expose private statistics for other members.
create or replace function public.get_owner_faction_contributions(
  p_user_id uuid
)
returns table (
  faction_id uuid,
  entries_shared bigint,
  entries_used_by_analysts bigint,
  avg_quality numeric,
  supported_entries bigint,
  disputed_entries bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select
    fm.faction_id as faction_id,
    coalesce((
      select count(*)::bigint from public.faction_shared_intelligence fsi2
      where fsi2.faction_id = fm.faction_id and fsi2.user_id = p_user_id
    ), 0::bigint) as entries_shared,
    coalesce((
      select count(distinct acu.source_entry_id)::bigint
      from public.analyst_context_usage acu
      where acu.faction_id = fm.faction_id
        and acu.source_owner_id = p_user_id
        and acu.source_type = 'faction'
    ), 0::bigint) as entries_used_by_analysts,
    coalesce((
      select avg(oi.quality_score)::numeric
      from public.faction_shared_intelligence fsi3
      join public.open_intelligence oi on oi.id = fsi3.oi_entry_id
      where fsi3.faction_id = fm.faction_id and fsi3.user_id = p_user_id
    ), 0::numeric) as avg_quality,
    coalesce((
      select count(*)::bigint
      from public.faction_shared_intelligence fsi4
      join public.open_intelligence oi2 on oi2.id = fsi4.oi_entry_id
      where fsi4.faction_id = fm.faction_id
        and fsi4.user_id = p_user_id
        and oi2.validation_status in ('community_supported', 'externally_supported', 'validated')
    ), 0::bigint) as supported_entries,
    coalesce((
      select count(*)::bigint
      from public.faction_shared_intelligence fsi5
      join public.open_intelligence oi3 on oi3.id = fsi5.oi_entry_id
      where fsi5.faction_id = fm.faction_id
        and fsi5.user_id = p_user_id
        and oi3.validation_status = 'disputed'
    ), 0::bigint) as disputed_entries
  from public.faction_members fm
  where fm.user_id = p_user_id
    and fm.status = 'active';
end;
$$;

-- ── 8A-5: OWNER EXCHANGE CONTRIBUTION INSIGHTS ─────────────────────────────
-- Returns the user's (as vendor) Exchange contribution summary.
-- Does NOT expose buyer identities.
create or replace function public.get_owner_exchange_contributions(
  p_user_id uuid
)
returns table (
  eligible_exchange_entries bigint,
  synchronized_entries_used bigint,
  avg_shared_quality numeric,
  supported_entry_rate numeric,
  dispute_rate numeric,
  active_purchases bigint,
  expired_purchases bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select
    count(*) filter (where oi.exchange_share_enabled = true)::bigint as eligible_exchange_entries,
    coalesce((
      select count(distinct acu.source_entry_id)::bigint
      from public.analyst_context_usage acu
      where acu.source_owner_id = p_user_id
        and acu.source_type = 'exchange'
    ), 0::bigint) as synchronized_entries_used,
    coalesce(avg(oi.quality_score) filter (where oi.exchange_share_enabled = true), 0)::numeric as avg_shared_quality,
    case when count(*) > 0
      then count(*) filter (where oi.validation_status in ('community_supported', 'externally_supported', 'validated'))::numeric / count(*)::numeric
      else 0::numeric
    end as supported_entry_rate,
    case when count(*) > 0
      then count(*) filter (where oi.validation_status = 'disputed')::numeric / count(*)::numeric
      else 0::numeric
    end as dispute_rate,
    coalesce((
      select count(*)::bigint from public.marketplace_sync_purchases msp
      where msp.vendor_id = p_user_id and msp.active = true
    ), 0::bigint) as active_purchases,
    coalesce((
      select count(*)::bigint from public.marketplace_sync_purchases msp
      where msp.vendor_id = p_user_id and msp.active = false
    ), 0::bigint) as expired_purchases
  from public.open_intelligence oi
  where oi.user_id = p_user_id;
end;
$$;

-- Restrict execution of the analytics RPCs to the service_role only.
-- The secure worker verifies auth and invokes these with the service role key;
-- direct client (anon/authenticated/public) calls are blocked entirely.
revoke execute on function public.get_owner_intelligence_summary(uuid) from public;
revoke execute on function public.get_owner_intelligence_summary(uuid) from anon;
revoke execute on function public.get_owner_intelligence_summary(uuid) from authenticated;
grant execute on function public.get_owner_intelligence_summary(uuid) to service_role;

revoke execute on function public.get_owner_entry_performance(uuid, int) from public;
revoke execute on function public.get_owner_entry_performance(uuid, int) from anon;
revoke execute on function public.get_owner_entry_performance(uuid, int) from authenticated;
grant execute on function public.get_owner_entry_performance(uuid, int) to service_role;

revoke execute on function public.get_owner_weekly_trend(uuid, int) from public;
revoke execute on function public.get_owner_weekly_trend(uuid, int) from anon;
revoke execute on function public.get_owner_weekly_trend(uuid, int) from authenticated;
grant execute on function public.get_owner_weekly_trend(uuid, int) to service_role;

revoke execute on function public.get_owner_faction_contributions(uuid) from public;
revoke execute on function public.get_owner_faction_contributions(uuid) from anon;
revoke execute on function public.get_owner_faction_contributions(uuid) from authenticated;
grant execute on function public.get_owner_faction_contributions(uuid) to service_role;

revoke execute on function public.get_owner_exchange_contributions(uuid) from public;
revoke execute on function public.get_owner_exchange_contributions(uuid) from anon;
revoke execute on function public.get_owner_exchange_contributions(uuid) from authenticated;
grant execute on function public.get_owner_exchange_contributions(uuid) to service_role;

-- =============================================================================
-- PHASE 11B FINAL - ATOMIC ARENA NEURON DEDUCTION / REFUND (service_role only)
-- =============================================================================
-- These RPCs make Arena Mode Neuron movement atomic and idempotent at the
-- database level so concurrent requests can never overspend and a request_id
-- can be charged or refunded only once. Executable only by service_role.

-- Arena deduction ledger
-- Tracks exactly what was deducted for each Arena request_id so refunds can
-- return the precise subscription/purchased amounts (not a balance snapshot),
-- and so a request_id can be charged or refunded only once. RLS-disabled with
-- no client policies: only service_role (which bypasses RLS) writes to it.
create table if not exists public.arena_deductions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  amount int not null,
  from_subscription int not null default 0,
  from_purchased int not null default 0,
  bucket text not null default 'subscription',
  status text not null default 'charged',
  note text,
  created_at timestamptz default now(),
  refunded_at timestamptz
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.arena_deductions
  add column if not exists user_id uuid,
  add column if not exists request_id text,
  add column if not exists amount integer,
  add column if not exists from_subscription integer,
  add column if not exists from_purchased integer,
  add column if not exists bucket text,
  add column if not exists status text,
  add column if not exists note text,
  add column if not exists created_at timestamptz,
  add column if not exists refunded_at timestamptz;

drop index if exists arena_deductions_user_request_uniq;
create unique index if not exists arena_deductions_user_request_uniq
  on public.arena_deductions(user_id, request_id);

alter table public.arena_deductions enable row level security;
-- No client policies: only service_role (bypasses RLS) may read or write.

-- Remove any older overloads of deduct_arena_neurons before creating the new
-- three-argument version. The previous signature accepted a client-controlled
-- p_amount (uuid, text, int, text) which must not remain callable. DROP FUNCTION
-- IF EXISTS is safe and idempotent.
drop function if exists public.deduct_arena_neurons(uuid, text, int, text);
drop function if exists public.deduct_arena_neurons(uuid, text, int);
drop function if exists public.deduct_arena_neurons(uuid, text);

-- Atomic Arena deduction (service_role only)
-- The Arena cost is enforced server-side as exactly 50 Neurons (ARENA_COST).
-- The function has NO p_amount argument so the caller cannot change the cost.
--
-- Race-safety sequence:
--   1. Lock the user's profile row (FOR UPDATE) so concurrent Arena requests
--      for the same user serialize on that row.
--   2. AFTER the lock is obtained, re-check arena_deductions for the same
--      user_id + request_id. A concurrent request that committed first will
--      now be visible; return duplicate without changing balances.
--   3. Verify sufficient balance under the lock.
--   4. Deduct exactly ARENA_COST (subscription bucket first, then purchased).
--   5. INSERT the arena_deductions ledger row. The unique(user_id, request_id)
--      index is the final guard: if a concurrent transaction somehow slipped
--      through, this INSERT raises a unique violation and the whole function
--      aborts and rolls back the balance change.
--   6. Log edge_transactions. Return the structured result.
-- No ON CONFLICT DO NOTHING is used after the balance change: a conflict here
-- is a real error and must roll back the deduction.
create or replace function public.deduct_arena_neurons(
  p_user_id uuid,
  p_request_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ARENA_COST int := 50;
  v_sub int;
  v_purchased int;
  v_from_sub int;
  v_from_purchased int;
  v_next_sub int;
  v_next_purchased int;
  v_total int;
  v_bucket text;
  v_existing_id uuid;
begin
  if p_request_id is null or btrim(p_request_id) = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_request_id');
  end if;

  -- 1. Lock the profile row FIRST so concurrent Arena requests for this user
  --    serialize. This is the critical race-safety step: two simultaneous
  --    requests with the same request_id both wait here and run one at a time.
  select edge_subscription, edge_purchased
    into v_sub, v_purchased
    from public.profiles
    where id = p_user_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'profile_not_found');
  end if;

  -- 2. Re-check the ledger AFTER the lock. A concurrent request that committed
  --    before we got the lock is now visible; return duplicate, no second charge.
  --    (The pre-lock check in earlier versions was not enough; this is the check
  --    that closes the race.)
  select ad.id into v_existing_id
    from public.arena_deductions ad
    where ad.user_id = p_user_id and ad.request_id = p_request_id
    limit 1;

  if v_existing_id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'message', 'already_charged');
  end if;

  -- 3. Verify sufficient balance while still holding the lock.
  v_sub := coalesce(v_sub, 0);
  v_purchased := coalesce(v_purchased, 0);
  v_total := v_sub + v_purchased;

  if v_total < ARENA_COST then
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', v_total, 'cost', ARENA_COST);
  end if;

  -- 4. Deduct exactly ARENA_COST (subscription bucket first, then purchased).
  v_from_sub := least(v_sub, ARENA_COST);
  v_from_purchased := ARENA_COST - v_from_sub;
  v_next_sub := v_sub - v_from_sub;
  v_next_purchased := v_purchased - v_from_purchased;

  if v_from_sub > 0 and v_from_purchased > 0 then
    v_bucket := 'mixed';
  elsif v_from_purchased > 0 then
    v_bucket := 'purchased';
  else
    v_bucket := 'subscription';
  end if;

  update public.profiles
    set edge_subscription = v_next_sub,
        edge_purchased = v_next_purchased,
        updated_at = now()
    where id = p_user_id;

  -- 5. Insert the ledger row. The unique(user_id, request_id) index is the
  --    final guard. NO ON CONFLICT DO NOTHING: if a duplicate appears here it
  --    means a concurrent transaction committed between steps 2 and 5, which
  --    must raise and roll back the balance change we just made.
  insert into public.arena_deductions (user_id, request_id, amount, from_subscription, from_purchased, bucket, status, note)
    values (p_user_id, p_request_id, ARENA_COST, v_from_sub, v_from_purchased, v_bucket, 'charged', p_note);

  -- 6. Log the transaction.
  insert into public.edge_transactions (user_id, kind, reason, amount, bucket, from_subscription, from_purchased, balance_subscription_after, balance_purchased_after, note)
    values (p_user_id, 'deduction', 'arena', ARENA_COST, v_bucket, v_from_sub, v_from_purchased, v_next_sub, v_next_purchased, p_note);

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'amount', ARENA_COST,
    'from_subscription', v_from_sub,
    'from_purchased', v_from_purchased,
    'bucket', v_bucket,
    'balance_subscription_after', v_next_sub,
    'balance_purchased_after', v_next_purchased
  );
end;
$$;

-- Idempotent Arena refund (service_role only)
-- Refunds the exact subscription/purchased amounts recorded for a request_id,
-- but only the first time it is called for that request_id. Subsequent refund
-- attempts for the same request_id short-circuit (no second credit). Does NOT
-- snapshot/restore the whole balance: it adds back only what was deducted for
-- this specific Arena request, so other purchases/sessions in the meantime are
-- unaffected.
create or replace function public.refund_arena_neurons(
  p_user_id uuid,
  p_request_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ded record;
  v_next_sub int;
  v_next_purchased int;
begin
  if p_request_id is null or btrim(p_request_id) = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_request_id');
  end if;

  -- Lock the deduction row so concurrent refund attempts serialize.
  select amount, from_subscription, from_purchased, bucket, status, refunded_at
    into v_ded
    from public.arena_deductions
    where user_id = p_user_id and request_id = p_request_id
    for update;

  if not found then
    -- Nothing was ever charged for this request_id (e.g. failure before
    -- deduction). Nothing to refund.
    return jsonb_build_object('ok', true, 'duplicate', true, 'message', 'no_charge_to_refund');
  end if;

  if v_ded.status = 'refunded' then
    -- Already refunded; idempotent no-op.
    return jsonb_build_object('ok', true, 'duplicate', true, 'message', 'already_refunded');
  end if;

  -- Add back exactly what was deducted for this request, not a balance snapshot.
  -- Lock the profile row. If the profile no longer exists, return safely without
  -- marking the deduction as refunded (so a later retry can still complete).
  select edge_subscription + coalesce(v_ded.from_subscription, 0),
         edge_purchased + coalesce(v_ded.from_purchased, 0)
    into v_next_sub, v_next_purchased
    from public.profiles
    where id = p_user_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'profile_not_found');
  end if;

  update public.profiles
    set edge_subscription = v_next_sub,
        edge_purchased = v_next_purchased,
        updated_at = now()
    where id = p_user_id;

  update public.arena_deductions
    set status = 'refunded',
        refunded_at = now()
    where user_id = p_user_id and request_id = p_request_id;

  insert into public.edge_transactions (user_id, kind, reason, amount, bucket, from_subscription, from_purchased, balance_subscription_after, balance_purchased_after, note)
    values (p_user_id, 'addition', 'arena_refund', v_ded.amount, v_ded.bucket, v_ded.from_subscription, v_ded.from_purchased, v_next_sub, v_next_purchased, p_note);

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'amount', v_ded.amount,
    'from_subscription', v_ded.from_subscription,
    'from_purchased', v_ded.from_purchased,
    'balance_subscription_after', v_next_sub,
    'balance_purchased_after', v_next_purchased
  );
end;
$$;

-- Lock both Arena RPCs to service_role only. p_amount has been removed from the
-- deduction signature; the cost is hardcoded server-side as 50 Neurons.
revoke execute on function public.deduct_arena_neurons(uuid, text, text) from public;
revoke execute on function public.deduct_arena_neurons(uuid, text, text) from anon;
revoke execute on function public.deduct_arena_neurons(uuid, text, text) from authenticated;
grant execute on function public.deduct_arena_neurons(uuid, text, text) to service_role;

revoke execute on function public.refund_arena_neurons(uuid, text, text) from public;
revoke execute on function public.refund_arena_neurons(uuid, text, text) from anon;
revoke execute on function public.refund_arena_neurons(uuid, text, text) from authenticated;
grant execute on function public.refund_arena_neurons(uuid, text, text) to service_role;

-- =============================================================================
-- PHASE 11B - ARENA HISTORY
-- =============================================================================
-- Trusted server inserts only. Clients may read their own history but never
-- create/update/delete rows directly. The worker writes verdict, scores, and
-- metadata from the secure Arena analysis pipeline; the client cannot forge
-- results, verdicts, source counts, or Neuron cost.
create table if not exists public.arena_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  eagoh_id uuid not null references public.eagohs(id) on delete cascade,
  domain text not null,
  comparison_type text not null,
  subject_a_name text not null,
  subject_a_context text,
  subject_a_year text,
  subject_b_name text not null,
  subject_b_context text,
  subject_b_year text,
  focus text,
  custom_focus text,
  custom_question text,
  verdict text not null,
  confidence int not null default 0,
  category_scores jsonb not null default '[]'::jsonb,
  subject_a_advantages jsonb not null default '[]'::jsonb,
  subject_b_advantages jsonb not null default '[]'::jsonb,
  similarities jsonb not null default '[]'::jsonb,
  major_differences jsonb not null default '[]'::jsonb,
  oi_influence jsonb not null default '{}'::jsonb,
  response_summary text not null default '',
  source_citations jsonb not null default '[]'::jsonb,
  evidence_limitations text,
  source_counts jsonb not null default '{}'::jsonb,
  neuron_cost int not null default 0,
  request_id text not null,
  created_at timestamptz default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.arena_history
  add column if not exists user_id uuid,
  add column if not exists eagoh_id uuid,
  add column if not exists domain text,
  add column if not exists comparison_type text,
  add column if not exists subject_a_name text,
  add column if not exists subject_a_context text,
  add column if not exists subject_a_year text,
  add column if not exists subject_b_name text,
  add column if not exists subject_b_context text,
  add column if not exists subject_b_year text,
  add column if not exists focus text,
  add column if not exists custom_focus text,
  add column if not exists custom_question text,
  add column if not exists verdict text,
  add column if not exists confidence integer,
  add column if not exists category_scores jsonb,
  add column if not exists subject_a_advantages jsonb,
  add column if not exists subject_b_advantages jsonb,
  add column if not exists similarities jsonb,
  add column if not exists major_differences jsonb,
  add column if not exists oi_influence jsonb,
  add column if not exists response_summary text,
  add column if not exists source_citations jsonb,
  add column if not exists evidence_limitations text,
  add column if not exists source_counts jsonb,
  add column if not exists neuron_cost integer,
  add column if not exists request_id text,
  add column if not exists created_at timestamptz;

create index if not exists arena_history_user_idx on public.arena_history(user_id, created_at desc);
create index if not exists arena_history_eagoh_idx on public.arena_history(eagoh_id, created_at desc);

-- True idempotency: a request_id may be persisted only once per user.
-- A unique violation here means a duplicate/concurrent Arena request; the
-- worker treats the existing row as the canonical result (no second charge).
-- Idempotent: safe to run repeatedly on existing rows (nulls first become '' to
-- backfill any legacy rows created before the NOT NULL constraint).
update public.arena_history set request_id = id::text where request_id is null;
alter table public.arena_history alter column request_id set not null;

-- Safe duplicate handling before creating the unique index.
-- If duplicate (user_id, request_id) rows already exist, keep the OLDEST completed
-- row (lowest created_at, then lowest id as a tiebreaker) and delete only the
-- younger duplicates. This preserves the canonical result and lets the unique
-- index be created without a silent full-wipe or a blocking exception.
delete from public.arena_history h
  using public.arena_history keep
  where h.user_id = keep.user_id
    and h.request_id = keep.request_id
    and h.id <> keep.id
    and (
      keep.created_at < h.created_at
      or (keep.created_at = h.created_at and keep.id < h.id)
    );

drop index if exists arena_history_user_request_uniq;
create unique index if not exists arena_history_user_request_uniq
  on public.arena_history(user_id, request_id);

alter table public.arena_history enable row level security;

drop policy if exists "arena_history_self_select" on public.arena_history;
drop policy if exists "arena_history_self_insert" on public.arena_history;
drop policy if exists "arena_history_self_update" on public.arena_history;
drop policy if exists "arena_history_self_delete" on public.arena_history;

-- Owner can read their own history only. No client insert/update/delete policies:
-- the worker writes via service_role which bypasses RLS, and any client write
-- attempt is rejected because no matching policy exists.
create policy "arena_history_self_select" on public.arena_history
  for select using (auth.uid() = user_id);

-- =============================================================================
-- PHASE OI-CREATE: ATOMIC OPEN INTELLIGENCE ENTRY CREATION (service_role only)
-- =============================================================================
-- These RPCs make Open Intelligence entry creation atomic at the database level:
-- Neurons are deducted and the OI entry is inserted together in one transaction.
-- If either step fails, the entire operation rolls back — the user never pays
-- without getting their entry saved.
--
-- Idempotency: a request_id prevents double-charging on retries. The unique
-- index on oi_creation_ledger(user_id, request_id) is the final guard.
-- Executable only by service_role (bypasses RLS).

-- OI creation ledger — tracks exactly what was deducted for each OI request_id
-- so a refund can return the precise amounts (not a balance snapshot).
create table if not exists public.oi_creation_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  entry_id uuid references public.open_intelligence(id) on delete set null,
  amount int not null,
  from_subscription int not null default 0,
  from_purchased int not null default 0,
  bucket text not null default 'subscription',
  status text not null default 'charged', -- 'charged' | 'refunded'
  note text,
  created_at timestamptz default now(),
  refunded_at timestamptz
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.oi_creation_ledger
  add column if not exists user_id uuid,
  add column if not exists request_id text,
  add column if not exists entry_id uuid,
  add column if not exists amount integer,
  add column if not exists from_subscription integer,
  add column if not exists from_purchased integer,
  add column if not exists bucket text,
  add column if not exists status text,
  add column if not exists note text,
  add column if not exists created_at timestamptz,
  add column if not exists refunded_at timestamptz;

drop index if exists oi_ledger_user_request_uniq;
create unique index if not exists oi_ledger_user_request_uniq
  on public.oi_creation_ledger(user_id, request_id);

alter table public.oi_creation_ledger enable row level security;
-- No client policies: only service_role (bypasses RLS) may read or write.

-- Drop any older overloads before creating the final version.
drop function if exists public.create_oi_entry(uuid, text, uuid, text, text, text, text, text, jsonb, jsonb, int);
drop function if exists public.create_oi_entry(uuid, uuid, text, text, text, text, jsonb, jsonb, text);

-- Atomic OI entry creation (service_role only)
-- Deducts Neurons (subscription bucket first, then purchased) and inserts the
-- OI entry in a single transaction. The cost is determined server-side from
-- p_entry_type — the caller cannot specify an arbitrary amount.
--
-- Race-safety sequence:
--   1. Lock the user's profile row (FOR UPDATE) so concurrent requests serialize.
--   2. AFTER the lock, re-check the ledger for the same user_id + request_id.
--      A concurrent request that committed first is now visible; return duplicate.
--   3. Verify sufficient balance under the lock.
--   4. Deduct the cost (subscription first, then purchased).
--   5. Insert the OI entry. The DB trigger (evaluate_oi_quality_trigger) runs
--      before insert and overwrites quality_score, influence_score, content_hash,
--      and duplicate_flag with server-authoritative values.
--   6. Insert the ledger row. The unique(user_id, request_id) index is the final
--      guard: a concurrent transaction that slipped through raises and rolls
--      back everything (balance change + OI insert).
--   7. Log edge_transactions. Return the new entry ID and balance info.
create or replace function public.create_oi_entry(
  p_user_id uuid,
  p_request_id text,
  p_eagoh_id uuid,
  p_intelligence_domain text,
  p_entry_type text,
  p_content text,
  p_confidence_level text,
  p_tag text,
  p_selected_subtags jsonb default '[]'::jsonb,
  p_custom_tags jsonb default '[]'::jsonb,
  p_selected_category text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost_map jsonb := '{"quick_observation":10,"basic_deep_entry":15,"advanced_deep_entry":25}'::jsonb;
  v_cost int;
  v_sub int;
  v_purchased int;
  v_from_sub int;
  v_from_purchased int;
  v_next_sub int;
  v_next_purchased int;
  v_total int;
  v_bucket text;
  v_existing_id uuid;
  v_existing_entry_id uuid;
  v_new_entry_id uuid;
  v_char_count int;
begin
  if p_request_id is null or btrim(p_request_id) = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_request_id');
  end if;

  -- Determine cost from entry type (server-side, not client-controlled)
  v_cost := (v_cost_map ->> p_entry_type)::int;
  if v_cost is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_entry_type');
  end if;

  -- Validate content is not empty
  if p_content is null or btrim(p_content) = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_content');
  end if;

  -- 1. Lock the profile row so concurrent OI requests for this user serialize.
  select edge_subscription, edge_purchased
    into v_sub, v_purchased
    from public.profiles
    where id = p_user_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'profile_not_found');
  end if;

  -- 2. Re-check the ledger AFTER the lock. A concurrent request that committed
  --    before we got the lock is now visible; return duplicate with the entry id.
  select id, entry_id into v_existing_id, v_existing_entry_id
    from public.oi_creation_ledger
    where user_id = p_user_id and request_id = p_request_id
    limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'entry_id', v_existing_entry_id,
      'message', 'already_created'
    );
  end if;

  -- 3. Verify sufficient balance while still holding the lock.
  v_sub := coalesce(v_sub, 0);
  v_purchased := coalesce(v_purchased, 0);
  v_total := v_sub + v_purchased;

  if v_total < v_cost then
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', v_total, 'cost', v_cost);
  end if;

  -- 4. Deduct the cost (subscription bucket first, then purchased).
  v_from_sub := least(v_sub, v_cost);
  v_from_purchased := v_cost - v_from_sub;
  v_next_sub := v_sub - v_from_sub;
  v_next_purchased := v_purchased - v_from_purchased;

  if v_from_sub > 0 and v_from_purchased > 0 then
    v_bucket := 'mixed';
  elsif v_from_purchased > 0 then
    v_bucket := 'purchased';
  else
    v_bucket := 'subscription';
  end if;

  update public.profiles
    set edge_subscription = v_next_sub,
        edge_purchased = v_next_purchased,
        updated_at = now()
    where id = p_user_id;

  -- 5. Insert the OI entry. The DB trigger overwrites quality_score, influence_score,
  --    content_hash, and duplicate_flag with server-authoritative values.
  v_char_count := length(replace(replace(replace(replace(p_content, ' ', ''), chr(9), ''), chr(10), ''), chr(13), ''));

  insert into public.open_intelligence (
    user_id, eagoh_id, intelligence_domain, entry_type, tag, content,
    character_count_no_spaces, confidence_level, quality_score,
    validation_status, influence_score,
    selected_category, selected_subtags, custom_tags
  )
  values (
    p_user_id, p_eagoh_id, p_intelligence_domain, p_entry_type, p_tag, p_content,
    v_char_count, p_confidence_level, 0,
    'pending_review', 0,
    p_selected_category, p_selected_subtags, p_custom_tags
  )
  returning id into v_new_entry_id;

  -- 6. Insert the ledger row. The unique(user_id, request_id) index is the final
  --    guard. NO ON CONFLICT: a conflict means a concurrent transaction committed
  --    between steps 2 and 6, which must raise and roll back the deduction + insert.
  insert into public.oi_creation_ledger (user_id, request_id, entry_id, amount, from_subscription, from_purchased, bucket, status, note)
    values (p_user_id, p_request_id, v_new_entry_id, v_cost, v_from_sub, v_from_purchased, v_bucket, 'charged', p_note);

  -- 7. Log the transaction.
  insert into public.edge_transactions (user_id, kind, reason, amount, bucket, from_subscription, from_purchased, balance_subscription_after, balance_purchased_after, note)
    values (p_user_id, 'deduction', 'observation', v_cost, v_bucket, v_from_sub, v_from_purchased, v_next_sub, v_next_purchased, p_note);

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'entry_id', v_new_entry_id,
    'amount', v_cost,
    'from_subscription', v_from_sub,
    'from_purchased', v_from_purchased,
    'bucket', v_bucket,
    'balance_subscription_after', v_next_sub,
    'balance_purchased_after', v_next_purchased
  );
end;
$$;

-- Idempotent OI refund (service_role only)
-- Refunds the exact amounts recorded for a request_id, but only the first time.
-- Subsequent refund attempts for the same request_id short-circuit (no double credit).
create or replace function public.refund_oi_entry(
  p_user_id uuid,
  p_request_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_led record;
  v_next_sub int;
  v_next_purchased int;
begin
  if p_request_id is null or btrim(p_request_id) = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_request_id');
  end if;

  -- Lock the ledger row so concurrent refund attempts serialize.
  select amount, from_subscription, from_purchased, bucket, status, refunded_at
    into v_led
    from public.oi_creation_ledger
    where user_id = p_user_id and request_id = p_request_id
    for update;

  if not found then
    -- Nothing was ever charged for this request_id. Nothing to refund.
    return jsonb_build_object('ok', true, 'duplicate', true, 'message', 'no_charge_to_refund');
  end if;

  if v_led.status = 'refunded' then
    -- Already refunded; idempotent no-op.
    return jsonb_build_object('ok', true, 'duplicate', true, 'message', 'already_refunded');
  end if;

  -- Add back exactly what was deducted for this request.
  select edge_subscription + coalesce(v_led.from_subscription, 0),
         edge_purchased + coalesce(v_led.from_purchased, 0)
    into v_next_sub, v_next_purchased
    from public.profiles
    where id = p_user_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'profile_not_found');
  end if;

  update public.profiles
    set edge_subscription = v_next_sub,
        edge_purchased = v_next_purchased,
        updated_at = now()
    where id = p_user_id;

  update public.oi_creation_ledger
    set status = 'refunded',
        refunded_at = now()
    where user_id = p_user_id and request_id = p_request_id;

  insert into public.edge_transactions (user_id, kind, reason, amount, bucket, from_subscription, from_purchased, balance_subscription_after, balance_purchased_after, note)
    values (p_user_id, 'addition', 'oi_refund', v_led.amount, v_led.bucket, v_led.from_subscription, v_led.from_purchased, v_next_sub, v_next_purchased, p_note);

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'amount', v_led.amount,
    'from_subscription', v_led.from_subscription,
    'from_purchased', v_led.from_purchased,
    'balance_subscription_after', v_next_sub,
    'balance_purchased_after', v_next_purchased
  );
end;
$$;

-- Lock both OI RPCs to service_role only.
revoke execute on function public.create_oi_entry(uuid, text, uuid, text, text, text, text, text, jsonb, jsonb, text, text) from public;
revoke execute on function public.create_oi_entry(uuid, text, uuid, text, text, text, text, text, jsonb, jsonb, text, text) from anon;
revoke execute on function public.create_oi_entry(uuid, text, uuid, text, text, text, text, text, jsonb, jsonb, text, text) from authenticated;
grant execute on function public.create_oi_entry(uuid, text, uuid, text, text, text, text, text, jsonb, jsonb, text, text) to service_role;

revoke execute on function public.refund_oi_entry(uuid, text, text) from public;
revoke execute on function public.refund_oi_entry(uuid, text, text) from anon;
revoke execute on function public.refund_oi_entry(uuid, text, text) from authenticated;
grant execute on function public.refund_oi_entry(uuid, text, text) to service_role;

-- =============================================================================
-- PHASE RETAINED-OI-1: RETAINED EXCHANGE INTELLIGENCE
-- =============================================================================
-- Buyers retain a 2% snapshot of the Exchange cohort they purchased, as a
-- permanent read-only private library. Retained entries are:
--   - Read-only (no client insert/update/delete)
--   - Buyer-private (vendors cannot access)
--   - Never listed on Exchange, never shared with Factions, never resold
--   - Never copied into the buyer's open_intelligence table
--
-- Retention is created by a security-definer RPC after every successful
-- purchase, and deactivated (not deleted) on refund/reversal/dispute.
-- Only the service-role worker or secure DB function may create or deactivate.

create table if not exists public.retained_exchange_intelligence (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete cascade,
  vendor_id uuid not null references auth.users(id) on delete cascade,
  vendor_eagoh_id uuid not null references public.eagohs(id) on delete cascade,
  source_entry_id uuid not null references public.open_intelligence(id) on delete cascade,
  purchase_id uuid not null references public.marketplace_sync_purchases(id) on delete cascade,
  listing_id uuid references public.marketplace_listings(id) on delete set null,
  purchased_percentage integer not null,
  retention_percentage numeric not null default 2,
  retained_content_snapshot text not null,
  source_entry_type text,
  source_tag text,
  source_category text,
  source_quality_score numeric,
  source_confidence_level text,
  source_validation_status text,
  source_created_at timestamptz,
  vendor_display_name text,
  vendor_eagoh_name text,
  active boolean not null default true,
  deactivated_reason text,
  deactivated_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── LEGACY COLUMN MIGRATION: ensure all columns exist on older live tables ──
alter table public.retained_exchange_intelligence
  add column if not exists buyer_id uuid,
  add column if not exists vendor_id uuid,
  add column if not exists vendor_eagoh_id uuid,
  add column if not exists source_entry_id uuid,
  add column if not exists purchase_id uuid,
  add column if not exists listing_id uuid,
  add column if not exists purchased_percentage integer,
  add column if not exists retention_percentage numeric,
  add column if not exists retained_content_snapshot text,
  add column if not exists source_entry_type text,
  add column if not exists source_tag text,
  add column if not exists source_category text,
  add column if not exists source_quality_score numeric,
  add column if not exists source_confidence_level text,
  add column if not exists source_validation_status text,
  add column if not exists source_created_at timestamptz,
  add column if not exists vendor_display_name text,
  add column if not exists vendor_eagoh_name text,
  add column if not exists active boolean,
  add column if not exists deactivated_reason text,
  add column if not exists deactivated_at timestamptz,
  add column if not exists created_at timestamptz;

-- Unique constraint: one retained row per (purchase_id, source_entry_id) where active
drop index if exists retained_exchange_purchase_entry_uniq;
create unique index if not exists retained_exchange_purchase_entry_uniq
  on public.retained_exchange_intelligence(purchase_id, source_entry_id)
  where active = true;

-- Unique constraint: one ACTIVE retained row per (buyer_id, vendor_eagoh_id, source_entry_id)
-- Prevents duplicate active ownership of the same source entry across multiple purchases.
-- When a retained row is deactivated (active = false), the source entry becomes available
-- for re-retention through a later successful purchase.
drop index if exists retained_exchange_buyer_eagoh_entry_uniq;
create unique index if not exists retained_exchange_buyer_eagoh_entry_uniq
  on public.retained_exchange_intelligence(buyer_id, vendor_eagoh_id, source_entry_id)
  where active = true;

create index if not exists retained_buyer_active_idx
  on public.retained_exchange_intelligence(buyer_id, active, created_at desc);
create index if not exists retained_purchase_idx
  on public.retained_exchange_intelligence(purchase_id);
create index if not exists retained_vendor_eagoh_idx
  on public.retained_exchange_intelligence(vendor_eagoh_id);
create index if not exists retained_buyer_eagoh_active_idx
  on public.retained_exchange_intelligence(buyer_id, vendor_eagoh_id, active);

alter table public.retained_exchange_intelligence enable row level security;

drop policy if exists "retained_self_select" on public.retained_exchange_intelligence;
drop policy if exists "retained_self_insert" on public.retained_exchange_intelligence;
drop policy if exists "retained_self_update" on public.retained_exchange_intelligence;
drop policy if exists "retained_self_delete" on public.retained_exchange_intelligence;

-- Buyers may only read their own ACTIVE retained entries.
create policy "retained_self_select" on public.retained_exchange_intelligence
  for select using (auth.uid() = buyer_id and active = true);

-- No client insert, update, or delete policies.
-- Only service_role (bypasses RLS) or the security-definer RPCs may write.

-- ── analyst_context_usage source_type constraint and analyst_response_audits.retained_exchange_count ──
-- were migrated inline above (idempotent DO block + ADD COLUMN IF NOT EXISTS).
-- No additional constraint or column migration needed here.

-- =============================================================================
-- SECURE DB FUNCTION: create_retained_exchange_intelligence
-- =============================================================================
-- Called by the worker AFTER a successful purchase is verified server-side.
-- Reconstructs the exact eligible Exchange cohort, applies the purchased
-- percentage, retains ceil(cohort * 0.02) entries deterministically.
-- Idempotent: returns already_processed = true if rows already exist.

create or replace function public.create_retained_exchange_intelligence(
  p_purchase_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase record;
  v_listing record;
  v_vendor_eagoh record;
  v_vendor_profile record;
  v_pct integer;
  v_existing_for_purchase integer;
  v_total_eligible integer;
  v_purchased_cohort_count integer;
  v_max_retained integer;
  v_existing_retained integer;
  v_requested_retain integer;
  v_newly_retain integer;
  v_capacity integer;
  v_actual_inserted integer;
  v_inserted_rows integer;
  v_cap_reached boolean;
  v_entry record;
  v_validation_rank jsonb := '{"externally_supported":3,"community_supported":2,"pending_review":1,"disputed":0,"rejected":-1,"withdrawn":-1}'::jsonb;
  v_confidence_rank jsonb := '{"verified_observation":3,"strong_confidence":2,"moderate_confidence":1,"weak_suspicion":0}'::jsonb;
begin
  -- 1. Lock and verify the purchase
  select id, listing_id, buyer_id, vendor_id, eagoh_id, sync_level, active, started_at, expires_at
    into v_purchase
    from public.marketplace_sync_purchases
    where id = p_purchase_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'purchase_not_found');
  end if;

  -- 2. Confirm it is successful and active
  if v_purchase.active = false then
    return jsonb_build_object('ok', false, 'error', 'purchase_inactive');
  end if;

  if v_purchase.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'purchase_expired');
  end if;

  -- 3. Parse purchased percentage (25, 50, 75, 100)
  v_pct := case
    when v_purchase.sync_level = '25%' then 25
    when v_purchase.sync_level = '50%' then 50
    when v_purchase.sync_level = '75%' then 75
    when v_purchase.sync_level = '100%' then 100
    else null
  end;

  if v_pct is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_sync_level');
  end if;

  -- 4. Verify listing relationships
  select id, vendor_id, eagoh_id, active
    into v_listing
    from public.marketplace_listings
    where id = v_purchase.listing_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'listing_not_found');
  end if;

  if v_listing.vendor_id != v_purchase.vendor_id then
    return jsonb_build_object('ok', false, 'error', 'vendor_mismatch');
  end if;

  if v_listing.eagoh_id != v_purchase.eagoh_id then
    return jsonb_build_object('ok', false, 'error', 'eagoh_mismatch');
  end if;

  -- 5. Verify vendor EAGOH exists and belongs to vendor
  select id, user_id, name
    into v_vendor_eagoh
    from public.eagohs
    where id = v_purchase.eagoh_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'eagoh_not_found');
  end if;

  if v_vendor_eagoh.user_id != v_purchase.vendor_id then
    return jsonb_build_object('ok', false, 'error', 'eagoh_owner_mismatch');
  end if;

  -- 6. Get vendor display name
  select username into v_vendor_profile
    from public.profiles
    where id = v_purchase.vendor_id;

  -- 7. Count the TOTAL eligible vendor EAGOH entries (before percentage)
  --    This is the denominator for both the purchased cohort and the 25% cap.
  select count(*) into v_total_eligible
    from public.open_intelligence
    where user_id = v_purchase.vendor_id
      and eagoh_id = v_purchase.eagoh_id
      and exchange_share_enabled = true
      and validation_status in ('pending_review', 'community_supported', 'externally_supported', 'disputed', 'validated');

  -- 8. Calculate the purchased cohort count (percentage applied to total eligible)
  --    This is the number of entries the buyer actually purchased access to.
  v_purchased_cohort_count := ceil(v_total_eligible * v_pct / 100.0);

  -- 9. Calculate the 25% cumulative retention cap
  v_max_retained := ceil(v_total_eligible * 0.25);
  if v_max_retained < 1 and v_total_eligible > 0 then
    v_max_retained := 1;
  end if;

  -- 10. Count buyer's existing ACTIVE retained entries for this vendor EAGOH
  --     (across all purchases, not just this one)
  select count(*) into v_existing_retained
    from public.retained_exchange_intelligence
    where buyer_id = v_purchase.buyer_id
      and vendor_eagoh_id = v_purchase.eagoh_id
      and active = true;

  -- 11. Check for existing retained rows for THIS purchase (idempotency)
  select count(*) into v_existing_for_purchase
    from public.retained_exchange_intelligence
    where purchase_id = p_purchase_id and active = true;

  if v_existing_for_purchase > 0 then
    -- Already processed — return the ACTUAL purchased cohort size, not the retained count.
    return jsonb_build_object(
      'ok', true,
      'already_processed', true,
      'purchase_id', p_purchase_id,
      'purchased_cohort_count', v_purchased_cohort_count,
      'retained_count', v_existing_for_purchase,
      'total_vendor_eligible_entries', v_total_eligible,
      'maximum_retained_entries', v_max_retained,
      'existing_retained_count', v_existing_retained,
      'requested_retained_count', v_existing_for_purchase,
      'newly_retained_count', 0,
      'remaining_retention_capacity', greatest(v_max_retained - v_existing_retained, 0),
      'cap_reached', v_existing_retained >= v_max_retained
    );
  end if;

  if v_purchased_cohort_count = 0 then
    return jsonb_build_object(
      'ok', true,
      'already_processed', false,
      'purchase_id', p_purchase_id,
      'purchased_cohort_count', 0,
      'retained_count', 0,
      'total_vendor_eligible_entries', v_total_eligible,
      'maximum_retained_entries', v_max_retained,
      'existing_retained_count', v_existing_retained,
      'requested_retained_count', 0,
      'newly_retained_count', 0,
      'remaining_retention_capacity', greatest(v_max_retained - v_existing_retained, 0),
      'cap_reached', v_existing_retained >= v_max_retained
    );
  end if;

  -- 12. Calculate the normal 2% retention amount (from the purchased cohort)
  v_requested_retain := ceil(v_purchased_cohort_count * 0.02);
  if v_requested_retain < 1 then
    v_requested_retain := 1;
  end if;

  -- 13. Apply the 25% cumulative retention cap
  v_capacity := v_max_retained - v_existing_retained;
  if v_capacity <= 0 then
    -- Cap already reached: purchase proceeds normally but zero new retained entries
    v_newly_retain := 0;
    v_cap_reached := true;
  else
    v_newly_retain := least(v_requested_retain, v_capacity);
    v_cap_reached := (v_existing_retained + v_newly_retain) >= v_max_retained;
  end if;

  -- 14. Select and insert retained entries FROM THE PURCHASED COHORT ONLY.
  --     Step A: Build the full deterministic ordered eligible cohort (same stableCohortOrder
  --            as the worker: quality DESC, validation rank DESC, influence DESC,
  --            confidence rank DESC, created_at DESC, id ASC).
  --     Step B: Apply LIMIT v_purchased_cohort_count to get the purchased cohort.
  --     Step C: From within that purchased cohort, exclude entries the buyer already
  --            has ACTIVE retained rows for (this vendor EAGOH).
  --     Step D: Take the top v_newly_retain entries from the remaining set.
  --     A buyer must NEVER retain an entry that was outside the purchased cohort.
  v_actual_inserted := 0;

  if v_newly_retain > 0 then
    for v_entry in
      select sub.* from (
        select oi.id,
               oi.content,
               oi.entry_type,
               oi.tag,
               oi.selected_category,
               oi.quality_score,
               oi.influence_score,
               oi.confidence_level,
               oi.validation_status,
               oi.created_at,
               (v_validation_rank ->> oi.validation_status)::int as val_rank,
               (v_confidence_rank ->> oi.confidence_level)::int as conf_rank
          from public.open_intelligence oi
          where oi.user_id = v_purchase.vendor_id
            and oi.eagoh_id = v_purchase.eagoh_id
            and oi.exchange_share_enabled = true
            and oi.validation_status in ('pending_review', 'community_supported', 'externally_supported', 'disputed', 'validated')
          order by
            oi.quality_score desc,
            (v_validation_rank ->> oi.validation_status)::int desc,
            oi.influence_score desc,
            (v_confidence_rank ->> oi.confidence_level)::int desc,
            oi.created_at desc,
            oi.id asc
          limit v_purchased_cohort_count
      ) sub
      where not exists (
        select 1 from public.retained_exchange_intelligence rei
        where rei.buyer_id = v_purchase.buyer_id
          and rei.vendor_eagoh_id = v_purchase.eagoh_id
          and rei.source_entry_id = sub.id
          and rei.active = true
      )
      order by
        sub.quality_score desc,
        sub.val_rank desc,
        sub.influence_score desc,
        sub.conf_rank desc,
        sub.created_at desc,
        sub.id asc
      limit v_newly_retain
    loop
      insert into public.retained_exchange_intelligence (
        buyer_id, vendor_id, vendor_eagoh_id, source_entry_id, purchase_id, listing_id,
        purchased_percentage, retention_percentage, retained_content_snapshot,
        source_entry_type, source_tag, source_category, source_quality_score,
        source_confidence_level, source_validation_status, source_created_at,
        vendor_display_name, vendor_eagoh_name, active
      ) values (
        v_purchase.buyer_id, v_purchase.vendor_id, v_purchase.eagoh_id, v_entry.id,
        p_purchase_id, v_purchase.listing_id,
        v_pct, 2, v_entry.content,
        v_entry.entry_type, v_entry.tag, v_entry.selected_category,
        v_entry.quality_score, v_entry.confidence_level, v_entry.validation_status,
        v_entry.created_at,
        v_vendor_profile.username, v_vendor_eagoh.name, true
      )
      on conflict do nothing;

      -- Use GET DIAGNOSTICS to count only rows actually inserted (not skipped by ON CONFLICT)
      get diagnostics v_inserted_rows = row_count;
      v_actual_inserted := v_actual_inserted + v_inserted_rows;
    end loop;
  end if;

  -- 15. Return result with full cap information
  return jsonb_build_object(
    'ok', true,
    'already_processed', false,
    'purchase_id', p_purchase_id,
    'purchased_cohort_count', v_purchased_cohort_count,
    'retained_count', v_actual_inserted,
    'total_vendor_eligible_entries', v_total_eligible,
    'maximum_retained_entries', v_max_retained,
    'existing_retained_count', v_existing_retained,
    'requested_retained_count', v_requested_retain,
    'newly_retained_count', v_actual_inserted,
    'remaining_retention_capacity', greatest(v_max_retained - v_existing_retained - v_actual_inserted, 0),
    'cap_reached', v_cap_reached
  );
end;
$$;

-- =============================================================================
-- SECURE DB FUNCTION: deactivate_retained_exchange_intelligence
-- =============================================================================
-- Called when the original purchase becomes inactive (refund, reversal,
-- dispute, cancellation, administrative revocation). Sets all retained
-- records from that purchase to active = false. Does NOT delete rows.

create or replace function public.deactivate_retained_exchange_intelligence(
  p_purchase_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deactivated_count integer;
begin
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_reason');
  end if;

  -- Use UPDATE ... RETURNING to count the rows actually deactivated. GET
  -- DIAGNOSTICS ROW_COUNT after a plain UPDATE would also work, but RETURNING
  -- is explicit and safe even when the function is invoked via PERFORM from
  -- another SECURITY DEFINER function (where ROW_COUNT can be clobbered).
  with deactivated as (
    update public.retained_exchange_intelligence
      set active = false,
          deactivated_reason = p_reason,
          deactivated_at = now()
      where purchase_id = p_purchase_id
        and active = true
      returning id
  )
  select count(*)::integer into v_deactivated_count from deactivated;

  return jsonb_build_object(
    'ok', true,
    'purchase_id', p_purchase_id,
    'deactivated_count', v_deactivated_count
  );
end;
$$;

-- Lock both retained exchange RPCs to service_role only.
revoke execute on function public.create_retained_exchange_intelligence(uuid) from public;
revoke execute on function public.create_retained_exchange_intelligence(uuid) from anon;
revoke execute on function public.create_retained_exchange_intelligence(uuid) from authenticated;
grant execute on function public.create_retained_exchange_intelligence(uuid) to service_role;

revoke execute on function public.deactivate_retained_exchange_intelligence(uuid, text) from public;
revoke execute on function public.deactivate_retained_exchange_intelligence(uuid, text) from anon;
revoke execute on function public.deactivate_retained_exchange_intelligence(uuid, text) from authenticated;
grant execute on function public.deactivate_retained_exchange_intelligence(uuid, text) to service_role;

-- =============================================================================
-- AUTOMATIC TRIGGER: auto_create_retained_exchange on purchase insert
-- =============================================================================
-- Fires AFTER INSERT on marketplace_sync_purchases when active = true.
-- Calls create_retained_exchange_intelligence(NEW.id) automatically so retention
-- happens even if the mobile client's triggerRetention call fails.
-- Best-effort: errors are swallowed (NOTICE only) so the purchase insert is
-- never rolled back. The worker's /exchange/retention/create endpoint remains
-- as an idempotent retry fallback.

create or replace function public.auto_create_retained_exchange()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  -- Only fire for active purchases (refunds/revocations insert with active=false)
  if NEW.active = false then
    return NEW;
  end if;

  -- Call the retention RPC (best-effort: errors are swallowed)
  begin
    v_result := public.create_retained_exchange_intelligence(NEW.id);
  exception when others then
    -- Swallow errors so the purchase insert is never rolled back.
    -- The mobile client's retry endpoint or a periodic worker job can retry later.
    raise notice 'auto_create_retained_exchange: retention deferred for purchase %', NEW.id;
  end;

  return NEW;
end;
$$;

-- Lock the trigger function to prevent direct execution by non-superusers.
revoke execute on function public.auto_create_retained_exchange() from public;
revoke execute on function public.auto_create_retained_exchange() from anon;
revoke execute on function public.auto_create_retained_exchange() from authenticated;

-- Attach the trigger to marketplace_sync_purchases.
drop trigger if exists trg_auto_create_retained_exchange on public.marketplace_sync_purchases;
create trigger trg_auto_create_retained_exchange
  after insert on public.marketplace_sync_purchases
  for each row
  execute function public.auto_create_retained_exchange();

-- =============================================================================
-- PHASE RETAINED-OI-2 — TRUSTED PURCHASE REVERSAL STATUS
-- =============================================================================
-- Adds a trusted server-side status system to marketplace_sync_purchases so
-- that refunds / reversals / disputes / invalidations / admin revocations can
-- be distinguished from normal temporary-access expiration. Only a
-- service-role worker or the secure security-definer RPC
-- `record_exchange_purchase_reversal` may write the trusted status fields.
-- Normal expiration sets purchase_status = 'expired' but does NOT touch
-- retained exchange intelligence (retained entries are permanent after a
-- valid completed purchase).
-- -----------------------------------------------------------------------------

-- ── 1. Trusted status columns on marketplace_sync_purchases ──
alter table public.marketplace_sync_purchases
  add column if not exists purchase_status text not null default 'completed',
  add column if not exists reversal_reason text,
  add column if not exists reversal_recorded_at timestamptz,
  add column if not exists reversal_recorded_by uuid,
  add column if not exists payment_reference text,
  add column if not exists status_updated_at timestamptz not null default now();

-- Check constraint: only the documented trusted statuses are allowed.
do $$
begin
  if exists (
    select 1 from pg_constraint
      where conname = 'msp_purchase_status_check'
        and conrelid = 'public.marketplace_sync_purchases'::regclass
  ) then
    alter table public.marketplace_sync_purchases drop constraint msp_purchase_status_check;
  end if;
end;
$$;

alter table public.marketplace_sync_purchases
  add constraint msp_purchase_status_check
  check (purchase_status in (
    'completed',
    'expired',
    'refunded',
    'payment_reversed',
    'charged_back',
    'disputed',
    'invalidated',
    'admin_revoked'
  ));

-- Backfill existing rows: active rows stay 'completed'; inactive rows without
-- a recorded reversal reason are treated as 'expired' (normal expiration).
update public.marketplace_sync_purchases
  set purchase_status = case
        when active = true then 'completed'
        else 'expired'
      end,
      status_updated_at = now()
  where purchase_status is null
     or (purchase_status = 'completed' and active = false
           and reversal_reason is null
           and reversal_recorded_at is null);

create index if not exists msp_purchase_status_idx
  on public.marketplace_sync_purchases(purchase_status)
  where purchase_status <> 'completed';

-- ── 2. RLS: NO direct buyer UPDATE on marketplace_sync_purchases ──
-- The mobile client no longer updates this table directly. Normal expiration
-- goes through the mark_purchase_expired RPC (which enforces ownership +
-- actual expiration inside the SECURITY DEFINER body), and reversals go
-- through record_exchange_purchase_reversal (service_role only). Allowing a
-- direct buyer UPDATE would let a buyer set active=false, reset
-- status_updated_at, or attempt to touch a trusted status field even with a
-- WITH CHECK guard — WITH CHECK only validates the post-update row, it does
-- not prevent the buyer from trying to write the trusted columns in the first
-- place. Removing the UPDATE policy entirely is the safe approach: only
-- service_role (bypasses RLS) and the security-definer RPCs may write.
drop policy if exists "msp_self_update" on public.marketplace_sync_purchases;
-- No CREATE POLICY for update. Buyers retain SELECT and INSERT (a new
-- purchase) only.

-- ── 3. Audit table: exchange_purchase_status_audit ──
create table if not exists public.exchange_purchase_status_audit (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.marketplace_sync_purchases(id) on delete cascade,
  previous_status text,
  new_status text not null,
  reason text,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.exchange_purchase_status_audit
  add column if not exists id uuid,
  add column if not exists purchase_id uuid,
  add column if not exists previous_status text,
  add column if not exists new_status text,
  add column if not exists reason text,
  add column if not exists changed_by uuid,
  add column if not exists changed_at timestamptz,
  add column if not exists metadata jsonb;

create index if not exists epsa_purchase_idx
  on public.exchange_purchase_status_audit(purchase_id, changed_at desc);
create index if not exists epsa_new_status_idx
  on public.exchange_purchase_status_audit(new_status)
  where new_status in ('refunded','payment_reversed','charged_back','disputed','invalidated','admin_revoked');

alter table public.exchange_purchase_status_audit enable row level security;

drop policy if exists "epsa_self_select" on public.exchange_purchase_status_audit;
drop policy if exists "epsa_self_insert" on public.exchange_purchase_status_audit;
drop policy if exists "epsa_self_delete" on public.exchange_purchase_status_audit;
drop policy if exists "epsa_self_update" on public.exchange_purchase_status_audit;

create policy "epsa_self_select" on public.exchange_purchase_status_audit
  for select using (
    exists (
      select 1 from public.marketplace_sync_purchases msp
        where msp.id = purchase_id
          and (msp.buyer_id = auth.uid() or msp.vendor_id = auth.uid())
    )
  );

-- ── 4. Secure server function: record_exchange_purchase_reversal ──
create or replace function public.record_exchange_purchase_reversal(
  p_purchase_id uuid,
  p_status text,
  p_reason text,
  p_recorded_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase record;
  v_normalized_status text;
  v_normalized_reason text;
  v_retained_reason text;
  v_deactivated_count integer := 0;
  v_retained_result jsonb;
begin
  v_normalized_status := lower(btrim(coalesce(p_status, '')));
  v_normalized_reason := btrim(coalesce(p_reason, ''));

  if v_normalized_status not in (
    'refunded','payment_reversed','charged_back','disputed','invalidated','admin_revoked'
  ) then
    return jsonb_build_object(
      'ok', false,
      'error', 'invalid_status',
      'message', 'Only refunded, payment_reversed, charged_back, disputed, invalidated, or admin_revoked are accepted.'
    );
  end if;

  v_retained_reason := case v_normalized_status
    when 'refunded' then 'refund'
    when 'payment_reversed' then 'payment_reversal'
    when 'charged_back' then 'chargeback'
    when 'disputed' then 'dispute'
    when 'invalidated' then 'invalid_purchase'
    when 'admin_revoked' then 'admin_revocation'
  end;

  select *
    into v_purchase
    from public.marketplace_sync_purchases
    where id = p_purchase_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'purchase_not_found');
  end if;

  if v_purchase.purchase_status = v_normalized_status
     and v_purchase.reversal_reason is not null
     and v_purchase.reversal_recorded_at is not null then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'purchase_id', p_purchase_id,
      'purchase_status', v_normalized_status,
      'deactivated_count', 0
    );
  end if;

  if v_purchase.purchase_status in (
    'refunded','payment_reversed','charged_back','disputed','invalidated','admin_revoked'
  ) and v_purchase.purchase_status <> v_normalized_status then
    return jsonb_build_object(
      'ok', false,
      'error', 'already_reversed',
      'previous_status', v_purchase.purchase_status,
      'message', 'Purchase already has a recorded reversal status.'
    );
  end if;

  update public.marketplace_sync_purchases
    set purchase_status = v_normalized_status,
        reversal_reason = v_normalized_reason,
        reversal_recorded_at = now(),
        reversal_recorded_by = p_recorded_by,
        active = false,
        status_updated_at = now()
    where id = p_purchase_id;

  insert into public.exchange_purchase_status_audit (
    purchase_id, previous_status, new_status, reason, changed_by, metadata
  ) values (
    p_purchase_id,
    v_purchase.purchase_status,
    v_normalized_status,
    v_normalized_reason,
    p_recorded_by,
    jsonb_build_object(
      'source', 'record_exchange_purchase_reversal',
      'retained_reason', v_retained_reason
    )
  );

  -- Capture the JSONB return value of deactivate_retained_exchange_intelligence
  -- and read deactivated_count out of it. Using PERFORM + GET DIAGNOSTICS
  -- ROW_COUNT here is WRONG: ROW_COUNT after PERFORM reports whether the
  -- function returned a row, not the number of retained entries deactivated
  -- inside it. Reading the returned JSONB is the accurate source of truth.
  begin
    select public.deactivate_retained_exchange_intelligence(
             p_purchase_id, v_retained_reason
           ) into v_retained_result;
    v_deactivated_count := coalesce(
      (v_retained_result ->> 'deactivated_count')::integer, 0
    );
  exception when others then
    raise notice 'record_exchange_purchase_reversal: retained deactivation deferred for purchase %', p_purchase_id;
    v_deactivated_count := 0;
  end;

  return jsonb_build_object(
    'ok', true,
    'skipped', false,
    'purchase_id', p_purchase_id,
    'purchase_status', v_normalized_status,
    'reversal_reason', v_normalized_reason,
    'deactivated_count', v_deactivated_count
  );
end;
$$;

revoke execute on function public.record_exchange_purchase_reversal(uuid, text, text, uuid) from public;
revoke execute on function public.record_exchange_purchase_reversal(uuid, text, text, uuid) from anon;
revoke execute on function public.record_exchange_purchase_reversal(uuid, text, text, uuid) from authenticated;
grant execute on function public.record_exchange_purchase_reversal(uuid, text, text, uuid) to service_role;

-- ── 5. Normal expiration helper: mark_purchase_expired ──
-- SECURITY: This function is SECURITY DEFINER and granted to authenticated,
-- so every authorization check MUST live inside the function body. We verify
-- (1) auth.uid() is not null, (2) the purchase belongs to the caller
-- (buyer_id = auth.uid()), and (3) the temporary access has actually expired
-- (expires_at <= now()). Without these checks an authenticated user could mark
-- ANY other user's purchase expired, or mark their own purchase expired before
-- its access window ended. The mobile query is convenience only — the function
-- is the trusted source of truth.
create or replace function public.mark_purchase_expired(p_purchase_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_purchase record;
begin
  -- ── 1. Require an authenticated caller ──
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- ── 2. Lock the purchase row owned by THIS caller only ──
  -- Selecting with buyer_id = auth.uid() prevents cross-user expiration. A
  -- caller supplying another user's purchase UUID gets the same
  -- not_found_or_forbidden response as a missing UUID (no information leak).
  select purchase_status, active, expires_at
    into v_purchase
    from public.marketplace_sync_purchases
    where id = p_purchase_id
      and buyer_id = v_caller
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'purchase_not_found_or_forbidden');
  end if;

  -- ── 3. Refuse to overwrite a recorded reversal ──
  if v_purchase.purchase_status in (
    'refunded','payment_reversed','charged_back','disputed','invalidated','admin_revoked'
  ) then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'purchase_id', p_purchase_id,
      'purchase_status', v_purchase.purchase_status
    );
  end if;

  -- ── 4. Idempotency: already expired ──
  if v_purchase.purchase_status = 'expired' then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'purchase_id', p_purchase_id,
      'purchase_status', 'expired'
    );
  end if;

  -- ── 5. Require actual expiration ──
  -- The temporary 1-5 day Exchange access must have actually ended before we
  -- record the trusted 'expired' status. This blocks premature expiration.
  if v_purchase.expires_at > now() then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_yet_expired',
      'purchase_id', p_purchase_id,
      'expires_at', v_purchase.expires_at
    );
  end if;

  -- ── 6. Record the trusted 'expired' status ──
  update public.marketplace_sync_purchases
    set purchase_status = 'expired',
        active = false,
        status_updated_at = now()
    where id = p_purchase_id;

  insert into public.exchange_purchase_status_audit (
    purchase_id, previous_status, new_status, reason, changed_by, metadata
  ) values (
    p_purchase_id,
    v_purchase.purchase_status,
    'expired',
    'normal_expiration',
    v_caller,
    jsonb_build_object('source', 'mark_purchase_expired')
  );

  -- NOTE: retained exchange intelligence is intentionally NOT deactivated.
  -- Retained entries are permanent after a valid completed purchase.

  return jsonb_build_object(
    'ok', true,
    'skipped', false,
    'purchase_id', p_purchase_id,
    'purchase_status', 'expired'
  );
end;
$$;

-- Permissions: mark_purchase_expired is executable by authenticated users
-- (the mobile client calls it during expireSyncs). It is safe to grant to
-- authenticated because every authorization check (auth.uid, buyer_id, and
-- expires_at) is enforced INSIDE the SECURITY DEFINER body. anon and public
-- cannot execute it.
revoke execute on function public.mark_purchase_expired(uuid) from public;
revoke execute on function public.mark_purchase_expired(uuid) from anon;
revoke execute on function public.mark_purchase_expired(uuid) from authenticated;
grant execute on function public.mark_purchase_expired(uuid) to service_role;
grant execute on function public.mark_purchase_expired(uuid) to authenticated;

-- =============================================================================
-- PHASE SOCIAL-VERIFICATION-1 — EAGOH SOCIAL SHARE VERIFICATION SYSTEM
-- =============================================================================
-- Allows a user to share one of their EAGOHs on social media and verify the
-- post is real. Verified shares award 5 Neurons and progress toward badges.
-- Only the secure server-side worker may award rewards. The mobile client
-- cannot directly mark a share verified, increase counts, award Neurons, or
-- unlock badges. All reward logic lives in the security-definer RPC
-- `award_social_share_reward`.
-- -----------------------------------------------------------------------------

-- ── 1. Add verified_share_count column to profiles ──
alter table public.profiles
  add column if not exists verified_share_count int not null default 0;

-- ── 2. social_share_attempts table ──
create table if not exists public.social_share_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  eagoh_id uuid not null references public.eagohs(id) on delete cascade,
  verification_code text not null,
  public_eagoh_url text not null,
  share_content_snapshot text not null,
  status text not null default 'share_created'
    check (status in (
      'share_created',
      'verification_pending',
      'verified',
      'manual_review',
      'rejected',
      'already_verified',
      'expired'
    )),
  platform text,
  submitted_post_url text,
  submitted_post_url_normalized text,
  verified_at timestamptz,
  reward_awarded boolean not null default false,
  reward_amount int not null default 0,
  verification_attempted_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

alter table public.social_share_attempts
  add column if not exists id uuid,
  add column if not exists user_id uuid,
  add column if not exists eagoh_id uuid,
  add column if not exists verification_code text,
  add column if not exists public_eagoh_url text,
  add column if not exists share_content_snapshot text,
  add column if not exists status text,
  add column if not exists platform text,
  add column if not exists submitted_post_url text,
  add column if not exists submitted_post_url_normalized text,
  add column if not exists verified_at timestamptz,
  add column if not exists reward_awarded boolean,
  add column if not exists reward_amount integer,
  add column if not exists verification_attempted_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists created_at timestamptz,
  add column if not exists expires_at timestamptz;

-- Unique constraint: verification_code must be unique (case-insensitive).
create unique index if not exists ssa_verification_code_uniq
  on public.social_share_attempts(lower(verification_code));

-- Unique constraint: one verified post URL per attempt (prevents the same
-- social post URL from being verified twice across ALL users). Only enforced
-- for verified rows so that failed/rejected attempts don't block retries.
create unique index if not exists ssa_verified_url_uniq
  on public.social_share_attempts(submitted_post_url_normalized)
  where status = 'verified' and submitted_post_url_normalized is not null;

create index if not exists ssa_user_idx
  on public.social_share_attempts(user_id, created_at desc);
create index if not exists ssa_eagoh_idx
  on public.social_share_attempts(eagoh_id);
create index if not exists ssa_status_idx
  on public.social_share_attempts(status) where status in ('share_created','verification_pending');

alter table public.social_share_attempts enable row level security;

drop policy if exists "ssa_self_select" on public.social_share_attempts;
drop policy if exists "ssa_self_insert" on public.social_share_attempts;
drop policy if exists "ssa_self_update" on public.social_share_attempts;
drop policy if exists "ssa_self_delete" on public.social_share_attempts;

-- Buyers may only read their own attempts. No client insert/update/delete.
-- Only service_role (bypasses RLS) or the security-definer RPCs may write.
create policy "ssa_self_select" on public.social_share_attempts
  for select using (auth.uid() = user_id);

-- ── 3. Secure DB function: award_social_share_reward ──
-- SECURITY DEFINER, service_role only. Called by the worker AFTER the worker
-- has verified the public post URL contains the EAGOH URL and verification
-- code. Locks the attempt row, checks not already rewarded, checks not
-- expired, awards 5 Neurons (edge_purchased), increments
-- verified_share_count, logs an edge_transaction, and sets status = verified.
-- Idempotent: re-calling on an already-verified attempt returns skipped=true.
create or replace function public.award_social_share_reward(
  p_attempt_id uuid,
  p_post_url text,
  p_post_url_normalized text,
  p_platform text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt record;
  v_profile record;
  v_reward int := 5;
  v_next_purchased int;
  v_next_count int;
begin
  -- Lock the attempt row
  select * into v_attempt
    from public.social_share_attempts
    where id = p_attempt_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'attempt_not_found');
  end if;

  -- Idempotency: already rewarded
  if v_attempt.reward_awarded = true or v_attempt.status = 'verified' then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'attempt_id', p_attempt_id,
      'message', 'Reward already awarded for this attempt.'
    );
  end if;

  -- Check not expired
  if v_attempt.expires_at <= now() then
    update public.social_share_attempts
      set status = 'expired',
          verification_attempted_at = now()
      where id = p_attempt_id;
    return jsonb_build_object('ok', false, 'error', 'code_expired');
  end if;

  -- Check the same normalized URL hasn't already been verified by another attempt
  if exists (
    select 1 from public.social_share_attempts
      where submitted_post_url_normalized = p_post_url_normalized
        and status = 'verified'
        and id <> p_attempt_id
  ) then
    update public.social_share_attempts
      set status = 'already_verified',
          submitted_post_url = p_post_url,
          submitted_post_url_normalized = p_post_url_normalized,
          verification_attempted_at = now()
      where id = p_attempt_id;
    return jsonb_build_object('ok', false, 'error', 'already_verified');
  end if;

  -- Lock the profile row
  select edge_subscription, edge_purchased, verified_share_count
    into v_profile
    from public.profiles
    where id = v_attempt.user_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'profile_not_found');
  end if;

  -- Award 5 Neurons to edge_purchased
  v_next_purchased := (v_profile.edge_purchased ?? 0) + v_reward;
  v_next_count := (v_profile.verified_share_count ?? 0) + 1;

  update public.profiles
    set edge_purchased = v_next_purchased,
        verified_share_count = v_next_count,
        updated_at = now()
    where id = v_attempt.user_id;

  -- Log the edge transaction
  insert into public.edge_transactions (
    user_id, kind, reason, amount, bucket,
    from_subscription, from_purchased,
    balance_subscription_after, balance_purchased_after, note
  ) values (
    v_attempt.user_id,
    'addition',
    'social_share_reward',
    v_reward,
    'purchased',
    0,
    0,
    v_profile.edge_subscription ?? 0,
    v_next_purchased,
    'Social share verification reward (EAGOH ' || v_attempt.eagoh_id::text || ')'
  );

  -- Update the attempt
  update public.social_share_attempts
    set status = 'verified',
        submitted_post_url = p_post_url,
        submitted_post_url_normalized = p_post_url_normalized,
        platform = p_platform,
        verified_at = now(),
        verification_attempted_at = now(),
        reward_awarded = true,
        reward_amount = v_reward
    where id = p_attempt_id;

  return jsonb_build_object(
    'ok', true,
    'skipped', false,
    'attempt_id', p_attempt_id,
    'reward_amount', v_reward,
    'new_verified_share_count', v_next_count,
    'new_edge_purchased', v_next_purchased
  );
end;
$$;

revoke execute on function public.award_social_share_reward(uuid, text, text, text) from public;
revoke execute on function public.award_social_share_reward(uuid, text, text, text) from anon;
revoke execute on function public.award_social_share_reward(uuid, text, text, text) from authenticated;
grant execute on function public.award_social_share_reward(uuid, text, text, text) to service_role;

-- ── 4. Secure DB function: create_social_share_attempt ──
-- SECURITY DEFINER, service_role only. Called by the worker to create a new
-- share attempt with a unique verification code. Idempotent: the worker
-- generates the code and passes it in; the unique index prevents duplicates.
create or replace function public.create_social_share_attempt(
  p_user_id uuid,
  p_eagoh_id uuid,
  p_verification_code text,
  p_public_eagoh_url text,
  p_share_content_snapshot text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_expires_at timestamptz;
begin
  -- Verify the EAGOH belongs to the user
  if not exists (
    select 1 from public.eagohs
      where id = p_eagoh_id and user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'eagoh_not_owned');
  end if;

  v_expires_at := now() + interval '7 days';

  insert into public.social_share_attempts (
    user_id, eagoh_id, verification_code,
    public_eagoh_url, share_content_snapshot,
    status, expires_at
  ) values (
    p_user_id, p_eagoh_id, p_verification_code,
    p_public_eagoh_url, p_share_content_snapshot,
    'share_created', v_expires_at
  )
  returning id into v_attempt_id;

  return jsonb_build_object(
    'ok', true,
    'attempt_id', v_attempt_id,
    'verification_code', p_verification_code,
    'expires_at', v_expires_at
  );
end;
$$;

revoke execute on function public.create_social_share_attempt(uuid, uuid, text, text, text) from public;
revoke execute on function public.create_social_share_attempt(uuid, uuid, text, text, text) from anon;
revoke execute on function public.create_social_share_attempt(uuid, uuid, text, text, text) from authenticated;
grant execute on function public.create_social_share_attempt(uuid, uuid, text, text, text) to service_role;

-- ── 5. Secure DB function: update_share_attempt_status ──
-- SECURITY DEFINER, service_role only. Updates the status of a share attempt
-- (used for manual_review, rejected, verification_pending, already_verified).
create or replace function public.update_share_attempt_status(
  p_attempt_id uuid,
  p_status text,
  p_post_url text,
  p_post_url_normalized text,
  p_platform text,
  p_rejection_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.social_share_attempts
    set status = p_status,
        submitted_post_url = p_post_url,
        submitted_post_url_normalized = p_post_url_normalized,
        platform = p_platform,
        rejection_reason = p_rejection_reason,
        verification_attempted_at = now()
    where id = p_attempt_id;

  return jsonb_build_object('ok', true, 'attempt_id', p_attempt_id, 'status', p_status);
end;
$$;

revoke execute on function public.update_share_attempt_status(uuid, text, text, text, text, text) from public;
revoke execute on function public.update_share_attempt_status(uuid, text, text, text, text, text) from anon;
revoke execute on function public.update_share_attempt_status(uuid, text, text, text, text, text) from authenticated;
grant execute on function public.update_share_attempt_status(uuid, text, text, text, text, text) to service_role;
