import { supabase } from "@/lib/supabase";

/**
 * Knowledge Credentials service – public domain expertise for EAGOH sources.
 *
 * Table: public.user_knowledge_credentials
 *   - user_id (uuid, unique, FK → auth.users)
 *   - public_title, domain_expertise, experience_summary, accolades,
 *     relevant_background, years_experience, credibility_tags (jsonb), is_public
 *
 * Privacy: only information the user is comfortable showing publicly.
 * No legal name, address, phone, employer, IDs, finances, or medical data.
 */

export type KnowledgeCredentialsRow = {
  id: string;
  user_id: string;
  public_title: string | null;
  domain_expertise: string | null;
  experience_summary: string | null;
  accolades: string | null;
  relevant_background: string | null;
  years_experience: number | null;
  credibility_tags: string[];
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

export type KnowledgeCredentialsInput = Omit<
  KnowledgeCredentialsRow,
  "id" | "user_id" | "created_at" | "updated_at"
>;

/** Fetch knowledge credentials for a user (respects RLS). */
export async function getKnowledgeCredentials(
  userId: string,
): Promise<KnowledgeCredentialsRow | null> {
  const { data, error } = await supabase
    .from("user_knowledge_credentials")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as KnowledgeCredentialsRow | null) ?? null;
}

/** Upsert knowledge credentials for the current user. */
export async function upsertKnowledgeCredentials(
  userId: string,
  input: KnowledgeCredentialsInput,
): Promise<KnowledgeCredentialsRow> {
  const now = new Date().toISOString();
  const row = {
    user_id: userId,
    public_title: input.public_title ?? null,
    domain_expertise: input.domain_expertise ?? null,
    experience_summary: input.experience_summary ?? null,
    accolades: input.accolades ?? null,
    relevant_background: input.relevant_background ?? null,
    years_experience: input.years_experience ?? null,
    credibility_tags: input.credibility_tags ?? [],
    is_public: input.is_public ?? true,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from("user_knowledge_credentials")
    .upsert(row, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as KnowledgeCredentialsRow;
}

/** Delete knowledge credentials for the current user. */
export async function deleteKnowledgeCredentials(userId: string): Promise<void> {
  const { error } = await supabase
    .from("user_knowledge_credentials")
    .delete()
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * Bulk check which user IDs have knowledge credentials.
 * Returns a Set of user IDs that have credentials.
 * Used by marketplace to determine which cards get the "Source Credentials" label.
 */
export async function getBulkHasCredentials(
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("user_knowledge_credentials")
    .select("user_id")
    .in("user_id", userIds);
  if (error) {
    console.warn("[knowledgeCredentials] bulk check failed", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r: { user_id: string }) => r.user_id));
}
