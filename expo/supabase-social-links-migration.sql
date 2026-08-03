-- ────────────────────────────────────────────────────────────────────────────
-- Social Links Migration — profile_social_links table + RLS policies
--
-- Stores user social media profile URLs for display on public profiles.
-- Each row is one platform link (one row per platform per user).
-- Separate from social-share verification and user_social_accounts.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. Table ──────────────────────────────────────────────────────────────

create table if not exists public.profile_social_links (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null,
  platform    text        not null,
  profile_url text        not null,
  display_order integer   not null default 0,
  is_visible  boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profile_social_links_user_platform_unique unique (user_id, platform),
  constraint profile_social_links_platform_check
    check (platform in (
      'x', 'instagram', 'facebook', 'threads', 'tiktok',
      'youtube', 'linkedin', 'twitch', 'reddit', 'snapchat',
      'pinterest', 'discord', 'website'
    ))
);

-- ── 2. Foreign Key ────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'profile_social_links_user_id_fkey'
      and table_name = 'profile_social_links'
  ) then
    alter table public.profile_social_links
      add constraint profile_social_links_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

-- ── 3. Indexes ────────────────────────────────────────────────────────────

create index if not exists idx_profile_social_links_user_id
  on public.profile_social_links(user_id);

create index if not exists idx_profile_social_links_visible
  on public.profile_social_links(user_id, is_visible);

-- ── 4. Row Level Security ─────────────────────────────────────────────────

alter table public.profile_social_links enable row level security;

-- Public read: anyone may read rows where is_visible = true
drop policy if exists "profile_social_links_public_read"
  on public.profile_social_links;

create policy "profile_social_links_public_read"
  on public.profile_social_links
  for select
  using (is_visible = true);

-- Owner insert: auth.uid() = user_id
drop policy if exists "profile_social_links_owner_insert"
  on public.profile_social_links;

create policy "profile_social_links_owner_insert"
  on public.profile_social_links
  for insert
  with check (auth.uid() = user_id);

-- Owner update: auth.uid() = user_id
drop policy if exists "profile_social_links_owner_update"
  on public.profile_social_links;

create policy "profile_social_links_owner_update"
  on public.profile_social_links
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Owner delete: auth.uid() = user_id
drop policy if exists "profile_social_links_owner_delete"
  on public.profile_social_links;

create policy "profile_social_links_owner_delete"
  on public.profile_social_links
  for delete
  using (auth.uid() = user_id);

-- ── 5. updated_at trigger ─────────────────────────────────────────────────

drop trigger if exists trg_profile_social_links_updated_at
  on public.profile_social_links;

create or replace function public.set_profile_social_links_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profile_social_links_updated_at
  before update on public.profile_social_links
  for each row
  execute function public.set_profile_social_links_updated_at();
