/**
 * Shared authentication error formatter.
 *
 * Converts raw Supabase / network errors into short, user-facing messages.
 * Never exposes raw response bodies, headers, URLs, tokens, or internal
 * Supabase metadata to the user.
 *
 * Also provides safe diagnostic logging that excludes secrets.
 */

/** Safe diagnostic fields only — no passwords, tokens, or headers. */
export interface SafeAuthLogInfo {
  operation: "signup" | "signin" | "signout" | "reset" | "updatePassword";
  httpStatus?: number;
  supabaseCode?: string;
  safeMessage: string;
  timestamp: string;
}

/**
 * Extract a numeric HTTP status from an error-like object.
 * Supabase Auth errors carry `status` on the error object.
 */
function extractHttpStatus(err: unknown): number | undefined {
  if (err == null) return undefined;
  if (typeof err === "object") {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/**
 * Extract the Supabase error code (e.g. "user_already_exists",
 * "weak_password", "over_request_rate_limit").
 */
function extractSupabaseCode(err: unknown): string | undefined {
  if (err == null) return undefined;
  if (typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return undefined;
}

/**
 * Get a lowercase string representation of an error for pattern matching.
 */
function errorText(err: unknown): string {
  if (err == null) return "";
  if (err instanceof Error) return err.message.toLowerCase();
  if (typeof err === "string") return err.toLowerCase();
  if (typeof err === "object") {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string") return msg.toLowerCase();
  }
  return String(err).toLowerCase();
}

/**
 * Format an auth error into a user-facing message.
 *
 * Handles:
 *  - HTTP 500–599 (including 522 Cloudflare gateway errors)
 *  - Network / fetch failures
 *  - Duplicate email
 *  - Weak / invalid password
 *  - Rate limiting
 *  - Email not confirmed
 *  - Invalid credentials
 *  - Fallback generic message
 */
export function formatAuthError(err: unknown): string {
  const text = errorText(err);
  const status = extractHttpStatus(err);
  const code = extractSupabaseCode(err);

  // HTTP 5xx — server-side issue (includes 522 Cloudflare/origin down)
  if (status !== undefined && status >= 500 && status <= 599) {
    return "Account creation is temporarily unavailable. Please wait a moment and try again.";
  }

  // Network / connection errors
  if (
    text.includes("network") ||
    text.includes("fetch") ||
    text.includes("failed to fetch") ||
    text.includes("network request failed") ||
    text.includes("tunneling socket") ||
    text.includes("err_internet_disconnected") ||
    text.includes("connection refused") ||
    text.includes("timeout") ||
    status === 0
  ) {
    return "Unable to connect. Please check your internet connection and try again.";
  }

  // Rate limiting
  if (
    code === "over_request_rate_limit" ||
    code === "rate_limit_exceeded" ||
    text.includes("rate limit") ||
    text.includes("too many") ||
    text.includes("over_request")
  ) {
    return "Too many attempts. Please wait before trying again.";
  }

  // Duplicate email
  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    text.includes("already registered") ||
    text.includes("already exists") ||
    text.includes("already been registered") ||
    text.includes("duplicate")
  ) {
    return "An account already exists for this email.";
  }

  // Weak / invalid password
  if (
    code === "weak_password" ||
    code === "invalid_password" ||
    text.includes("password") &&
      (text.includes("weak") || text.includes("at least") || text.includes("characters") || text.includes("too short"))
  ) {
    return "Password must be at least 6 characters and include a mix of letters and numbers.";
  }
  if (text.includes("password") && text.includes("6")) {
    return "Password must be at least 6 characters.";
  }

  // Email not confirmed
  if (
    code === "email_not_confirmed" ||
    text.includes("email not confirmed") ||
    text.includes("not confirmed")
  ) {
    return "Please confirm your email before signing in.";
  }

  // Invalid credentials (sign-in)
  if (
    code === "invalid_credentials" ||
    text.includes("invalid login") ||
    text.includes("invalid credentials")
  ) {
    return "Invalid email or password.";
  }

  // Fallback — never expose the raw error
  return "Something went wrong. Please try again.";
}

/**
 * Build a safe diagnostic log object from an auth error.
 *
 * Excludes: password, access token, refresh token, anon key,
 * full response headers, cookies, request URLs.
 */
export function safeAuthLog(
  operation: SafeAuthLogInfo["operation"],
  err: unknown,
): SafeAuthLogInfo {
  return {
    operation,
    httpStatus: extractHttpStatus(err),
    supabaseCode: extractSupabaseCode(err),
    safeMessage: errorText(err) || "unknown",
    timestamp: new Date().toISOString(),
  };
}
