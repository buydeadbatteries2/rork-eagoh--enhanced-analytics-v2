-- =============================================================================
-- EAGOH Social Share Reward Fix — Complete Idempotent Migration
-- =============================================================================
-- ROOT CAUSE:
--   The award_social_share_reward function uses the PostgreSQL `??` operator
--   for null coalescing: (v_profile.edge_purchased ?? 0) + v_reward
--
--   But `??` is the JSONB key-existence operator, NOT a null-coalescing
--   operator. Since edge_purchased, edge_subscription, and verified_share_count
--   are integer columns (not jsonb), PostgreSQL raises:
--
--     SQLSTATE: 42883
--     ERROR: operator does not exist: integer ?? integer
--     HINT: No operator matches the given name and argument types.
--           You might need to add explicit type casts.
--
--   This crash happens AFTER AI verification succeeds, during the reward
--   transaction, producing the user-facing error:
--     "Verification completed but the reward could not be awarded."
--
--   The same bug class was fixed in the OI migration (supabase-oi-fix-migration.sql).
--
-- FIX:
--   Replace all `??` with COALESCE() — the standard SQL null-coalescing function.
--   Also add: idempotency via ledger reason+amount uniqueness check, partial
--   recovery for verified-but-unrewarded attempts, and proper error codes.
--
-- This migration is fully idempotent — safe to run multiple times.
-- =============================================================================

-- ── 1. Ensure all screenshot verification columns exist ───────────────────
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

-- Ensure verified_share_count exists on profiles
alter table public.profiles
  add column if not exists verified_share_count int not null default 0;

-- ── 2. Private storage bucket for screenshots ─────────────────────────────
insert into storage.buckets (id, name, public)
  values ('share-screenshots', 'share-screenshots', false)
  on conflict (id) do nothing;

drop policy if exists "ss_uploader_insert" on storage.objects;
create policy "ss_uploader_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'share-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "ss_uploader_select" on storage.objects;
create policy "ss_uploader_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'share-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "ss_uploader_delete" on storage.objects;
create policy "ss_uploader_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'share-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── 3. Replace award_social_share_reward — atomic, idempotent, COALESCE ──
-- Drops any existing overloads first to ensure one authoritative signature.
drop function if exists public.award_social_share_reward(uuid, text, text, text);
drop function if exists public.award_social_share_reward(uuid, text, text, text, text, text, text, text, numeric, boolean, text, boolean, boolean, text, boolean);

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
  v_ledger_exists boolean;
