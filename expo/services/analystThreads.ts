/**
 * Analyst Threads — persistent chat sessions for analyst session types.
 *
 * Every analyst session (Quick Check, Quick Analysis, Standard Analysis,
 * Oracle Deep Dive, Premium Event Analysis) creates a persistent thread.
 * Users can continue asking follow-up questions inside the same thread.
 *
 * All data lives in Supabase tables:
 *   - analyst_threads
 *   - analyst_messages
 */

import { supabase } from "@/lib/supabase";
import type { AnalystSessionType } from "@/services/analyst";

// ── Types ──────────────────────────────────────────────────────────────────

export type AnalystThread = {
  id: string;
  user_id: string;
  eagoh_id: string | null;
  session_type: AnalystSessionType;
  title: string;
  domain: string | null;
  created_at: string;
  updated_at: string;
};

export type AnalystMessage = {
  id: string;
  thread_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  edge_cost: number;
  created_at: string;
  visual_blocks?: unknown[] | null;
};

export type ThreadWithMeta = AnalystThread & {
  eagoh_name?: string;
  eagoh_image_url?: string | null;
  eagoh_image_thumb_url?: string | null;
  message_count: number;
  last_message_preview: string | null;
};

/** Raw thread row from Supabase (eagoh_id may be null). */
type ThreadRow = {
  id: string;
  user_id: string;
  eagoh_id: string | null;
  session_type: string;
  title: string;
  domain: string | null;
  created_at: string;
  updated_at: string;
  eagohs: { name: string | null; image_url: string | null; image_thumb_url: string | null } | null;
};

// ── Thread CRUD ────────────────────────────────────────────────────────────

/** Create a new analyst thread. Returns the created thread row. */
export async function createThread(params: {
  userId: string;
  /** null for Quick Check with virtual fallback EAGOH. */
  eagohId: string | null;
  sessionType: AnalystSessionType;
  title: string;
  domain?: string | null;
}): Promise<AnalystThread> {
  const { data, error } = await supabase
    .from("analyst_threads")
    .insert({
      user_id: params.userId,
      eagoh_id: params.eagohId,
      session_type: params.sessionType,
      title: params.title.slice(0, 200),
      domain: params.domain ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as AnalystThread;
}

/**
 * List recent threads for a user, newest first.
 *
 * Supports offset-based pagination so callers can load incrementally
 * (e.g. the Analyst Archive loads 10 at a time via Load More).
 * The `offset` parameter skips the first `offset` rows before taking `limit`.
 */
export async function listThreads(
  userId: string,
  limit: number = 20,
  offset: number = 0,
): Promise<ThreadWithMeta[]> {
  const { data, error } = await supabase
    .from("analyst_threads")
    .select(`
      *,
      eagohs (name, image_url, image_thumb_url)
    `)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  const threads = (data ?? []) as ThreadRow[];

  // Enrich with message count and preview
  const enriched: ThreadWithMeta[] = [];
  for (const t of threads) {
    const { count } = await supabase
      .from("analyst_messages")
      .select("*", { count: "exact", head: true })
      .eq("thread_id", t.id);

    const { data: lastMsg } = await supabase
      .from("analyst_messages")
      .select("content")
      .eq("thread_id", t.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    enriched.push({
      id: t.id,
      user_id: t.user_id,
      eagoh_id: t.eagoh_id,
      session_type: t.session_type as AnalystSessionType,
      title: t.title,
      domain: t.domain,
      created_at: t.created_at,
      updated_at: t.updated_at,
      eagoh_name: t.eagohs?.name ?? undefined,
      eagoh_image_url: t.eagohs?.image_url ?? null,
      eagoh_image_thumb_url: t.eagohs?.image_thumb_url ?? null,
      message_count: count ?? 0,
      last_message_preview: lastMsg?.content?.slice(0, 80) ?? null,
    });
  }

  return enriched;
}

/** Get a single thread by id. */
export async function getThread(threadId: string): Promise<AnalystThread | null> {
  const { data, error } = await supabase
    .from("analyst_threads")
    .select("*")
    .eq("id", threadId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data as AnalystThread;
}

/** Delete a thread and all its messages (cascade). */
export async function deleteThread(threadId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("analyst_threads")
    .delete()
    .eq("id", threadId)
    .eq("user_id", userId);

  if (error) throw error;
}

// ── Message CRUD ──────────────────────────────────────────────────────────

/** Add a message to a thread. */
export async function addMessage(params: {
  threadId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  edgeCost?: number;
  visualBlocks?: unknown[] | null;
}): Promise<AnalystMessage> {
  const insertObj: Record<string, unknown> = {
    thread_id: params.threadId,
    user_id: params.userId,
    role: params.role,
    content: params.content,
    edge_cost: params.edgeCost ?? 0,
  };
  if (params.visualBlocks && Array.isArray(params.visualBlocks) && params.visualBlocks.length > 0) {
    insertObj.visual_blocks = params.visualBlocks;
  }
  const { data, error } = await supabase
    .from("analyst_messages")
    .insert(insertObj)
    .select("*")
    .single();

  if (error) throw error;

  // Touch thread updated_at
  await supabase
    .from("analyst_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", params.threadId);

  return data as AnalystMessage;
}

/** List all messages for a thread, oldest first. */
export async function listMessages(threadId: string): Promise<AnalystMessage[]> {
  const { data, error } = await supabase
    .from("analyst_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as AnalystMessage[];
}

/** Auto-generate a short thread title from the first user message. */
export function generateThreadTitle(firstMessage: string): string {
  const cleaned = firstMessage.replace(/\n/g, " ").trim();
  if (cleaned.length <= 60) return cleaned;
  return cleaned.slice(0, 57) + "...";
}
