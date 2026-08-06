-- ─────────────────────────────────────────────────────────────────────────────
-- Sponsored Banner EAGOH Image Visibility — RLS Policy Migration
--
-- Problem: The eagohs_marketplace_select RLS policy only allows reading
-- EAGOHs that have an active marketplace listing. Sponsored banner queries
-- use an !inner join on eagohs, so if RLS blocks the EAGOH read, the entire
-- banner row is silently dropped — no banner appears, or if the banner
-- purchaser is the current user, the row survives via eagohs_self_select
-- but other users' banner EAGOHs without listings vanish.
--
-- Fix: Add a read-only policy that allows any authenticated user to SELECT
-- EAGOHs that have an active sponsored banner. This is the same pattern as
-- eagohs_marketplace_select but for sponsored_banners.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "eagohs_sponsored_banner_select" on public.eagohs;

create policy "eagohs_sponsored_banner_select" on public.eagohs
  for select using (
    exists (
      select 1 from public.sponsored_banners sb
      where sb.eagoh_id = eagohs.id
        and sb.active = true
    )
  );
