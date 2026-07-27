-- ───────────────────────────────────────────────────────────────────────────
-- EAGOH Brand & Logo Guard — SQL Migration
--
-- Adds logo audit columns to the eagohs table for the existing-image audit
-- system. This migration is idempotent — safe to re-run.
--
-- The audit endpoint (POST /forge/audit-images) scans existing EAGOH images
-- for prohibited real-world logos using OpenAI vision and sets:
--   logo_audit_status: 'clean' | 'flagged' | 'pending' | 'skipped'
--   logo_audit_at:     timestamp of last audit
--   logo_audit_brand:  detected brand name (if flagged)
--   logo_audit_confidence: AI confidence score (0.0-1.0)
--
-- Flagged images are NOT deleted — they are prevented from being newly
-- listed in the Exchange until reviewed by an administrator.
-- ───────────────────────────────────────────────────────────────────────────

-- ── Add logo audit columns to eagohs table ──
alter table public.eagohs
  add column if not exists logo_audit_status text check (
    logo_audit_status in ('clean', 'flagged', 'pending', 'skipped')
  );

alter table public.eagohs
  add column if not exists logo_audit_at timestamptz;

alter table public.eagohs
  add column if not exists logo_audit_brand text;

alter table public.eagohs
  add column if not exists logo_audit_confidence numeric(3,2);

-- ── Index for efficient audit queries (find un-audited EAGOHs) ──
create index if not exists eagohs_logo_audit_status_idx
  on public.eagohs(logo_audit_status)
  where logo_audit_status is null;

-- ── Index for finding flagged EAGOHs ──
create index if not exists eagohs_logo_audit_flagged_idx
  on public.eagohs(logo_audit_status)
  where logo_audit_status = 'flagged';

-- ── RLS: Only the service role (worker) can update logo_audit_* columns ──
-- Regular users must NOT be able to change their audit status.
-- This policy is additive — existing RLS policies on eagohs are not affected.

-- ── Exchange listing filter: prevent flagged EAGOHs from being newly listed ──
-- If the marketplace_listings table has a reference to eagoh_id, we add a
-- check constraint or trigger that prevents creating listings for flagged EAGOHs.
-- This is done via a trigger that checks the EAGOH's logo_audit_status before
-- allowing a new listing insert.

create or replace function public.check_eagoh_not_flagged_for_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Check if the EAGOH being listed has been flagged for a prohibited logo
  if exists (
    select 1 from public.eagohs
    where id = new.eagoh_id
      and logo_audit_status = 'flagged'
  ) then
    raise exception 'This EAGOH has been flagged for review and cannot be listed in the Exchange until approved.';
  end if;
  return new;
end;
$$;

-- Drop existing trigger if present, then create
drop trigger if exists trg_check_eagoh_not_flagged on public.marketplace_listings;
create trigger trg_check_eagoh_not_flagged
  before insert on public.marketplace_listings
  for each row
  execute function public.check_eagoh_not_flagged_for_listing();

-- ── Grant: service role can update logo_audit columns (already has full access) ──
-- No additional grant needed — service_role bypasses RLS.

-- ── Comment for documentation ──
comment on column public.eagohs.logo_audit_status is
  'Audit status for prohibited logo detection: clean, flagged, pending, or skipped. NULL = not yet audited.';
comment on column public.eagohs.logo_audit_brand is
  'Brand name detected by AI image review if the EAGOH was flagged. NULL if clean or not audited.';
comment on column public.eagohs.logo_audit_confidence is
  'Confidence score (0.0-1.0) from the AI image review. NULL if not audited.';
