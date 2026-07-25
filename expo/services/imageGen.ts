/**
 * EAGOH image generation — server-side proxy client.
 *
 * This module NO LONGER calls the Rork Toolkit or OpenAI directly from the
 * mobile app. Instead it delegates to the secure Cloudflare Worker route
 * `/forge/generate` which:
 *   - Authenticates the user via Supabase JWT
 *   - Checks tier, EAGOH limit, and Neuron balance
 *   - Generates the image server-side (OpenAI key never reaches the client)
 *   - Creates/updates the EAGOH row
 *   - Deducts Neurons atomically (refunds on failure)
 *
 * The client only sends the pre-built prompt, draft, mode, and JWT.
 */

import { supabase } from "@/lib/supabase";

const FUNCTIONS_BASE_URL = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL ?? "";

export type ImageGenSize = "1024x1024" | "1024x1536" | "1536x1024";

export type ImageGenResult =
  | { ok: true; imageUrl: string; thumbUrl: string | null; model: string }
  | { ok: false; error: string };

/**
 * Get the current Supabase access token for authenticating with the worker.
 */
async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Request image generation from the secure worker endpoint.
 *
 * The worker handles: auth verification, tier check, EAGOH limit check,
 * OpenAI image generation, EAGOH row create/update, and Neuron deduction.
 * If any step fails after image generation, the worker rolls back and
 * no Neurons are charged.
 */
export async function generateEagohImage(request: {
  prompt: string;
  mode: "initial" | "full_reforge" | "partial_reforge";
  draft: Record<string, unknown>;
  eagohId?: string;
  scope?: string;
  size?: ImageGenSize;
}): Promise<ImageGenResult> {
  if (!FUNCTIONS_BASE_URL) {
    return { ok: false, error: "Forge service is not configured." };
  }

  const prompt = request.prompt?.trim();
  if (!prompt) return { ok: false, error: "Prompt is required." };

  const accessToken = await getAccessToken();
  if (!accessToken) {
    return { ok: false, error: "Please sign in again." };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min for image gen

    const response = await fetch(`${FUNCTIONS_BASE_URL}/forge/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        mode: request.mode,
        scope: request.scope ?? "full",
        eagohId: request.eagohId,
        prompt,
        size: request.size ?? "1024x1536",
        draft: request.draft,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      const msg = data.error ?? `Forge service returned ${response.status}.`;
      console.warn("[imageGen] worker error", { status: response.status, msg: msg.slice(0, 200) });
      return { ok: false, error: msg };
    }

    const data = (await response.json()) as {
      ok: boolean;
      imageUrl?: string;
      thumbUrl?: string;
    };

    if (!data.ok || !data.imageUrl) {
      return { ok: false, error: "Forge service returned no image." };
    }

    return {
      ok: true,
      imageUrl: data.imageUrl,
      thumbUrl: data.thumbUrl ?? data.imageUrl,
      model: "gpt-image-1",
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "Image generation timed out. Please try again." };
    }
    console.warn("[imageGen] error", error instanceof Error ? error.message : "Unknown");
    return { ok: false, error: "Image generation failed. Check your connection and try again." };
  }
}
