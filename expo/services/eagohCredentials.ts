import { supabase } from "@/lib/supabase";

/**
 * EAGOH-specific Knowledge Credentials service.
 *
 * Table: public.eagoh_knowledge_credentials
 * Each EAGOH gets one credentials record. Credentials are tied to the
 * EAGOH's domain and are publicly visible when is_public = true.
 *
 * Privacy: no email, phone, address, government ID, or private employer data.
 */

export type EagohCredentialsRow = {
  id: string;
  user_id: string;
  eagoh_id: string;
  domain: string;
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

export type EagohCredentialsInput = Omit<
  EagohCredentialsRow,
  "id" | "user_id" | "created_at" | "updated_at"
>;

/** Fetch knowledge credentials for a specific EAGOH (owner access, respects RLS). */
export async function getEagohCredentials(
  eagohId: string,
): Promise<EagohCredentialsRow | null> {
  const { data, error } = await supabase
    .from("eagoh_knowledge_credentials")
    .select("*")
    .eq("eagoh_id", eagohId)
    .maybeSingle();
  if (error) throw error;
  return (data as EagohCredentialsRow | null) ?? null;
}

/** Upsert knowledge credentials for a specific EAGOH. */
export async function upsertEagohCredentials(
  userId: string,
  eagohId: string,
  input: EagohCredentialsInput,
): Promise<EagohCredentialsRow> {
  const now = new Date().toISOString();
  const row = {
    user_id: userId,
    eagoh_id: eagohId,
    domain: input.domain,
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
    .from("eagoh_knowledge_credentials")
    .upsert(row, { onConflict: "eagoh_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as EagohCredentialsRow;
}

/** Delete knowledge credentials for a specific EAGOH. */
export async function deleteEagohCredentials(eagohId: string): Promise<void> {
  const { error } = await supabase
    .from("eagoh_knowledge_credentials")
    .delete()
    .eq("eagoh_id", eagohId);
  if (error) throw error;
}

/**
 * Fetch credentials for a specific EAGOH that are public (for marketplace info modals).
 * No auth required — only returns rows where is_public = true.
 */
export async function getPublicEagohCredentials(
  eagohId: string,
): Promise<EagohCredentialsRow | null> {
  const { data, error } = await supabase
    .from("eagoh_knowledge_credentials")
    .select("*")
    .eq("eagoh_id", eagohId)
    .eq("is_public", true)
    .maybeSingle();
  if (error) {
    console.warn("[eagohCredentials] public fetch failed", error.message);
    return null;
  }
  return (data as EagohCredentialsRow | null) ?? null;
}

/**
 * Bulk check which EAGOH IDs have knowledge credentials (public only).
 * Used by marketplace to determine which listing cards get the "Source Credentials" label.
 */
export async function getBulkEagohHasCredentials(
  eagohIds: string[],
): Promise<Set<string>> {
  if (eagohIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("eagoh_knowledge_credentials")
    .select("eagoh_id")
    .in("eagoh_id", eagohIds)
    .eq("is_public", true);
  if (error) {
    console.warn("[eagohCredentials] bulk check failed", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r: { eagoh_id: string }) => r.eagoh_id));
}
