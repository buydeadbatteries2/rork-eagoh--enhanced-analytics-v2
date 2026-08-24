-- ────────────────────────────────────────────────────────────────────────────
-- EAGOH Slot Entitlements Migration (Phase 4A)
--
-- Permanent EAGOH-slot entitlement foundation for the single-Pro conversion.
--   - Pro access includes 2 EAGOHs (PRO_INCLUDED_EAGOHS).
--   - An account can hold at most 5 EAGOHs (MAX_EAGOHS_PER_ACCOUNT).
--   - Up to 3 additional slots may come from grandfathered legacy capacity or
--     future Neuron purchases (750 per slot). The purchase flow arrives in a
--     later phase and MUST run server-side only (service_role).
--
-- Tables:
--   public.eagoh_slot_entitlements  one row per user (owner read-only via RLS)
--   public.eagoh_slot_transactions  immutable audit log (owner read-only via RLS)
--
-- This migration is fully idempotent. Grandfathering is a ONE-TIME SNAPSHOT:
-- re-running it never grants additional capacity based on EAGOHs forged after
-- the snapshot, never updates an existing entitlement row, and never
-- duplicates audit entries.
--
-- Grandfathering: at migration time every existing auth.users account
-- receives an entitlement row. Accounts owning more than 2 user-forged
-- EAGOHs receive grandfathered_slots = min(forged_count - 2, 3):
--   forged 0–2 → 0 | 3 → 1 | 4 → 2 | 5+ → 3
-- No EAGOH is deleted or deactivated, and no Neurons are deducted.
--
-- NOTE: This file is created only — it has NOT been executed against the
-- live Supabase project. No client-callable slot-purchase RPC is created here.
-- ────────────────────────────────────────────────────────────────────────────

-- Table creation, policies, snapshot, and auditing succeed or fail together.
-- Every statement is idempotent, so re-running the whole transaction is safe.
begin;

-- ── 1. eagoh_slot_entitlements ──────────────────────────────────────────────

create table if not exists public.eagoh_slot_entitlements (
  user_id             uuid        primary key references auth.users(id) on delete cascade,
  purchased_slots     smallint    not null default 0,
  grandfathered_slots smallint    not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint eagoh_slot_entitlements_purchased_range
    check (purchased_slots between 0 and 3),
  constraint eagoh_slot_entitlements_grandfathered_range
    check (grandfathered_slots between 0 and 3),
  constraint eagoh_slot_entitlements_combined_max
    check (purchased_slots + grandfathered_slots <= 3)
);

-- ── 2. eagoh_slot_transactions (immutable audit log) ────────────────────────

create table if not exists public.eagoh_slot_transactions (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  kind            text        not null,
  slot_delta      smallint    not null,
  neuron_cost     integer     not null default 0,
  idempotency_key text,
  metadata        jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint eagoh_slot_transactions_kind_check
    check (kind in ('purchase', 'grandfather_grant', 'refund', 'admin_adjustment'))
);

