import { supabase } from "@/lib/supabase";
import { spendEdge } from "@/services/edge";
import type { SubscriptionTier, UserProfile } from "@/services/profile";
import { getEffectiveSubscriptionTier } from "@/services/profile";

// ── Types ──────────────────────────────────────────────────────────────

export type FactionRole = "commander" | "strategist" | "analyst" | "recruit" | "dormant";
export type MemberStatus = "active" | "grace_period" | "dormant";

export const GRACE_PERIOD_DAYS = 7;

/** Tier-gated faction limits */
export const TIER_FACTION_LIMITS: Record<
  SubscriptionTier,
  { maxFactions: number; includedSlots: number; maxMembers: number; canCreate: boolean; canJoin: boolean }
> = {
  free:         { maxFactions: 0, includedSlots: 0, maxMembers: 0,   canCreate: false, canJoin: false },
  pro:          { maxFactions: 1, includedSlots: 3, maxMembers: 10,  canCreate: true,  canJoin: true },
  oracle_elite: { maxFactions: 2, includedSlots: 5, maxMembers: 25,  canCreate: true,  canJoin: true },
  syndicate:    { maxFactions: 3, includedSlots: 10, maxMembers: 100, canCreate: true,  canJoin: true },
};

/** Slot expansion Edge costs */
export const SLOT_EXPANSION_COSTS: { slots: number; cost: number }[] = [
  { slots: 1, cost: 25 },
  { slots: 5, cost: 100 },
  { slots: 10, cost: 175 },
];

// ── Validation constants ───────────────────────────────────────────────

export const FACTION_VALIDATION = {
  nameMax: 40,
  descriptionMax: 250,
  mottoMax: 80,
} as const;

// ── DB Row types ───────────────────────────────────────────────────────

export type FactionRow = {
  id: string;
  commander_id: string;
  name: string;
  description: string | null;
  motto: string | null;
  fanatic_team_focus: string | null;
  emblem: string | null;
  intelligence_domain: string;
  included_members: number;
  max_members: number;
  current_members: number;
  influence_score: number;
  created_at: string;
};

export type FactionMemberRow = {
  id: string;
  faction_id: string;
  user_id: string;
  role: FactionRole;
  status: MemberStatus;
  downgrade_at: string | null;
  joined_at: string;
};

export type FactionInviteRow = {
  id: string;
  faction_id: string;
  inviter_id: string;
  invitee_id: string;
  role: FactionRole;
  status: "pending" | "accepted" | "declined";
  expires_at: string;
  created_at: string;
};

