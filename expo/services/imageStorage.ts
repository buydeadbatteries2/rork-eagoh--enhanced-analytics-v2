/**
 * EAGOH image storage utilities.
 *
 * Generated images are CDN-hosted by the image model provider. We persist:
 *  - the canonical URL on the EAGOH row (`image_url`)
 *  - an optimized thumbnail URL when one is available (`image_thumb_url`)
 *  - the structured prompt (`image_prompt`) for reforge history
 *  - a row in `eagoh_image_generations` for full history (lazy-loaded)
 *
 * Lazy-load compatible: every consumer should pass these URLs straight into
 * React Native's `<Image>` which handles caching natively. Use `getThumbUrl`
 * to defer high-resolution loads until visible.
 */

import { supabase } from "@/lib/supabase";

export type ImageGenerationMode = "initial" | "full_reforge" | "partial_reforge";

export type ImageGenerationLog = {
  id: string;
  eagoh_id: string;
  user_id: string;
  mode: ImageGenerationMode;
  prompt: string;
  image_url: string;
  thumb_url: string | null;
  edge_cost: number;
  meta: Record<string, unknown>;
  created_at: string;
};

/** Returns the best lazy-load URL for a thumbnail (falls back to full URL). */
export function getThumbUrl(
  record: { image_thumb_url?: string | null; image_url?: string | null } | null | undefined,
): string | null {
  if (!record) return null;
  return record.image_thumb_url ?? record.image_url ?? null;
}

/** Returns the full-resolution URL, deferred to high-priority loads. */
export function getFullUrl(record: { image_url?: string | null } | null | undefined): string | null {
  if (!record) return null;
  return record.image_url ?? null;
}

/** Append a generation log row. Fails silently — the canonical record is `eagohs`. */
export async function logImageGeneration(entry: {
  eagohId: string;
  userId: string;
  mode: ImageGenerationMode;
  prompt: string;
  imageUrl: string;
  thumbUrl?: string | null;
  edgeCost: number;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from("eagoh_image_generations").insert({
    eagoh_id: entry.eagohId,
    user_id: entry.userId,
    mode: entry.mode,
    prompt: entry.prompt,
    image_url: entry.imageUrl,
    thumb_url: entry.thumbUrl ?? null,
    edge_cost: entry.edgeCost,
    meta: entry.meta ?? {},
  });
  if (error) console.warn("[imageStorage] log failed", error.message);
}

export async function listImageHistory(eagohId: string, limit: number = 10): Promise<ImageGenerationLog[]> {
  const { data, error } = await supabase
    .from("eagoh_image_generations")
    .select("*")
    .eq("eagoh_id", eagohId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ImageGenerationLog[];
}