-- One audit row per idempotent operation (grandfather grants, purchases…)
create unique index if not exists idx_eagoh_slot_transactions_idempotency
  on public.eagoh_slot_transactions(idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_eagoh_slot_transactions_user_created
  on public.eagoh_slot_transactions(user_id, created_at desc);

-- ── 3. Row Level Security ───────────────────────────────────────────────────
-- Owners may SELECT only their own rows. There are deliberately NO
-- insert/update/delete policies: clients can never write slot entitlements or
-- audit rows. Writes happen exclusively via service_role inside secure
-- server-side operations (added in a later phase).

alter table public.eagoh_slot_entitlements enable row level security;
alter table public.eagoh_slot_transactions enable row level security;

drop policy if exists "eagoh_slot_entitlements_owner_read"
  on public.eagoh_slot_entitlements;

create policy "eagoh_slot_entitlements_owner_read"
  on public.eagoh_slot_entitlements
  for select
  using (auth.uid() = user_id);

drop policy if exists "eagoh_slot_transactions_owner_read"
  on public.eagoh_slot_transactions;

create policy "eagoh_slot_transactions_owner_read"
  on public.eagoh_slot_transactions
  for select
  using (auth.uid() = user_id);

-- ── 4. Privileges — belt and braces on top of RLS ───────────────────────────
-- Explicitly revoke ALL client privileges, then re-grant SELECT only, so
-- anon/authenticated roles can never insert, update, or delete slot
-- entitlements or audit rows even if a policy were ever regressed.
-- service_role retains full access for the secure server-side purchase
-- operation that arrives in a later phase.

revoke all on public.eagoh_slot_entitlements from anon, authenticated;
revoke all on public.eagoh_slot_transactions from anon, authenticated;

grant select on public.eagoh_slot_entitlements to authenticated;
grant select on public.eagoh_slot_transactions to authenticated;

grant all on public.eagoh_slot_entitlements to service_role;
grant all on public.eagoh_slot_transactions to service_role;

-- ── 5. updated_at maintenance ───────────────────────────────────────────────

drop trigger if exists trg_eagoh_slot_entitlements_updated_at
  on public.eagoh_slot_entitlements;

create or replace function public.set_eagoh_slot_entitlements_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Restrict direct execution to service_role. PUBLIC, anon, and authenticated
-- are explicitly revoked so no client can invoke the trigger function
-- directly. Authorized server-side updates still fire the trigger normally.
revoke execute on function public.set_eagoh_slot_entitlements_updated_at()
  from public, anon, authenticated;
grant execute on function public.set_eagoh_slot_entitlements_updated_at()
  to service_role;

create trigger trg_eagoh_slot_entitlements_updated_at
  before update on public.eagoh_slot_entitlements
  for each row
  execute function public.set_eagoh_slot_entitlements_updated_at();

-- ── 6. Grandfather snapshot (one-time, frozen) ──────────────────────────────
-- Count user-forged, non-default-shell EAGOHs per user using the exact null
-- semantics of EagohProvider:
--   • is_default_shell = true                             → excluded (default shell)
--   • is_default_shell IS NULL AND is_user_forged = false → excluded (legacy row)
--   • everything else                                      → counted as user-forged
--
-- EVERY existing auth.users account is included in the snapshot — including
-- accounts that receive zero grandfathered slots — and receives one
-- entitlement row with purchased_slots = 0.
--
-- `on conflict (user_id) do nothing` means existing rows are NEVER updated:
-- any previously stored purchased or grandfathered capacity is preserved and
-- the snapshot stays frozen. A re-run after a user forges additional EAGOHs
-- therefore cannot grant more capacity, and accounts created after this
-- migration never receive rows here.
--
--   forged 0–2 → 0 | 3 → 1 | 4 → 2 | 5+ → 3
-- No EAGOH is deleted or deactivated and no Neurons are deducted.

with user_forged_counts as (
  select
    e.user_id,
    count(*)::int as forged_count
  from public.eagohs e
  where e.user_id is not null
    and coalesce(e.is_default_shell, false) = false
    and not (e.is_default_shell is null and e.is_user_forged is false)
  group by e.user_id
),
snapshot as (
  select
    u.id as user_id,
    least(greatest(coalesce(c.forged_count, 0) - 2, 0), 3)::smallint
      as grandfathered_slots
  from auth.users u
  left join user_forged_counts c on c.user_id = u.id
)
insert into public.eagoh_slot_entitlements (
  user_id,
  purchased_slots,
  grandfathered_slots
)
select
  user_id,
  0,
  grandfathered_slots
from snapshot
on conflict (user_id) do nothing;

-- ── 7. Grandfather audit rows (from the STORED entitlement values) ──────────
-- Audit rows are derived from the grandfathered_slots value actually stored
-- in the entitlement table, so the audit trail always agrees with the
-- entitlement — including any pre-existing row whose stored value differs
-- from the raw snapshot grant (e.g. purchased slots already occupying part of
-- the 3-slot ceiling). Only non-zero grants are audited.
--
-- The deterministic idempotency key (legacy-eagoh-capacity-v1:<user_id>) plus
-- `on conflict do nothing` makes re-runs pure no-ops while still allowing
-- this statement to repair any missing audit rows; the unique partial index
-- on idempotency_key is the enforcement backstop.

insert into public.eagoh_slot_transactions (
  user_id,
  kind,
  slot_delta,
  neuron_cost,
  idempotency_key,
  metadata
)
select
  e.user_id,
  'grandfather_grant',
  e.grandfathered_slots,
  0,
  'legacy-eagoh-capacity-v1:' || e.user_id::text,
  jsonb_build_object(
    'reason', 'legacy_eagoh_capacity_grandfather',
    'granted_slots', e.grandfathered_slots,
    'migration', 'eagoh-slot-entitlements'
  )
from public.eagoh_slot_entitlements e
where e.grandfathered_slots > 0
on conflict do nothing;

commit;
