/**
 * Social Share Verification service — allows a user to share one of their
 * EAGOHs on social media and verify the public post to earn 5 Neurons.
 *
 * All reward logic is server-side. The mobile client cannot mark a share
 * verified, award Neurons, or increment verified share count directly.
 *
 * Worker endpoints:
 *   POST /social/share/create   — create share attempt + verification code
 *   POST /social/share/verify   — verify a public post URL + award reward
 *   GET  /social/share/attempts — list caller's share attempt history
 *   GET  /social/share/status   — get verified share count + badge progress
 */

import { supabase } from "@/lib/supabase";

const FUNCTIONS_BASE_URL =
  (process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL ?? "").trim() ||
  "https://eagoh-mobile-app-backend.rork.app";

// ── Types ───────────────────────────────────────────────────────────────

export type ShareAttemptStatus =
  | "share_created"
  | "verification_pending"
  | "verified"
  | "manual_review"
  | "rejected"
  | "already_verified"
  | "expired";

export type ShareAttempt = {
  id: string;
  eagoh_id: string;
  eagoh_name: string;
  verification_code: string;
  public_eagoh_url: string;
  status: ShareAttemptStatus;
  platform: string | null;
  submitted_post_url: string | null;
  reward_awarded: boolean;
  reward_amount: number;
  created_at: string;
  verified_at: string | null;
  expires_at: string;
  rejection_reason: string | null;
};

export type BadgeInfo = {
  name: string;
  threshold: number;
  unlocked: boolean;
};

export type ShareStatus = {
  ok: boolean;
  verifiedShareCount: number;
  currentBadge: { name: string; threshold: number } | null;
  nextBadge: { name: string; threshold: number; remaining: number } | null;
  badges: BadgeInfo[];
};

export type CreateShareResult = {
  ok: boolean;
  attemptId: string;
  eagohId: string;
  eagohName: string;
  eagohImageUrl: string | null;
  eagohThumbUrl: string | null;
  creatorName: string;
  verificationCode: string;
  publicEagohUrl: string;
  shareContent: string;
  expiresAt: string;
  qrCodeUrl: string;
};

export type VerifyShareResult = {
  ok: boolean;
  status: ShareAttemptStatus | "verified";
  rewardAmount?: number;
  newVerifiedShareCount?: number;
  newEdgePurchased?: number;
  message?: string;
  error?: string;
  skipped?: boolean;
};

// ── API helpers ─────────────────────────────────────────────────────────

async function postAuthed(path: string, body: Record<string, unknown>): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) throw new Error("Not authenticated.");
  return fetch(`${FUNCTIONS_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
}

async function getAuthed(path: string): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) throw new Error("Not authenticated.");
  return fetch(`${FUNCTIONS_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  });
}

// ── Public API ──────────────────────────────────────────────────────────

/** Create a new social share attempt for one of the caller's EAGOHs. */
export async function createShareAttempt(eagohId: string): Promise<CreateShareResult> {
  const resp = await postAuthed("/social/share/create", { eagohId });
  const data = (await resp.json()) as CreateShareResult & { error?: string };
  if (!resp.ok || !data.ok) {
    throw new Error(data.error ?? "Could not create share attempt.");
  }
  return data;
}

/** Verify a public social post URL and award the reward if valid. */
export async function verifyShareAttempt(
  attemptId: string,
  postUrl: string,
): Promise<VerifyShareResult> {
  const resp = await postAuthed("/social/share/verify", { attemptId, postUrl });
  const data = (await resp.json()) as VerifyShareResult;
  return data;
}

/** Get the caller's share attempt history. */
export async function getShareAttempts(): Promise<ShareAttempt[]> {
  const resp = await getAuthed("/social/share/attempts");
  const data = (await resp.json()) as { ok: boolean; attempts: ShareAttempt[]; error?: string };
  if (!data.ok) throw new Error(data.error ?? "Could not load share history.");
  return data.attempts ?? [];
}

/** Get the caller's verified share count and badge progress. */
export async function getShareStatus(): Promise<ShareStatus> {
  const resp = await getAuthed("/social/share/status");
  const data = (await resp.json()) as ShareStatus;
  return data;
}

// ── Badge definitions (client-side display only; server is source of truth) ──

export const SHARE_BADGES: { name: string; threshold: number }[] = [
  { name: "Neural Scout", threshold: 5 },
  { name: "Synapse Builder", threshold: 25 },
  { name: "Cortex Architect", threshold: 100 },
  { name: "Neural Vanguard", threshold: 500 },
  { name: "Oracle Ascendant", threshold: 1000 },
];

export const SHARE_REWARD_AMOUNT = 5;

/** Display label for a share attempt status. */
export function statusLabel(status: ShareAttemptStatus): string {
  switch (status) {
    case "share_created": return "Share Created";
    case "verification_pending": return "Verification Pending";
    case "verified": return "Verified";
    case "manual_review": return "Manual Review Required";
    case "rejected": return "Rejected";
    case "already_verified": return "Already Verified";
    case "expired": return "Expired";
    default: return status;
  }
}

/** Color tone for a share attempt status. */
export function statusTone(status: ShareAttemptStatus): "success" | "cyan" | "gold" | "ember" | "muted" {
  switch (status) {
    case "verified": return "success";
    case "manual_review": return "gold";
    case "rejected": return "ember";
    case "already_verified": return "ember";
    case "expired": return "muted";
    case "verification_pending": return "cyan";
    case "share_created": return "cyan";
    default: return "muted";
  }
}
