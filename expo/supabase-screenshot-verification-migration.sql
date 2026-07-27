-- ═══════════════════════════════════════════════════════════════════════
-- EAGOH AI Screenshot Verification Migration
-- ═══════════════════════════════════════════════════════════════════════
-- Adds screenshot storage columns to social_share_attempts, creates a
-- private storage bucket for screenshots, and updates the award RPC to
-- accept screenshot-based verification fields.
--
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query).
-- All statements are idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Add screenshot verification columns to social_share_attempts ──────
alter table public.social_share_attempts
  add column if not exists screenshot_storage_path text,
  add column if not exists screenshot_hash text,
  add column if not exists detected_platform text,
  add column if not exists detected_handle text,
  add column if not exists verification_confidence numeric,
  add column if not exists ai_is_valid boolean,
  add column if not exists ai_failure_reason text,
  add column if not exists eagoh_card_detected boolean,
  add column if not exists published_post_interface_detected boolean,
  add column if not exists verification_code_detected text,
  add column if not exists verification_code_matches boolean,
  add column if not exists optional_post_url text,
  add column if not exists verified_at timestamptz;

-- Index for duplicate screenshot hash detection
create index if not exists ssa_screenshot_hash_idx
  on public.social_share_attempts(screenshot_hash)
  where screenshot_hash is not null;

-- ── 2. Private storage bucket for screenshots ───────────────────────────
-- Private bucket — only authenticated users can upload (to their own path)
-- and only service_role can read for AI verification.
insert into storage.buckets (id, name, public)
  values ('share-screenshots', 'share-screenshots', false)
  on conflict (id) do nothing;

-- Upload policy: authenticated users can upload to their own subfolder
drop policy if exists "ss_uploader_insert" on storage.objects;
create policy "ss_uploader_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'share-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Read policy: users can read their own screenshots
drop policy if exists "ss_uploader_select" on storage.objects;
create policy "ss_uploader_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'share-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete policy: users can delete their own screenshots
drop policy if exists "ss_uploader_delete" on storage.objects;
create policy "ss_uploader_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'share-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Note: service_role bypasses RLS entirely, so the backend worker can
-- read any screenshot for AI verification without an explicit policy.

