/**
 * Analyst AI service layer.
 *
 * Secure, grounded wrapper around the `/analyst/chat` Cloudflare Worker.
 *
 * The worker handles:
 *   - JWT authentication
 *   - EAGOH ownership verification
 *   - Open Intelligence retrieval & relevance ranking
 *   - External current-research search
 *   - Structured prompt assembly with source labeling
 *
 * Client responsibilities:
 *   - Send the Supabase access token as Bearer auth
 *   - Send eagohId + structured conversationContext (never raw OI)
 *   - Display grounding metadata in the UI
 *
 * No API keys, private OI content, or service-role tokens ever reach the client.
 */

import { supabase } from "@/lib/supabase";
import { normalizeDomainId } from "./domains";
import { parseVisualBlocks, type VisualBlock } from "@/components/analysis/visualBlockTypes";

// ── Types ──────────────────────────────────────────────────────────────────

export type AnalystSessionType =
  | "quick-check"
  | "quick-analytics"
  | "standard"
  | "oracle"
  | "premium-event";

export type AnalystPersonality =
  | "tactical"
  | "calm"
  | "aggressive"
  | "oracle"
  | "fanatic";

export type AnalystRequestKind =
  | "matchup"
  | "player_confidence"
  | "team_analysis"
  | "general";

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type PersonalGrounding = {
  personalOpenIntelligenceUsed: boolean;
  personalOpenIntelligenceCount: number;
  factionIntelligenceUsed: boolean;
  factionIntelligenceCount: number;
  exchangeIntelligenceUsed: boolean;
  exchangeIntelligenceCount: number;
  externalSearchUsed: boolean;
  sourceCount: number;
  exchangeAccess?: {
    activeSyncCount: number;
    vendorEagohCount: number;
  };
};

export type AnalystSource = {
  title: string;
  url: string;
  publisher?: string;
  publishedAt?: string;
};

export type AnalystCallInput = {
  prompt: string;
  sessionType: AnalystSessionType;
  /** The EAGOH's Supabase UUID (null for virtual Quick Check). */
  eagohId: string | null;
  kind?: AnalystRequestKind;
  personality?: AnalystPersonality;
  /** Structured conversation history — never raw OI context. */
  conversationContext?: ConversationMessage[];
};

export type AnalystCallResult = {
  ok: true;
  reply: string;
  model: string;
  sessionType: AnalystSessionType;
  confidence: number;
  grounding: PersonalGrounding;
  sources: AnalystSource[];
  visualBlocks: VisualBlock[] | null;
};

/** Specific error codes returned by the Cloudflare worker. */
export type AnalystErrorCode =
  | "missing_api_key"
  | "missing_config"
  | "invalid_request"
  | "unauthorized"
  | "eagoh_not_found"
  | "openai_error"
  | "openai_rate_limit"
  | "openai_empty_response"
  | "network_error"
  | "timeout"
  | "not_implemented"
  | "unknown";

export type AnalystCallError = {
  ok: false;
  /** Machine-readable error code. */
  errorCode: AnalystErrorCode;
  /** User-facing message. */
  error: string;
  /** Safe fallback reply shown when the real analyst can't respond. */
  fallback: string;
};

export type AnalystResponse = AnalystCallResult | AnalystCallError;

// ── Constants ──────────────────────────────────────────────────────────────

const FUNCTIONS_BASE_URL = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL;

/** Edge cost range per Quick Check (1–3). */
export const QUICK_CHECK_EDGE_RANGE = { min: 1, max: 3 } as const;

/**
 * Compute the Edge cost for a Quick Check based on prompt complexity.
 */
export function getQuickCheckCost(prompt: string): number {
  const trimmed = prompt.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const questionMarks = (trimmed.match(/\?/g) ?? []).length;
  if (wordCount <= 12 && questionMarks <= 1) return 1;
  if (wordCount <= 30 && questionMarks <= 2) return 2;
  return 3;
}

