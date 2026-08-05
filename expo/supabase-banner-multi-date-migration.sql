-- =============================================================================
-- Banner Multi-Date + Listing Link Migration
--
-- Adds:
--   1. booking_dates date[]  — exact list of booked promotion dates (nonconsecutive)
--   2. listing_id uuid       — links a banner to a specific Exchange listing
--
-- Backward compatibility:
--   - start_date / end_date are still set (min / max of booking_dates) so the
--     existing active-banner range query continues to work.
--   - Legacy banners with NULL booking_dates are treated as active for the
--     full start_date..end_date range.
-- =============================================================================

-- ── sponsored_banners ──
alter table public.sponsored_banners
  add column if not exists booking_dates date[];

alter table public.sponsored_banners
  add column if not exists listing_id uuid;

-- Foreign key for listing_id (separate statement so it doesn't fail if the column already existed without the constraint)
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'sb_listing_id_fkey'
      and table_name = 'sponsored_banners'
      and table_schema = 'public'
  ) then
    alter table public.sponsored_banners
      add constraint sb_listing_id_fkey
      foreign key (listing_id) references public.marketplace_listings(id) on delete set null;
  end if;
end $$;

-- Index for listing_id lookups
create index if not exists sb_listing_id_idx on public.sponsored_banners(listing_id) where listing_id is not null;

-- GIN index for booking_dates array containment queries
create index if not exists sb_booking_dates_gin_idx on public.sponsored_banners using gin (booking_dates) where active = true;

-- ── banner_purchases ──
alter table public.banner_purchases
  add column if not exists booking_dates date[];

alter table public.banner_purchases
  add column if not exists listing_id uuid;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'bp_listing_id_fkey'
      and table_name = 'banner_purchases'
      and table_schema = 'public'
  ) then
    alter table public.banner_purchases
      add constraint bp_listing_id_fkey
      foreign key (listing_id) references public.marketplace_listings(id) on delete set null;
  end if;
end $$;

-- ── Backfill booking_dates for existing banners ──
-- For legacy banners that don't have booking_dates set, generate the array
-- from start_date..end_date so they continue to work with the new logic.
update public.sponsored_banners
  set booking_dates = (
    select array_agg(d::date)
    from generate_series(
      start_date,
      end_date,
      interval '1 day'
    ) as d
  )
  where booking_dates is null
    and start_date is not null
    and end_date is not null;

update public.banner_purchases
  set booking_dates = (
    select array_agg(d::date)
    from generate_series(
      start_date,
      (start_date::date + (days - 1))::date,
      interval '1 day'
    ) as d
  )
  where booking_dates is null
    and start_date is not null
    and days is not null;