begin
  -- 1. Lock the attempt row
  select * into v_attempt
    from public.social_share_attempts
    where id = p_attempt_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'SHARE_ATTEMPT_NOT_FOUND');
  end if;

  -- 2. Idempotency: already verified AND rewarded
  if v_attempt.reward_awarded = true and v_attempt.status = 'verified' then
    -- Check if ledger entry exists (fully completed)
    select exists(
      select 1 from public.edge_transactions
        where user_id = v_attempt.user_id
          and reason = 'social_share_reward'
          and amount = v_reward
          and bucket = 'purchased'
          and (note like '%(' || v_attempt.eagoh_id::text || ')%')
    ) into v_ledger_exists;

    if v_ledger_exists then
      return jsonb_build_object(
        'ok', true,
        'skipped', true,
        'attempt_id', p_attempt_id,
        'message', 'Reward already awarded for this attempt.',
        'reward_amount', v_attempt.reward_amount,
        'new_verified_share_count', null,
        'new_edge_purchased', null
      );
    end if;
    -- Fall through to recovery (verified but ledger missing)
  end if;

  -- 3. Idempotency: status verified but reward not awarded (partial — recover)
  if v_attempt.status = 'verified' and v_attempt.reward_awarded = false then
    -- Check if a ledger entry already exists for this attempt
    select exists(
      select 1 from public.edge_transactions
        where user_id = v_attempt.user_id
          and reason = 'social_share_reward'
          and amount = v_reward
          and bucket = 'purchased'
          and (note like '%(' || v_attempt.eagoh_id::text || ')%')
    ) into v_ledger_exists;

    if v_ledger_exists then
      -- Ledger exists but reward_awarded was not set — fix the flag
      update public.social_share_attempts
        set reward_awarded = true,
            reward_amount = v_reward
        where id = p_attempt_id;
      return jsonb_build_object(
        'ok', true,
        'skipped', true,
        'attempt_id', p_attempt_id,
        'message', 'Reward already awarded for this attempt.',
        'reward_amount', v_reward
      );
    end if;
    -- No ledger entry — proceed to grant the missing reward (recovery)
  end if;

  -- 4. Check not expired
  if v_attempt.expires_at <= now() then
    update public.social_share_attempts
      set status = 'expired',
          verification_attempted_at = now()
      where id = p_attempt_id;
    return jsonb_build_object('ok', false, 'error', 'SHARE_CODE_EXPIRED');
  end if;

  -- 5. Check the same normalized URL hasn't already been verified by another attempt
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
      return jsonb_build_object('ok', false, 'error', 'SHARE_ALREADY_REWARDED');
    end if;
  end if;

  -- 6. Check for duplicate screenshot hash
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
      return jsonb_build_object('ok', false, 'error', 'SHARE_ALREADY_REWARDED');
    end if;
  end if;

  -- 7. Lock the profile row
  select edge_subscription, edge_purchased, verified_share_count
    into v_profile
    from public.profiles
    where id = v_attempt.user_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'SHARE_SCHEMA_ERROR', 'detail', 'profile_not_found');
  end if;

  -- 8. Award 5 Neurons to edge_purchased (COALESCE — NOT ??)
  v_next_purchased := COALESCE(v_profile.edge_purchased, 0) + v_reward;
  v_next_count := COALESCE(v_profile.verified_share_count, 0) + 1;

  -- 9. Update profile balance and verified share count
  update public.profiles
    set edge_purchased = v_next_purchased,
        verified_share_count = v_next_count,
        updated_at = now()
    where id = v_attempt.user_id;

  -- 10. Insert the reward ledger transaction (idempotency key via note)
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
    COALESCE(v_profile.edge_subscription, 0),
    v_next_purchased,
    'Social share verification reward (EAGOH ' || v_attempt.eagoh_id::text || ')'
  );

  -- 11. Update the attempt with all verification fields and mark rewarded
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

  -- 12. Return success
  return jsonb_build_object(
    'ok', true,
    'skipped', false,
    'attempt_id', p_attempt_id,
    'reward_amount', v_reward,
    'new_verified_share_count', v_next_count,
    'new_edge_purchased', v_next_purchased
  );

exception
  when others then
    -- Return a safe error with SQLSTATE for server logs
    return jsonb_build_object(
      'ok', false,
      'error', 'SHARE_REWARD_FAILED',
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    );
end;
$$;

revoke execute on function public.award_social_share_reward(uuid, text, text, text, text, text, text, text, numeric, boolean, text, boolean, boolean, text, boolean) from public;
revoke execute on function public.award_social_share_reward(uuid, text, text, text, text, text, text, text, numeric, boolean, text, boolean, boolean, text, boolean) from anon;
revoke execute on function public.award_social_share_reward(uuid, text, text, text, text, text, text, text, numeric, boolean, text, boolean, boolean, text, boolean) from authenticated;
grant execute on function public.award_social_share_reward(uuid, text, text, text, text, text, text, text, numeric, boolean, text, boolean, boolean, text, boolean) to service_role;

-- ── 4. Replace update_share_attempt_status — accept screenshot fields ────
drop function if exists public.update_share_attempt_status(uuid, text, text, text, text, text);
drop function if exists public.update_share_attempt_status(uuid, text, text, text, text, text, text, text, text, text, numeric, text, boolean, boolean, text, boolean);