const PERSONALITY_PRESETS: Record<AnalystPersonality, string> = {
  tactical:
    "Speak with calm tactical precision. Use confident, clipped sentences and surface the single sharpest read.",
  calm:
    "Speak with composed analytical clarity. Reduce volatility, frame risk with steady reassurance.",
  aggressive:
    "Speak with high-intensity conviction. Lead with the boldest tactical edge but never overpromise certainty.",
  oracle:
    "Speak as a premium oracle: thoughtful, layered, slightly cinematic. Frame reads as forecasts, not facts.",
  fanatic:
    "Speak with emotionally-aware fanatic intelligence — loyal to the team narrative, but honest about the risk pocket.",
};

const KIND_FRAMES: Record<AnalystRequestKind, string> = {
  matchup:
    "This is a matchup question. Compare strengths, expose the asymmetry, and surface the decisive variable.",
  player_confidence:
    "This is a player confidence question. Read momentum, fatigue, emotional volatility, and tactical fit.",
  team_analysis:
    "This is a team analysis request. Map identity, pressure response, and structural risk in two or three beats.",
  general:
    "This is a general signal question. Return one tactical read with a clear confidence frame.",
};

const SESSION_BUDGETS: Record<AnalystSessionType, { sentences: number; baseConfidence: number }> = {
  "quick-check": { sentences: 3, baseConfidence: 82 },
  "quick-analytics": { sentences: 5, baseConfidence: 86 },
  standard: { sentences: 7, baseConfidence: 89 },
  oracle: { sentences: 10, baseConfidence: 93 },
  "premium-event": { sentences: 8, baseConfidence: 90 },
};

// ── User-facing error messages per error code ──────────────────────────────

/** Edge cost ranges per session type. */
const SESSION_COST_RANGES: Record<AnalystSessionType, { min: number; max: number }> = {
  "quick-check": { min: 1, max: 3 },
  "quick-analytics": { min: 10, max: 15 },
  standard: { min: 40, max: 75 },
  oracle: { min: 150, max: 300 },
  "premium-event": { min: 75, max: 150 },
};

/**
 * Estimate Edge cost for any session type based on prompt complexity.
 */
export function getSessionCost(sessionType: string, prompt: string): number {
  const range = SESSION_COST_RANGES[sessionType as AnalystSessionType];
  if (!range) return 1;
  const trimmed = prompt.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const questionMarks = (trimmed.match(/\?/g) ?? []).length;
  if (wordCount <= 12 && questionMarks <= 1) return range.min;
  if (wordCount <= 30 && questionMarks <= 2) return Math.round((range.min + range.max) / 2);
  return range.max;
}

