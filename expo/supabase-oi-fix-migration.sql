-- =============================================================================
-- EAGOH Open Intelligence — Complete Idempotent Repair Migration (v2)
-- =============================================================================
-- LIVE DIAGNOSIS (2026-07-29):
--
--   FIRST failure (before v1 migration):
--     SQLSTATE: 42883
--     Message: function array_length(jsonb, integer) does not exist
--     Cause: evaluate_oi_quality_trigger() called array_length(jsonb, int)
--     Fix: replaced with jsonb_array_length(jsonb)  [v1 migration]
--
--   SECOND failure (after v1 migration, still OI_SERVER_ERROR):
--     SQLSTATE: 0A000
--     Message: set-returning functions are not allowed in COALESCE
--     Hint: You might be able to move the set-returning function into a LATERAL FROM item.
--     Cause: regexp_matches(text, pattern, 'g') returns SETOF text[] — a set-returning
--            function. It CANNOT be used as a scalar argument to array_length() or
--            coalesce(). Three statements did this:
--              v_proper_nouns := array_length(regexp_matches(..., 'g'), 1);
--              v_numbers := array_length(regexp_matches(..., 'g'), 1);
--              v_negation_count := coalesce(array_length(regexp_matches(..., 'gi'), 1), 0);
--     Fix: replaced all three with:
--            SELECT count(*) INTO v_var FROM regexp_matches(text, pattern, flags);
--
--   ADDITIONAL safety: jsonb_array_length() crashes if the jsonb value is not an
--   array (e.g. '{}' object or 'null'). Added jsonb_typeof() guard:
--     CASE WHEN jsonb_typeof(coalesce(col, '[]'::jsonb)) = 'array'
--          THEN jsonb_array_length(coalesce(col, '[]'::jsonb))
--          ELSE 0 END
--
-- This migration (v2) is fully idempotent — safe to run multiple times.
-- =============================================================================

-- ── 1. Ensure open_intelligence table exists ─────────────────────────────────

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

-- ── 2. Add all optional/Phase 5B columns (idempotent) ────────────────────────

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
  add column if not exists selected_subtags jsonb default '[]'::jsonb,
  add column if not exists custom_tags jsonb default '[]'::jsonb,
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

-- ── 3. Indexes ───────────────────────────────────────────────────────────────

create index if not exists oi_user_id_idx on public.open_intelligence(user_id, created_at desc);
create index if not exists oi_eagoh_id_idx on public.open_intelligence(eagoh_id, created_at desc);
create index if not exists oi_domain_idx on public.open_intelligence(intelligence_domain);
create index if not exists oi_validation_status_idx on public.open_intelligence(validation_status);
create index if not exists oi_content_hash_idx on public.open_intelligence(user_id, content_hash) where content_hash is not null;
create index if not exists oi_duplicate_idx on public.open_intelligence(duplicate_flag) where duplicate_flag = true;
create index if not exists oi_outdated_idx on public.open_intelligence(outdated_flag) where outdated_flag = true;
create index if not exists oi_active_dispute_idx on public.open_intelligence(active_dispute_count) where active_dispute_count > 0;

-- ── 4. RLS on open_intelligence ──────────────────────────────────────────────

alter table public.open_intelligence enable row level security;

drop policy if exists "oi_self_select" on public.open_intelligence;
drop policy if exists "oi_self_insert" on public.open_intelligence;
drop policy if exists "oi_self_update" on public.open_intelligence;
drop policy if exists "oi_faction_shared_select" on public.open_intelligence;

create policy "oi_self_select" on public.open_intelligence
  for select using (auth.uid() = user_id);

create policy "oi_self_insert" on public.open_intelligence
  for insert with check (auth.uid() = user_id);

create policy "oi_self_update" on public.open_intelligence
  for update using (auth.uid() = user_id);

-- ── 5. Ensure oi_creation_ledger table exists ────────────────────────────────

create table if not exists public.oi_creation_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  entry_id uuid references public.open_intelligence(id) on delete set null,
  amount int not null,
  from_subscription int not null default 0,
  from_purchased int not null default 0,
  bucket text not null default 'subscription',
  status text not null default 'charged',
  note text,
  created_at timestamptz default now(),
  refunded_at timestamptz
);

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

-- ── 6. Ensure edge_transactions table exists ─────────────────────────────────

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

-- ── 7. Migrate legacy validation statuses ────────────────────────────────────

do $$
begin
  update public.open_intelligence
    set validation_status = 'community_supported'
    where validation_status = 'validated';
  update public.open_intelligence
    set validation_status = 'disputed'
    where validation_status = 'flagged';
exception when others then null;
end $$;