create or replace function public.update_share_attempt_status(
  p_attempt_id uuid,
  p_status text default null,
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
    set status = COALESCE(p_status, status),
        submitted_post_url = COALESCE(p_post_url, submitted_post_url),
        submitted_post_url_normalized = COALESCE(p_post_url_normalized, submitted_post_url_normalized),
        platform = COALESCE(p_platform, platform),
        rejection_reason = COALESCE(p_rejection_reason, rejection_reason),
        verification_attempted_at = now(),
        screenshot_storage_path = COALESCE(p_screenshot_storage_path, screenshot_storage_path),
        screenshot_hash = COALESCE(p_screenshot_hash, screenshot_hash),
        detected_platform = COALESCE(p_detected_platform, detected_platform),
        detected_handle = COALESCE(p_detected_handle, detected_handle),
        verification_confidence = COALESCE(p_verification_confidence, verification_confidence),
        ai_failure_reason = COALESCE(p_ai_failure_reason, ai_failure_reason),
        eagoh_card_detected = COALESCE(p_eagoh_card_detected, eagoh_card_detected),
        published_post_interface_detected = COALESCE(p_published_post_interface_detected, published_post_interface_detected),
        verification_code_detected = COALESCE(p_verification_code_detected, verification_code_detected),
        verification_code_matches = COALESCE(p_verification_code_matches, verification_code_matches)
    where id = p_attempt_id;

  return jsonb_build_object('ok', true, 'attempt_id', p_attempt_id, 'status', p_status);
end;
$$;

revoke execute on function public.update_share_attempt_status(uuid, text, text, text, text, text, text, text, text, text, text, numeric, text, boolean, boolean, text, boolean) from public;
revoke execute on function public.update_share_attempt_status(uuid, text, text, text, text, text, text, text, text, text, text, numeric, text, boolean, boolean, text, boolean) from anon;
revoke execute on function public.update_share_attempt_status(uuid, text, text, text, text, text, text, text, text, text, text, numeric, text, boolean, boolean, text, boolean) from authenticated;
grant execute on function public.update_share_attempt_status(uuid, text, text, text, text, text, text, text, text, text, text, numeric, text, boolean, boolean, text, boolean) to service_role;

-- ── 5. Recovery: fix any existing verified-but-unrewarded attempts ───────
-- For attempts that were marked verified but never got reward_awarded = true
-- AND have no ledger entry, grant the missing reward now.
do $$
declare
  v_rec record;
  v_purchased int;
  v_count int;
  v_reward int := 5;
  v_ledger_exists boolean;
begin
  for v_rec in
    select ssa.id, ssa.user_id, ssa.eagoh_id, ssa.status, ssa.reward_awarded
      from public.social_share_attempts ssa
      where ssa.status = 'verified'
        and ssa.reward_awarded = false
  loop
    -- Check if ledger entry already exists
    select exists(
      select 1 from public.edge_transactions
        where user_id = v_rec.user_id
          and reason = 'social_share_reward'
          and amount = v_reward
          and bucket = 'purchased'
          and (note like '%(' || v_rec.eagoh_id::text || ')%')
    ) into v_ledger_exists;

    if v_ledger_exists then
      -- Ledger exists — just fix the flag
      update public.social_share_attempts
        set reward_awarded = true,
            reward_amount = v_reward
        where id = v_rec.id;
    else
      -- Grant the missing reward
      select edge_purchased, verified_share_count
        into v_purchased, v_count
        from public.profiles
        where id = v_rec.user_id
        for update;

      if found then
        v_purchased := COALESCE(v_purchased, 0) + v_reward;
        v_count := COALESCE(v_count, 0) + 1;

        update public.profiles
          set edge_purchased = v_purchased,
              verified_share_count = v_count,
              updated_at = now()
          where id = v_rec.user_id;

        insert into public.edge_transactions (
          user_id, kind, reason, amount, bucket,
          from_subscription, from_purchased,
          balance_subscription_after, balance_purchased_after, note
        ) values (
          v_rec.user_id,
          'addition',
          'social_share_reward',
          v_reward,
          'purchased',
          0,
          0,
          0,
          v_purchased,
          'Social share verification reward (EAGOH ' || v_rec.eagoh_id::text || ')'
        );

        update public.social_share_attempts
          set reward_awarded = true,
              reward_amount = v_reward
          where id = v_rec.id;
      end if;
    end if;
  end loop;
end;
$$;