const ERROR_MESSAGES: Record<AnalystErrorCode, string> = {
  missing_api_key: "Analyst service is not configured.",
  missing_config: "Analyst service is not fully configured.",
  invalid_request: "Invalid session request.",
  unauthorized: "Please sign in again.",
  eagoh_not_found: "Selected EAGOH not found or access denied.",
  openai_error: "Analysis could not be completed. Please try again.",
  openai_rate_limit: "Analyst service is temporarily busy. Please try again.",
  openai_empty_response: "Analyst returned an empty response.",
  network_error: "No internet connection. Please check your connection and try again.",
  timeout: "This analysis is taking longer than expected. You can keep waiting or try again.",
  not_implemented: "This analyst session is coming online soon.",
  unknown: "Analyst service is temporarily unavailable.",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function buildSystemHints(input: AnalystCallInput): string {
  const personality = PERSONALITY_PRESETS[input.personality ?? "tactical"];
  const frame = KIND_FRAMES[input.kind ?? "general"];
  const budget = SESSION_BUDGETS[input.sessionType];
  const limit =
    input.sessionType === "quick-check"
      ? `Reply in no more than ${budget.sentences} short sentences. No preamble. No filler.`
      : `Reply in no more than ${budget.sentences} sentences.`;
  return [personality, frame, limit].join(" ");
}

function localFallback(input: AnalystCallInput): string {
  if (input.sessionType === "quick-check") {
    return "Fallback read: conditional edge, not a lock. Watch fatigue, lineup chemistry, and pressure response before committing Edge.";
  }
  return "Fallback read: the tactical signal is worth watching, but I'd wait for one more validation point before treating it as a true edge.";
}

/**
 * Sanitise a prompt for logging — truncate and strip line breaks.
 */
function sanitizeForLog(text: string): string {
  return text.slice(0, 120).replace(/\n/g, " ");
}

/**
 * Parse the worker error response into a specific AnalystErrorCode.
 */
function classifyWorkerError(
  httpStatus: number,
  errorCode?: string,
  errorMessage?: string,
): AnalystErrorCode {
  // Worker returns specific errorCode strings
  if (errorCode === "missing_api_key") return "missing_api_key";
  if (errorCode === "missing_config") return "missing_config";
  if (errorCode === "invalid_request") return "invalid_request";
  if (errorCode === "unauthorized") return "unauthorized";
  if (errorCode === "eagoh_not_found") return "eagoh_not_found";
  if (errorCode === "openai_rate_limit") return "openai_rate_limit";
  if (errorCode === "openai_empty_response") return "openai_empty_response";
  if (errorCode === "openai_error") return "openai_error";

  // Fall back to HTTP status heuristics
  if (httpStatus === 401) return "unauthorized";
  if (httpStatus === 403) return "eagoh_not_found";
  if (httpStatus === 503) return "missing_config";
  if (httpStatus === 429) return "openai_rate_limit";
  if (httpStatus === 502 || httpStatus === 500) return "openai_error";
  if (httpStatus === 400) return "invalid_request";

  // Check message content
  if (errorMessage?.toLowerCase().includes("rate")) return "openai_rate_limit";
  if (errorMessage?.toLowerCase().includes("empty")) return "openai_empty_response";
  if (errorMessage?.toLowerCase().includes("auth")) return "unauthorized";

  return "unknown";
}

// ── Diagnostic logger (development only) ───────────────────────────────────

let devLogId = 0;

function devLog(
  event: "request" | "response" | "error",
  details: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV === "production") return;
  const id = ++devLogId;
  const prefix = `[analyst:#${id}]`;
  // eslint-disable-next-line no-console
  console.log(
    `${prefix} ${event}`,
    JSON.stringify(details, null, 0),
  );
}

// ── Core call ──────────────────────────────────────────────────────────────

/**
 * Lightweight service availability check — pings the functions endpoint.
 */