-- ── 3. Updated award_social_share_reward with screenshot fields ─────────
-- Replaces the existing function to accept screenshot-based verification
-- parameters. The old URL-only parameters remain for backward compat.
create or replace function public.award_social_share_reward(
  p_attempt_id uuid,
  p_post_url text default null,
  p_post_url_normalized text default null,
  p_platform text default null,
  p_screenshot_storage_path text default null,
  p_screenshot_hash text default null,
  p_detected_platform text default null,
  p_detected_handle text default null,
  p_verification_confidence numeric default null,
  p_ai_is_valid boolean default false,
  p_ai_failure_reason text default null,
  p_eagoh_card_detected boolean default false,
  p_published_post_interface_detected boolean default false,
  p_verification_code_detected text default null,
  p_verification_code_matches boolean default false
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
  -- (only when a post URL was submitted)
  if p_post_url_normalized is not null then
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
  end if;

  -- Check for duplicate screenshot hash (same image already verified)
  if p_screenshot_hash is not null then
    if exists (
      select 1 from public.social_share_attempts
        where screenshot_hash = p_screenshot_hash
          and status = 'verified'
          and id <> p_attempt_id
    ) then
      update public.social_share_attempts
        set status = 'already_verified',
            screenshot_storage_path = p_screenshot_storage_path,
            screenshot_hash = p_screenshot_hash,
            verification_attempted_at = now(),
            rejection_reason = 'duplicate_screenshot'
        where id = p_attempt_id;
      return jsonb_build_object('ok', false, 'error', 'already_verified');
    end if;
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

  -- Update the attempt with all verification fields
  update public.social_share_attempts
    set status = 'verified',
        submitted_post_url = p_post_url,
        submitted_post_url_normalized = p_post_url_normalized,
        platform = p_platform,
        verified_at = now(),
        verification_attempted_at = now(),
        reward_awarded = true,
        reward_amount = v_reward,
        screenshot_storage_path = p_screenshot_storage_path,
        screenshot_hash = p_screenshot_hash,
        detected_platform = p_detected_platform,
        detected_handle = p_detected_handle,
        verification_confidence = p_verification_confidence,
        ai_is_valid = p_ai_is_valid,
        ai_failure_reason = p_ai_failure_reason,
        eagoh_card_detected = p_eagoh_card_detected,
        published_post_interface_detected = p_published_post_interface_detected,
        verification_code_detected = p_verification_code_detected,
        verification_code_matches = p_verification_code_matches,
        optional_post_url = p_post_url
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

revoke execute on function public.award_social_share_reward(uuid, text, text, text, text, text, text, text, numeric, boolean, text, boolean, boolean, text, boolean) from public;
revoke execute on function public.award_social_share_reward(uuid, text, text, text, text, text, text, text, numeric, boolean, text, boolean, boolean, text, boolean) from anon;
revoke execute on function public.award_social_share_reward(uuid, text, text, text, text, text, text, text, numeric, boolean, text, boolean, boolean, text, boolean) from authenticated;
grant execute on function public.award_social_share_reward(uuid, text, text, text, text, text, text, text, numeric, boolean, text, boolean, boolean, text, boolean) to service_role;


-- ── 4. Updated update_share_attempt_status with screenshot fields ──────
-- Allows the worker to record screenshot verification metadata on rejection.
create or replace function public.update_share_attempt_status(
  p_attempt_id uuid,
  p_status text,
  p_post_url text default null,
  p_post_url_normalized text default null,
  p_platform text default null,
  p_rejection_reason text default null,
  p_screenshot_storage_path text default null,
  p_screenshot_hash text default null,
  p_detected_platform text default null,
  p_detected_handle text default null,
  p_verification_confidence numeric default null,
  p_ai_failure_reason text default null,
  p_eagoh_card_detected boolean default null,
  p_published_post_interface_detected boolean default null,
  p_verification_code_detected text default null,
  p_verification_code_matches boolean default null
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
        verification_attempted_at = now(),
        screenshot_storage_path = coalesce(p_screenshot_storage_path, screenshot_storage_path),
        screenshot_hash = coalesce(p_screenshot_hash, screenshot_hash),
        detected_platform = coalesce(p_detected_platform, detected_platform),
        detected_handle = coalesce(p_detected_handle, detected_handle),
        verification_confidence = coalesce(p_verification_confidence, verification_confidence),
        ai_failure_reason = coalesce(p_ai_failure_reason, ai_failure_reason),
        eagoh_card_detected = coalesce(p_eagoh_card_detected, eagoh_card_detected),
        published_post_interface_detected = coalesce(p_published_post_interface_detected, published_post_interface_detected),
        verification_code_detected = coalesce(p_verification_code_detected, verification_code_detected),
        verification_code_matches = coalesce(p_verification_code_matches, verification_code_matches)
    where id = p_attempt_id;

  return jsonb_build_object('ok', true, 'attempt_id', p_attempt_id, 'status', p_status);
end;
$$;

revoke execute on function public.update_share_attempt_status(uuid, text, text, text, text, text, text, text, text, text, numeric, text, boolean, boolean, text, boolean) from public;
revoke execute on function public.update_share_attempt_status(uuid, text, text, text, text, text, text, text, text, text, numeric, text, boolean, boolean, text, boolean) from anon;
revoke execute on function public.update_share_attempt_status(uuid, text, text, text, text, text, text, text, text, text, numeric, text, boolean, boolean, text, boolean) from authenticated;
grant execute on function public.update_share_attempt_status(uuid, text, text, text, text, text, text, text, text, text, numeric, text, boolean, boolean, text, boolean) to service_role;