-- ── 8. FIXED: evaluate_oi_quality_trigger function ───────────────────────────
-- The original used array_length(jsonb, int) which does NOT exist in PostgreSQL.
-- Fixed to use jsonb_array_length() for jsonb columns.
-- Also fixed default from '{}'::jsonb (object) to '[]'::jsonb (array).

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
    begin
      new.content_hash := null;
    exception when others then null;
    end;
    begin
      new.duplicate_flag := false;
    exception when others then null;
    end;
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
  -- FIX: regexp_matches(..., 'g') returns SETOF text[] — a set-returning function.
  -- It CANNOT be passed to array_length() as a scalar. Use SELECT count(*) FROM regexp_matches().
  select count(*) into v_proper_nouns from regexp_matches(v_text, '[A-Z][a-z]{2,}', 'g');
  select count(*) into v_numbers from regexp_matches(v_text, '[0-9]+', 'g');
  v_score := v_score + least(15, coalesce(v_proper_nouns, 0) * 3 + coalesce(v_numbers, 0) * 2);

  -- 4. Category/tag alignment
  -- FIX: use jsonb_array_length() instead of array_length() for jsonb columns
  -- FIX: use '[]'::jsonb (empty array) instead of '{}'::jsonb (empty object)
  -- FIX: guard with jsonb_typeof() = 'array' — jsonb_array_length() crashes on non-array jsonb
  v_tag_count :=
    case when jsonb_typeof(coalesce(new.selected_subtags, '[]'::jsonb)) = 'array'
         then coalesce(jsonb_array_length(coalesce(new.selected_subtags, '[]'::jsonb)), 0)
         else 0 end
    + case when jsonb_typeof(coalesce(new.custom_tags, '[]'::jsonb)) = 'array'
           then coalesce(jsonb_array_length(coalesce(new.custom_tags, '[]'::jsonb)), 0)
           else 0 end
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
  -- FIX: regexp_matches(..., 'gi') returns SETOF text[] — use SELECT count(*) FROM regexp_matches().
  select count(*) into v_negation_count from regexp_matches(v_text, '\bnot\b|\bnever\b|\bcannot\b', 'gi');
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

  -- Content hash (optional column — wrapped in exception handler)
  v_new_hash := 'ch_' || substring(md5(lower(regexp_replace(v_text, '[^a-zA-Z0-9]', '', 'g'))) from 1 for 16);
  begin
    new.content_hash := v_new_hash;
  exception when others then
    null;
  end;

  -- Duplicate detection (same user, other entries)
  begin
    select id into v_dup_entry_id
    from public.open_intelligence
    where user_id = new.user_id
      and id != new.id
      and content_hash = v_new_hash
    limit 1;
    new.duplicate_flag := v_dup_entry_id is not null;
  exception when others then
    null;
  end;

  -- Ensure version_number starts at 1 on insert
  begin
    if TG_OP = 'INSERT' and new.version_number is null then
      new.version_number := 1;
    end if;
  exception when others then
    null;
  end;

  return new;
end;
$$ language plpgsql security definer set search_path = '';

-- ── 9. Recreate triggers ─────────────────────────────────────────────────────

drop trigger if exists oi_quality_on_insert on public.open_intelligence;
create trigger oi_quality_on_insert
  before insert on public.open_intelligence
  for each row execute function public.evaluate_oi_quality_trigger();

drop trigger if exists oi_quality_on_update on public.open_intelligence;
create trigger oi_quality_on_update
  before update on public.open_intelligence
  for each row execute function public.evaluate_oi_quality_trigger();

-- ── 10. create_oi_entry RPC (atomic, security definer) ───────────────────────
-- Drop any older overloads before creating the final version.
-- The Worker calls this with exactly 12 named parameters:
--   p_user_id, p_request_id, p_eagoh_id, p_intelligence_domain,
--   p_entry_type, p_content, p_confidence_level, p_tag,
--   p_selected_subtags, p_custom_tags, p_selected_category, p_note

drop function if exists public.create_oi_entry(uuid, text, uuid, text, text, text, text, text, jsonb, jsonb, int);
drop function if exists public.create_oi_entry(uuid, uuid, text, text, text, text, jsonb, jsonb, text);
drop function if exists public.create_oi_entry(uuid, text, uuid, text, text, text, text, text, jsonb, jsonb, text, text);

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

  -- 2. Re-check the ledger AFTER the lock.
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
    p_selected_category,
    case when jsonb_typeof(p_selected_subtags) = 'array' then p_selected_subtags else '[]'::jsonb end,
    case when jsonb_typeof(p_custom_tags) = 'array' then p_custom_tags else '[]'::jsonb end
  )
  returning id into v_new_entry_id;

  -- 6. Insert the ledger row.
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

-- ── 11. RPC permissions ──────────────────────────────────────────────────────

revoke execute on function public.create_oi_entry(uuid, text, uuid, text, text, text, text, text, jsonb, jsonb, text, text) from public;
revoke execute on function public.create_oi_entry(uuid, text, uuid, text, text, text, text, text, jsonb, jsonb, text, text) from anon;
revoke execute on function public.create_oi_entry(uuid, text, uuid, text, text, text, text, text, jsonb, jsonb, text, text) from authenticated;
grant execute on function public.create_oi_entry(uuid, text, uuid, text, text, text, text, text, jsonb, jsonb, text, text) to service_role;

-- ── 12. refund_oi_entry (idempotent, service_role only) ──────────────────────

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

  select amount, from_subscription, from_purchased, bucket, status, refunded_at
    into v_led
    from public.oi_creation_ledger
    where user_id = p_user_id and request_id = p_request_id
    for update;

  if not found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'message', 'no_charge_to_refund');
  end if;

  if v_led.status = 'refunded' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'message', 'already_refunded');
  end if;

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

revoke execute on function public.refund_oi_entry(uuid, text, text) from public;
revoke execute on function public.refund_oi_entry(uuid, text, text) from anon;
revoke execute on function public.refund_oi_entry(uuid, text, text) from authenticated;
grant execute on function public.refund_oi_entry(uuid, text, text) to service_role;

-- ── DONE ─────────────────────────────────────────────────────────────────────