export async function verifyAnalystService(): Promise<{ ok: boolean; error?: string }> {
  if (!FUNCTIONS_BASE_URL) {
    return { ok: false, error: "Analyst service URL not configured." };
  }
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/ping`, { method: "GET" });
    const data = (await res.json()) as { ok?: boolean };
    if (res.ok && data.ok) return { ok: true };
    return { ok: false, error: `Service returned status ${res.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Unable to reach analyst service: ${message}` };
  }
}

/**
 * Get the current Supabase access token for authenticating with the worker.
 * Returns null if the user is not signed in.
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
 * Core analyst call. All session types route through this.
 *
 * Sends a structured request with eagohId and conversationContext.
 * The worker handles OI retrieval, ranking, and external search server-side.
 *
 * @param eagohMeta — optional EAGOH metadata for client-side diagnostic logging.
 */
async function callAnalyst(
  input: AnalystCallInput,
  eagohMeta?: { id: string; name: string; domain: string },
): Promise<AnalystResponse> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return {
      ok: false,
      errorCode: "invalid_request",
      error: "Prompt is empty.",
      fallback: localFallback(input),
    };
  }

  const normalizedDomain = eagohMeta?.domain ? normalizeDomainId(eagohMeta.domain) : "none";

  // Log request
  devLog("request", {
    eagohId: input.eagohId ?? "none",
    eagohName: eagohMeta?.name ?? "none",
    eagohDomain: eagohMeta?.domain ?? "none",
    normalizedDomain,
    sessionType: input.sessionType,
    personality: input.personality ?? "tactical",
    kind: input.kind ?? "general",
    promptPreview: sanitizeForLog(prompt),
    promptLength: prompt.length,
    conversationContextCount: input.conversationContext?.length ?? 0,
    functionsBaseUrl: FUNCTIONS_BASE_URL ? "configured" : "missing",
  });

  if (!FUNCTIONS_BASE_URL) {
    devLog("error", { reason: "missing_functions_url" });
    return {
      ok: false,
      errorCode: "network_error",
      error: ERROR_MESSAGES.network_error,
      fallback: localFallback(input),
    };
  }

  // Get access token for auth
  const accessToken = await getAccessToken();
  if (!accessToken) {
    devLog("error", { reason: "no_access_token" });
    return {
      ok: false,
      errorCode: "unauthorized",
      error: ERROR_MESSAGES.unauthorized,
      fallback: localFallback(input),
    };
  }

  // Build the grounded request payload (no raw OI context)
  const payload = {
    prompt,
    sessionType: input.sessionType,
    eagohId: input.eagohId,
    personality: input.personality ?? "tactical",
    kind: input.kind ?? "general",
    conversationContext: input.conversationContext ?? [],
  };

  let response: Response;
  try {
    // Client-side timeout — generous limits so normal analysis doesn't timeout
    const timeoutMs =
      input.sessionType === "quick-check" ? 45000 :
      input.sessionType === "quick-analytics" ? 75000 :
      input.sessionType === "standard" ? 90000 :
      input.sessionType === "oracle" ? 120000 :
      input.sessionType === "premium-event" ? 120000 : 90000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      response = await fetch(`${FUNCTIONS_BASE_URL}/analyst/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (fetchError) {
    const message = fetchError instanceof Error ? fetchError.message : "Unknown fetch error";
    devLog("error", {
      reason: "network_error",
      fetchMessage: message,
      isTimeout: message.toLowerCase().includes("timeout") || message.toLowerCase().includes("abort"),
    });
    const isTimeout = message.toLowerCase().includes("timeout") || message.toLowerCase().includes("abort");
    return {
      ok: false,
      errorCode: isTimeout ? "timeout" : "network_error",
      error: isTimeout ? ERROR_MESSAGES.timeout : ERROR_MESSAGES.network_error,
      fallback: localFallback(input),
    };
  }

  // Parse response body
  let data: {
    ok?: boolean;
    reply?: string;
    model?: string;
    sessionType?: AnalystSessionType;
    confidence?: number;
    grounding?: PersonalGrounding;
    sources?: AnalystSource[];
    visualBlocks?: unknown;
    error?: string;
    errorCode?: string;
  };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    devLog("error", {
      reason: "invalid_json_response",
      httpStatus: response.status,
    });
    return {
      ok: false,
      errorCode: "openai_error",
      error: ERROR_MESSAGES.openai_error,
      fallback: localFallback(input),
    };
  }

  // Log response
  devLog("response", {
    httpStatus: response.status,
    ok: data.ok ?? false,
    errorCode: data.errorCode ?? "none",
    error: data.error ? sanitizeForLog(data.error) : "none",
    hasReply: !!data.reply,
    model: data.model ?? "unknown",
    grounding: data.grounding
      ? `personalOI:${data.grounding.personalOpenIntelligenceCount} extSearch:${data.grounding.externalSearchUsed ? data.grounding.sourceCount : 0}`
      : "none",
  });

  // Handle non-ok responses
  if (!response.ok || !data.ok || !data.reply) {
    const code = classifyWorkerError(
      response.status,
      data.errorCode,
      data.error,
    );
    devLog("error", {
      reason: "worker_error",
      errorCode: code,
      httpStatus: response.status,
      workerError: data.error ?? "none",
    });

    return {
      ok: false,
      errorCode: code,
      error: ERROR_MESSAGES[code],
      fallback: localFallback(input),
    };
  }

  const budget = SESSION_BUDGETS[input.sessionType];
  return {
    ok: true,
    reply: data.reply.trim(),
    model: data.model ?? "gpt-4o-mini",
    sessionType: input.sessionType,
    confidence: data.confidence ?? budget.baseConfidence,
    grounding: data.grounding ?? {
      personalOpenIntelligenceUsed: false,
      personalOpenIntelligenceCount: 0,
      factionIntelligenceUsed: false,
      factionIntelligenceCount: 0,
      exchangeIntelligenceUsed: false,
      exchangeIntelligenceCount: 0,
      externalSearchUsed: false,
      sourceCount: 0,
    },
    sources: data.sources ?? [],
    visualBlocks: parseVisualBlocks(data.visualBlocks),
  };
}