export type FactionActivityRow = {
  id: string;
  faction_id: string;
  user_id: string;
  kind: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type FactionSharedIntelRow = {
  id: string;
  faction_id: string;
  user_id: string;
  oi_entry_id: string;
  shared_at: string;
};

export type FactionSlotPurchaseRow = {
  id: string;
  faction_id: string;
  user_id: string;
  slots_purchased: number;
  edge_cost: number;
  purchased_at: string;
};

// ── Enriched types ─────────────────────────────────────────────────────

export type FactionFull = FactionRow & {
  members: FactionMemberRow[];
  invites: FactionInviteRow[];
  recentActivity: FactionActivityRow[];
  sharedEntries: FactionSharedIntelRow[];
};

export type FactionMemberDisplay = FactionMemberRow & {
  username?: string | null;
  avatar_url?: string | null;
};

/** Avatar + username map for faction members (keyed by user_id). */
export type MemberProfileMap = Map<string, { username: string | null; avatar_url: string | null }>;

// ── Activity event descriptions ────────────────────────────────────────

const ACTIVITY_LABELS: Record<string, string> = {
  faction_created: "Faction founded",
  member_joined: "joined the Faction",
  member_left: "left the Faction",
  member_dormant: "entered dormant status",
  grace_period_started: "entered 7-day grace period",
  grace_period_ended: "grace period expired",
  invite_sent: "sent an invitation",
  invite_accepted: "accepted an invitation",
  invite_declined: "declined an invitation",
  role_changed: "role changed",
  intel_shared: "shared new intelligence",
  slots_expanded: "expanded member slots",
  faction_updated: "updated faction details",
};

export function describeActivity(row: FactionActivityRow): string {
  const base = ACTIVITY_LABELS[row.kind] ?? row.kind.replace(/_/g, " ");
  const details = row.details as Record<string, unknown> | undefined;

  switch (row.kind) {
    case "invite_sent":
      return `Commander sent an invitation`;
    case "invite_accepted":
      return `${details?.username ?? "An analyst"} joined via invite`;
    case "member_joined":
      return `${details?.username ?? "An analyst"} joined the Faction`;
    case "intel_shared":
      return `${details?.username ?? "A member"} contributed new intelligence`;
    case "role_changed":
      return `${details?.username ?? "Member"} promoted to ${details?.new_role ?? "new role"}`;
    case "slots_expanded":
      return `Commander purchased +${details?.slots ?? "?"} slots (${details?.cost ?? "?"} Neurons)`;
    case "member_dormant":
      return `${details?.username ?? "A member"} became dormant — subscription expired`;
    case "grace_period_started":
      return `${details?.username ?? "A member"} entered grace period (${details?.days ?? 7} days)`;
    default:
      return base;
  }
}

// ── Faction Intelligence Score ─────────────────────────────────────────

export interface FactionIntelScore {
  score: number;          // 0–100
  activePaidMembers: number;
  sharedEntryCount: number;
  avgQualityScore: number;
  recentActivityCount: number;
}

/**
 * Mock/local Faction Intelligence Score calculation.
 *
 * Factors:
 *   - Active paid members (weight: 35)
 *   - Shared Open Intelligence entry count (weight: 30)
 *   - Average observation quality score (weight: 25)
 *   - Recent activity count (weight: 10)
 */
export function computeFactionIntelScore(
  activePaidMembers: number,
  sharedEntryCount: number,
  avgQualityScore: number,
  recentActivityCount: number,
): FactionIntelScore {
  const memberScore = Math.min(35, Math.round((activePaidMembers / 20) * 35));
  const entryScore = Math.min(30, Math.round((sharedEntryCount / 50) * 30));
  const qualityScore = Math.round((avgQualityScore / 100) * 25);
  const activityScore = Math.min(10, Math.round((recentActivityCount / 30) * 10));

  const score = Math.max(0, Math.min(100, memberScore + entryScore + qualityScore + activityScore));

  return {
    score,
    activePaidMembers,
    sharedEntryCount,
    avgQualityScore,
    recentActivityCount,
  };
}

// ── Tier gating helpers ────────────────────────────────────────────────

export function getFactionLimit(tier: SubscriptionTier): typeof TIER_FACTION_LIMITS.free {
  return TIER_FACTION_LIMITS[tier] ?? TIER_FACTION_LIMITS.free;
}

export function canParticipateInFactions(tier: SubscriptionTier): boolean {
  const limits = getFactionLimit(tier);
  return limits.canCreate || limits.canJoin;
}

// ── Member count enforcement ───────────────────────────────────────────

/** Count how many factions a user is already a member of (any status). */
export async function countUserFactionMemberships(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("faction_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

// ── CRUD: Factions ─────────────────────────────────────────────────────

export type CreateFactionInput = {
  userId: string;
  profile: UserProfile;
  name: string;
  description?: string;
  motto?: string;
  fanaticTeamFocus?: string;
  emblem?: string;
  intelligence_domain: string;
  effectiveTier?: SubscriptionTier;
};

export type CreateFactionResult =
  | { ok: true; faction: FactionRow }
  | { ok: false; error: string };

export async function createFaction(input: CreateFactionInput): Promise<CreateFactionResult> {
  const tier = input.effectiveTier ?? getEffectiveSubscriptionTier(input.profile);
  const limits = getFactionLimit(tier);

  if (!limits.canCreate) {
    return { ok: false, error: "Free users cannot create Factions. Upgrade to Pro, Oracle Elite, or Syndicate to lead an alliance." };
  }

  // Validate lengths
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Faction name is required." };
  if (name.length > FACTION_VALIDATION.nameMax) {
    return { ok: false, error: `Faction name must be ${FACTION_VALIDATION.nameMax} characters or fewer.` };
  }
  const description = (input.description ?? "").trim();
  if (description.length > FACTION_VALIDATION.descriptionMax) {
    return { ok: false, error: `Description must be ${FACTION_VALIDATION.descriptionMax} characters or fewer.` };
  }
  const motto = (input.motto ?? "").trim();
  if (motto.length > FACTION_VALIDATION.mottoMax) {
    return { ok: false, error: `Motto must be ${FACTION_VALIDATION.mottoMax} characters or fewer.` };
  }

  // Count how many factions this user commands
  const { count, error: countErr } = await supabase
    .from("factions")
    .select("id", { count: "exact", head: true })
    .eq("commander_id", input.userId);
  if (countErr) return { ok: false, error: countErr.message };
  if ((count ?? 0) >= limits.maxFactions) {
    return { ok: false, error: `Your ${tier} tier allows ${limits.maxFactions} Faction${limits.maxFactions === 1 ? "" : "s"}.` };
  }

  const payload = {
    commander_id: input.userId,
    name,
    description: description || null,
    motto: motto || null,
    fanatic_team_focus: input.fanaticTeamFocus?.trim() || null,
    emblem: input.emblem ?? null,
    intelligence_domain: input.intelligence_domain,
    included_members: limits.includedSlots,
    max_members: limits.maxMembers,
    current_members: 1,
    influence_score: 0,
  };

  const { data, error } = await supabase
    .from("factions")
    .insert(payload)
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to create faction" };

  const faction = data as FactionRow;

  // Auto-join creator as Commander
  await supabase.from("faction_members").insert({
    faction_id: faction.id,
    user_id: input.userId,
    role: "commander" as FactionRole,
    status: "active" as MemberStatus,
  });

  // Log activity
  await supabase.from("faction_activity").insert({
    faction_id: faction.id,
    user_id: input.userId,
    kind: "faction_created",
    details: { name: faction.name },
  });

  return { ok: true, faction };
}

export async function getFactionFull(factionId: string): Promise<FactionFull | null> {
  const { data: faction, error } = await supabase
    .from("factions")
    .select("*")
    .eq("id", factionId)
    .maybeSingle();
  if (error || !faction) return null;

  const [membersRes, invitesRes, recentActivityRes, sharedEntriesRes] = await Promise.all([
    supabase.from("faction_members").select("*").eq("faction_id", factionId),
    supabase.from("faction_invites").select("*").eq("faction_id", factionId).eq("status", "pending"),
    supabase.from("faction_activity").select("*").eq("faction_id", factionId).order("created_at", { ascending: false }).limit(30),
    supabase.from("faction_shared_intelligence").select("*").eq("faction_id", factionId).order("shared_at", { ascending: false }).limit(50),
  ]);

  return {
    ...(faction as FactionRow),
    members: (membersRes.data ?? []) as FactionMemberRow[],
    invites: (invitesRes.data ?? []) as FactionInviteRow[],
    recentActivity: (recentActivityRes.data ?? []) as FactionActivityRow[],
    sharedEntries: (sharedEntriesRes.data ?? []) as FactionSharedIntelRow[],
  };
}

export async function listUserFactions(userId: string): Promise<FactionRow[]> {
  const { data: memberRows, error: memberErr } = await supabase
    .from("faction_members")
    .select("faction_id")
    .eq("user_id", userId);

  if (memberErr) throw memberErr;
  const factionIds = (memberRows ?? []).map((r: { faction_id: string }) => r.faction_id);
  if (factionIds.length === 0) return [];

  const { data, error } = await supabase
    .from("factions")
    .select("*")
    .in("id", factionIds)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as FactionRow[];
}

export async function listAllFactions(): Promise<FactionRow[]> {
  const { data, error } = await supabase
    .from("factions")
    .select("*")
    .order("influence_score", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as FactionRow[];
}

// ── Membership ─────────────────────────────────────────────────────────

export type JoinFactionResult =
  | { ok: true; member: FactionMemberRow }
  | { ok: false; error: string };

export async function joinFaction(
  userId: string,
  profile: UserProfile,
  factionId: string,
  effectiveTier?: SubscriptionTier,
): Promise<JoinFactionResult> {
  const tier = effectiveTier ?? getEffectiveSubscriptionTier(profile);
  const limits = getFactionLimit(tier);
  if (!limits.canJoin) {
    return { ok: false, error: "Free users cannot join Factions. Upgrade to a paid tier to become an Analyst." };
  }

  // Enforce member count per tier
  const currentCount = await countUserFactionMemberships(userId);
  if (currentCount >= limits.maxFactions) {
    return { ok: false, error: `Your ${tier} tier allows only ${limits.maxFactions} Faction${limits.maxFactions === 1 ? "" : "s"}. Leave one first.` };
  }

  // Check if already a member
  const { data: existing } = await supabase
    .from("faction_members")
    .select("id")
    .eq("faction_id", factionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return { ok: false, error: "You are already a member of this Faction." };

  // Check faction capacity
  const { data: faction } = await supabase
    .from("factions")
    .select("max_members,current_members,commander_id,name")
    .eq("id", factionId)
    .maybeSingle();
  if (!faction) return { ok: false, error: "Faction not found." };

  const f = faction as { max_members: number; current_members: number; commander_id: string; name: string };
  if (f.current_members >= f.max_members) {
    return { ok: false, error: "Faction is at maximum capacity." };
  }

  const role: FactionRole = f.commander_id === userId ? "commander" : "recruit";
  const status: MemberStatus = "active";

  const { data: member, error } = await supabase
    .from("faction_members")
    .insert({ faction_id: factionId, user_id: userId, role, status })
    .select("*")
    .single();

  if (error || !member) return { ok: false, error: error?.message ?? "Failed to join faction" };

  // Update member count
  await supabase
    .from("factions")
    .update({ current_members: f.current_members + 1 })
    .eq("id", factionId);

  // Log activity
  await supabase.from("faction_activity").insert({
    faction_id: factionId,
    user_id: userId,
    kind: "member_joined",
    details: { role, faction_name: f.name },
  });

  return { ok: true, member: member as FactionMemberRow };
}

// ── Leave faction ──────────────────────────────────────────────────────

export async function leaveFaction(
  factionId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  // Commander cannot leave — must transfer or disband
  const { data: faction } = await supabase
    .from("factions")
    .select("commander_id")
    .eq("id", factionId)
    .maybeSingle();
  if (!faction) return { ok: false, error: "Faction not found." };

  const f = faction as { commander_id: string };
  if (f.commander_id === userId) {
    return { ok: false, error: "Commanders cannot leave their Faction. Transfer command or disband instead." };
  }

  // Remove member
  await supabase
    .from("faction_members")
    .delete()
    .eq("faction_id", factionId)
    .eq("user_id", userId);

  // Remove shared intelligence from this member
  await supabase
    .from("faction_shared_intelligence")
    .delete()
    .eq("faction_id", factionId)
    .eq("user_id", userId);

  // Update member count
  const { data: current } = await supabase
    .from("factions")
    .select("current_members")
    .eq("id", factionId)
    .maybeSingle();
  if (current) {
    const c = current as { current_members: number };
    await supabase
      .from("factions")
      .update({ current_members: Math.max(0, c.current_members - 1) })
      .eq("id", factionId);
  }

  // Log activity
  await supabase.from("faction_activity").insert({
    faction_id: factionId,
    user_id: userId,
    kind: "member_left",
    details: {},
  });

  await recalculateFactionScore(factionId);

  return { ok: true };
}

// ── Grace period & dormancy ────────────────────────────────────────────

export async function setMemberDormant(factionId: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("faction_members")
    .update({ status: "dormant" as MemberStatus, role: "dormant" as FactionRole, downgrade_at: now })
    .eq("faction_id", factionId)
    .eq("user_id", userId);

  // Remove shared intelligence entries for this member
  await supabase
    .from("faction_shared_intelligence")
    .delete()
    .eq("faction_id", factionId)
    .eq("user_id", userId);

  // Log activity
  await supabase.from("faction_activity").insert({
    faction_id: factionId,
    user_id: userId,
    kind: "member_dormant",
    details: { reason: "Subscription downgraded" },
  });

  await recalculateFactionScore(factionId);
}

export async function setMemberGracePeriod(factionId: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("faction_members")
    .update({ status: "grace_period" as MemberStatus, downgrade_at: now })
    .eq("faction_id", factionId)
    .eq("user_id", userId);

  await supabase.from("faction_activity").insert({
    faction_id: factionId,
    user_id: userId,
    kind: "grace_period_started",
    details: { days: GRACE_PERIOD_DAYS },
  });
}

export async function enforceGracePeriods(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: expired } = await supabase
    .from("faction_members")
    .select("faction_id,user_id")
    .eq("user_id", userId)
    .eq("status", "grace_period")
    .lt("downgrade_at", cutoff);

  if (!expired || expired.length === 0) return;

  for (const row of expired as { faction_id: string; user_id: string }[]) {
    await setMemberDormant(row.faction_id, row.user_id);
  }
}

// ── Shared Intelligence ────────────────────────────────────────────────

export type ShareIntelResult =
  | { ok: true; shared: FactionSharedIntelRow }
  | { ok: false; error: string };

export async function shareIntelToFaction(
  factionId: string,
  userId: string,
  profile: UserProfile,
  oiEntryId: string,
): Promise<ShareIntelResult> {
  const limits = getFactionLimit(getEffectiveSubscriptionTier(profile));
  if (!limits.canJoin) {
    return { ok: false, error: "Only paid subscribers can share intelligence inside Factions." };
  }

  const { data: member } = await supabase
    .from("faction_members")
    .select("status")
    .eq("faction_id", factionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!member) return { ok: false, error: "You are not a member of this Faction." };
  const m = member as { status: MemberStatus };
  if (m.status !== "active") {
    return { ok: false, error: "Only active members can share intelligence." };
  }

  const { data: entry } = await supabase
    .from("open_intelligence")
    .select("id")
    .eq("id", oiEntryId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!entry) return { ok: false, error: "Intelligence entry not found." };

  // Check not already shared
  const { data: already } = await supabase
    .from("faction_shared_intelligence")
    .select("id")
    .eq("faction_id", factionId)
    .eq("oi_entry_id", oiEntryId)
    .maybeSingle();
  if (already) return { ok: false, error: "This entry is already shared to this Faction." };

  const { data: shared, error } = await supabase
    .from("faction_shared_intelligence")
    .insert({ faction_id: factionId, user_id: userId, oi_entry_id: oiEntryId })
    .select("*")
    .single();

  if (error || !shared) return { ok: false, error: error?.message ?? "Failed to share intelligence." };

  // Log activity
  await supabase.from("faction_activity").insert({
    faction_id: factionId,
    user_id: userId,
    kind: "intel_shared",
    details: { oi_entry_id: oiEntryId },
  });

  await recalculateFactionScore(factionId);

  return { ok: true, shared: shared as FactionSharedIntelRow };
}

// ── Slot expansion ─────────────────────────────────────────────────────

export type PurchaseSlotsResult =
  | { ok: true; faction: FactionRow; remainingBalance: UserProfile }
  | { ok: false; error: string };

export async function purchaseFactionSlots(
  factionId: string,
  userId: string,
  profile: UserProfile,
  slotsToBuy: number,
): Promise<PurchaseSlotsResult> {
  const costEntry = SLOT_EXPANSION_COSTS.find((s) => s.slots === slotsToBuy);
  if (!costEntry) {
    return { ok: false, error: "Invalid slot expansion size. Choose +1, +5, or +10." };
  }

  const totalEdge = (profile.edge_subscription ?? 0) + (profile.edge_purchased ?? 0);
  if (totalEdge < costEntry.cost) {
    return { ok: false, error: `Need ${costEntry.cost} Neurons for +${slotsToBuy} slots. You have ${totalEdge}.` };
  }

  const { data: faction } = await supabase
    .from("factions")
    .select("*")
    .eq("id", factionId)
    .eq("commander_id", userId)
    .maybeSingle();
  if (!faction) return { ok: false, error: "Only the Commander can purchase expansion slots." };

  const f = faction as FactionRow;

  let updatedProfile: UserProfile;
  try {
    updatedProfile = await spendEdge(
      userId,
      profile,
      costEntry.cost,
      "faction_slot_expansion",
      `+${slotsToBuy} slots for ${f.name}`,
    );
  } catch {
    return { ok: false, error: "Neuron deduction failed. Insufficient balance." };
  }

  const newMax = f.max_members + slotsToBuy;
  const { data: updated, error: updErr } = await supabase
    .from("factions")
    .update({ max_members: newMax })
    .eq("id", factionId)
    .select("*")
    .single();

  if (updErr || !updated) {
    console.warn("[factions] slot expansion update failed after edge deduction", updErr?.message);
    return { ok: false, error: "Slot expansion failed. Neurons were deducted — contact support." };
  }

  await supabase.from("faction_slot_purchases").insert({
    faction_id: factionId,
    user_id: userId,
    slots_purchased: slotsToBuy,
    edge_cost: costEntry.cost,
  });

  await supabase.from("faction_activity").insert({
    faction_id: factionId,
    user_id: userId,
    kind: "slots_expanded",
    details: { slots: slotsToBuy, cost: costEntry.cost, new_max: newMax },
  });

  return { ok: true, faction: updated as FactionRow, remainingBalance: updatedProfile };
}

// ── Member Profile Fetch ───────────────────────────────────────────────

/** Fetches public profile info (username, avatar_url) for a list of user IDs. */
export async function getMemberProfiles(
  userIds: string[],
): Promise<MemberProfileMap> {
  const map: MemberProfileMap = new Map();
  if (userIds.length === 0) return map;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, avatar_url")
    .in("id", userIds);
  if (error) return map;
  for (const row of (data ?? []) as { id: string; username: string | null; avatar_url: string | null }[]) {
    map.set(row.id, { username: row.username, avatar_url: row.avatar_url });
  }
  return map;
}

// ── Invites ────────────────────────────────────────────────────────────

export async function inviteToFaction(
  factionId: string,
  inviterId: string,
  inviteeId: string,
  role: FactionRole = "analyst",
): Promise<{ ok: boolean; error?: string }> {
  const { data: faction } = await supabase
    .from("factions")
    .select("max_members,current_members,commander_id,name")
    .eq("id", factionId)
    .maybeSingle();
  if (!faction) return { ok: false, error: "Faction not found." };

  const f = faction as { max_members: number; current_members: number; commander_id: string; name: string };
  if (f.commander_id !== inviterId) return { ok: false, error: "Only the Commander can send invites." };
  if (f.current_members >= f.max_members) return { ok: false, error: "Faction is at maximum capacity." };

  const { data: existingMember } = await supabase
    .from("faction_members")
    .select("id")
    .eq("faction_id", factionId)
    .eq("user_id", inviteeId)
    .maybeSingle();
  if (existingMember) return { ok: false, error: "User is already a member." };

  const { data: existingInvite } = await supabase
    .from("faction_invites")
    .select("id")
    .eq("faction_id", factionId)
    .eq("invitee_id", inviteeId)
    .eq("status", "pending")
    .maybeSingle();
  if (existingInvite) return { ok: false, error: "Invite already pending." };

  const { error } = await supabase.from("faction_invites").insert({
    faction_id: factionId,
    inviter_id: inviterId,
    invitee_id: inviteeId,
    role,
  });

  if (error) return { ok: false, error: error.message };

  await supabase.from("faction_activity").insert({
    faction_id: factionId,
    user_id: inviterId,
    kind: "invite_sent",
    details: { invitee_id: inviteeId, role },
  });

  return { ok: true };
}

/** Invite result type for the email/username invite flow. */
export type InviteByLookupResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Invite a user to a faction by email or username.
 *
 * SECURITY: Uses the secure worker endpoint to resolve the invitee.
 * Never exposes full user lookup results publicly.
 * Only exact matches on email or username are accepted.
 */
export async function inviteByEmailOrUsername(
  factionId: string,
  inviterId: string,
  query: string,
  role: FactionRole = "analyst",
): Promise<InviteByLookupResult> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, error: "Please enter an email or username." };

  // Call the secure worker endpoint to resolve and invite
  const functionsUrl = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL;
  if (!functionsUrl) {
    return { ok: false, error: "Server not configured." };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const jwt = sessionData.session?.access_token;
  if (!jwt) return { ok: false, error: "Authentication required." };

  try {
    const response = await fetch(`${functionsUrl}/factions/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        factionId,
        query: trimmed,
        role,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: data.error ?? "Failed to send invite." };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "Network error. Please try again." };
  }
}

export async function acceptInvite(
  inviteId: string,
  userId: string,
  profile: UserProfile,
  effectiveTier?: SubscriptionTier,
): Promise<JoinFactionResult> {
  const tier = effectiveTier ?? getEffectiveSubscriptionTier(profile);
  const limits = getFactionLimit(tier);
  if (!limits.canJoin) {
    return { ok: false, error: "Free users cannot join Factions." };
  }

  // Enforce member count per tier
  const currentCount = await countUserFactionMemberships(userId);
  if (currentCount >= limits.maxFactions) {
    return { ok: false, error: `Your ${tier} tier allows only ${limits.maxFactions} Faction${limits.maxFactions === 1 ? "" : "s"}. Leave one first.` };
  }

  const { data: invite } = await supabase
    .from("faction_invites")
    .select("*")
    .eq("id", inviteId)
    .eq("invitee_id", userId)
    .eq("status", "pending")
    .maybeSingle();
  if (!invite) return { ok: false, error: "Invite not found or no longer valid." };

  const inv = invite as FactionInviteRow;

  if (new Date(inv.expires_at) < new Date()) {
    await supabase.from("faction_invites").update({ status: "declined" }).eq("id", inviteId);
    return { ok: false, error: "This invite has expired." };
  }

  const result = await joinFaction(userId, profile, inv.faction_id);
  if (!result.ok) return result;

  await supabase.from("faction_invites").update({ status: "accepted" }).eq("id", inviteId);

  await supabase
    .from("faction_members")
    .update({ role: inv.role })
    .eq("faction_id", inv.faction_id)
    .eq("user_id", userId);

  await supabase.from("faction_activity").insert({
    faction_id: inv.faction_id,
    user_id: userId,
    kind: "invite_accepted",
    details: { role: inv.role },
  });

  return result;
}

export async function declineInvite(inviteId: string, userId: string): Promise<void> {
  const { data: invite } = await supabase
    .from("faction_invites")
    .select("faction_id")
    .eq("id", inviteId)
    .eq("invitee_id", userId)
    .maybeSingle();

  await supabase
    .from("faction_invites")
    .update({ status: "declined" })
    .eq("id", inviteId)
    .eq("invitee_id", userId);

  if (invite) {
    await supabase.from("faction_activity").insert({
      faction_id: (invite as { faction_id: string }).faction_id,
      user_id: userId,
      kind: "invite_declined",
      details: {},
    });
  }
}

export async function listPendingInvites(userId: string): Promise<FactionInviteRow[]> {
  const { data, error } = await supabase
    .from("faction_invites")
    .select("*")
    .eq("invitee_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as FactionInviteRow[];
}

// ── Role management ────────────────────────────────────────────────────

export async function promoteMember(
  factionId: string,
  commanderId: string,
  targetUserId: string,
  newRole: FactionRole,
): Promise<{ ok: boolean; error?: string }> {
  if (newRole === "commander") return { ok: false, error: "Cannot promote to Commander. Transfer command instead." };
  if (newRole === "dormant") return { ok: false, error: "Use setMemberDormant for dormancy." };

  const { error } = await supabase
    .from("faction_members")
    .update({ role: newRole })
    .eq("faction_id", factionId)
    .eq("user_id", targetUserId);

  if (error) return { ok: false, error: error.message };

  await supabase.from("faction_activity").insert({
    faction_id: factionId,
    user_id: commanderId,
    kind: "role_changed",
    details: { target_user_id: targetUserId, new_role: newRole },
  });

  return { ok: true };
}

// ── Scoring recalculation ──────────────────────────────────────────────

export async function recalculateFactionScore(factionId: string): Promise<void> {
  const { count: activeCount, error: countErr } = await supabase
    .from("faction_members")
    .select("id", { count: "exact", head: true })
    .eq("faction_id", factionId)
    .eq("status", "active");
  if (countErr) return;

  const { count: sharedCount, error: sharedErr } = await supabase
    .from("faction_shared_intelligence")
    .select("id", { count: "exact", head: true })
    .eq("faction_id", factionId);
  if (sharedErr) return;

  const { data: sharedEntries } = await supabase
    .from("faction_shared_intelligence")
    .select("oi_entry_id")
    .eq("faction_id", factionId);
  let avgQuality = 0;
  if (sharedEntries && sharedEntries.length > 0) {
    const entryIds = (sharedEntries as { oi_entry_id: string }[]).map((s) => s.oi_entry_id);
    const { data: oiRows } = await supabase
      .from("open_intelligence")
      .select("quality_score")
      .in("id", entryIds);
    if (oiRows && oiRows.length > 0) {
      const total = (oiRows as { quality_score: number }[]).reduce((sum, r) => sum + (r.quality_score ?? 0), 0);
      avgQuality = Math.round(total / oiRows.length);
    }
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: activityCount, error: actErr } = await supabase
    .from("faction_activity")
    .select("id", { count: "exact", head: true })
    .eq("faction_id", factionId)
    .gte("created_at", sevenDaysAgo);
  if (actErr) return;

  const { score } = computeFactionIntelScore(
    activeCount ?? 0,
    sharedCount ?? 0,
    avgQuality,
    activityCount ?? 0,
  );

  await supabase
    .from("factions")
    .update({ influence_score: score })
    .eq("id", factionId);
}

// ── Status indicator helpers ───────────────────────────────────────────

export function getMemberStatusLabel(status: MemberStatus): string {
  switch (status) {
    case "active": return "Active Analyst";
    case "grace_period": return "Grace Period";
    case "dormant": return "Dormant Analyst";
  }
}

export function getMemberStatusColor(status: MemberStatus): "cyan" | "gold" | "ember" {
  switch (status) {
    case "active": return "cyan";
    case "grace_period": return "gold";
    case "dormant": return "ember";
  }
}

export function getRoleLabel(role: FactionRole): string {
  switch (role) {
    case "commander": return "Commander";
    case "strategist": return "Strategist";
    case "analyst": return "Analyst";
    case "recruit": return "Recruit";
    case "dormant": return "Dormant";
  }
}