// ── Session type wrappers ──────────────────────────────────────────────────

/** Quick Check — fast, concise, tactical. ACTIVE. */
export function runQuickCheck(args: {
  prompt: string;
  eagohId: string | null;
  kind?: AnalystRequestKind;
  personality?: AnalystPersonality;
  conversationContext?: ConversationMessage[];
  eagohMeta?: { id: string; name: string; domain: string };
}): Promise<AnalystResponse> {
  return callAnalyst(
    {
      prompt: args.prompt,
      sessionType: "quick-check",
      eagohId: args.eagohId,
      kind: args.kind ?? "general",
      personality: args.personality ?? "tactical",
      conversationContext: args.conversationContext,
    },
    args.eagohMeta,
  );
}

/** Quick Analytics — short-form analytics tier. */
export function runQuickAnalytics(args: {
  prompt: string;
  eagohId: string | null;
  kind?: AnalystRequestKind;
  personality?: AnalystPersonality;
  conversationContext?: ConversationMessage[];
  eagohMeta?: { id: string; name: string; domain: string };
}): Promise<AnalystResponse> {
  return callAnalyst(
    {
      prompt: args.prompt,
      sessionType: "quick-analytics",
      eagohId: args.eagohId,
      kind: args.kind,
      personality: args.personality ?? "calm",
      conversationContext: args.conversationContext,
    },
    args.eagohMeta,
  );
}

/** Standard Session — balanced analysis. */
export function runStandardSession(args: {
  prompt: string;
  eagohId: string | null;
  kind?: AnalystRequestKind;
  personality?: AnalystPersonality;
  conversationContext?: ConversationMessage[];
  eagohMeta?: { id: string; name: string; domain: string };
}): Promise<AnalystResponse> {
  return callAnalyst(
    {
      prompt: args.prompt,
      sessionType: "standard",
      eagohId: args.eagohId,
      kind: args.kind,
      personality: args.personality ?? "calm",
      conversationContext: args.conversationContext,
    },
    args.eagohMeta,
  );
}

/** Deep Dive / Oracle — premium long-form reasoning. */
export function runDeepDive(args: {
  prompt: string;
  eagohId: string | null;
  kind?: AnalystRequestKind;
  personality?: AnalystPersonality;
  conversationContext?: ConversationMessage[];
  eagohMeta?: { id: string; name: string; domain: string };
}): Promise<AnalystResponse> {
  return callAnalyst(
    {
      prompt: args.prompt,
      sessionType: "oracle",
      eagohId: args.eagohId,
      kind: args.kind,
      personality: args.personality ?? "oracle",
      conversationContext: args.conversationContext,
    },
    args.eagohMeta,
  );
}

/** Premium Event Analysis — event-focused intelligence breakdown. */
export function runPremiumEvent(args: {
  prompt: string;
  eagohId: string | null;
  kind?: AnalystRequestKind;
  personality?: AnalystPersonality;
  conversationContext?: ConversationMessage[];
  eagohMeta?: { id: string; name: string; domain: string };
}): Promise<AnalystResponse> {
  return callAnalyst(
    {
      prompt: args.prompt,
      sessionType: "premium-event",
      eagohId: args.eagohId,
      kind: args.kind ?? "general",
      personality: args.personality ?? "calm",
      conversationContext: args.conversationContext,
    },
    args.eagohMeta,
  );
}

export type { AnalystCallInput as AnalystInput };
