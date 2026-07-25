/**
 * Domain Guard — reusable middleware for all AI session entry points.
 *
 * Every AI request must pass through this validation BEFORE Edge is spent.
 * If the prompt's detected domain does not match the EAGOH's forged domain,
 * the request is rejected with a polite message and zero Edge cost.
 *
 * Uses keyword-based detection — fast, local, no API call needed.
 *
 * Domain guard rules:
 *   - Validate against selectedEagoh.domain (the raw domain ID field).
 *   - Normalise domain IDs before every comparison.
 *   - Score ALL domains against the prompt; only reject when a DIFFERENT
 *     domain has stronger keyword matches.
 *   - Fail OPEN when no domain keywords are detected.
 *   - Edge is NEVER deducted on rejection.
 */

import {
  getDomain,
  getDomainRejection,
  getDetectedDomainForPrompt,
  isPromptInDomain,
  normalizeDomainId,
  type IntelligenceDomain,
} from "./domains";

/** Result of a domain-guard check. */
export type DomainGuardResult =
  | { ok: true; domain: IntelligenceDomain; domainId: string }
  | { ok: false; error: string; rejectionMessage: string };

/**
 * Development-only debug log for domain guard decisions.
 * Logs EAGOH id, name, domain, normalised domain, detected topic domain,
 * and the allow/reject decision. Never logs user email or private data.
 */
function logDomainGuardDecision(params: {
  eagohId: string;
  eagohName: string;
  eagohDomain: string;
  normalizedDomain: string;
  prompt: string;
  detectedTopicDomain: string | null;
  allowed: boolean;
}): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  const {
    eagohId,
    eagohName,
    eagohDomain,
    normalizedDomain,
    prompt: _prompt,
    detectedTopicDomain,
    allowed,
  } = params;
  const decision = allowed ? "ALLOW" : "REJECT";
  console.log(
    `[domainGuard] ${decision} | EAGOH: ${eagohName} (${eagohId}) | domain: ${eagohDomain} → normalized: ${normalizedDomain} | detected: ${detectedTopicDomain ?? "none"}`,
  );
}

/**
 * Validate that a user prompt matches the given EAGOH's domain.
 *
 * Call this BEFORE spending any Edge or calling any AI service. If the
 * result is `ok: false`, display the `rejectionMessage` and abort.
 *
 * @param eagohDomainId — the EAGOH's `domain` field (e.g. "sports")
 * @param eagohId — optional EAGOH id for debug logging
 * @param eagohName — optional EAGOH name for debug logging
 * @param prompt — the user's input text to validate
 * @param requireMatch — if true, reject when no match; if false, allow
 *   (useful for admin/testing, defaults to true)
 */
export function guardDomainRequest(
  eagohDomainId: string | undefined | null,
  prompt: string,
  requireMatch: boolean = true,
  eagohMeta?: { id: string; name: string },
): DomainGuardResult {
  if (!eagohDomainId) {
    return {
      ok: false,
      error: "no_domain",
      rejectionMessage:
        "This EAGOH has no intelligence domain assigned. Forge an EAGOH with a domain first.",
    };
  }

  const normalizedId = normalizeDomainId(eagohDomainId);
  const domain = getDomain(normalizedId);
  if (!domain) {
    return {
      ok: false,
      error: "unknown_domain",
      rejectionMessage: "This EAGOH's domain is not recognized.",
    };
  }

  if (!requireMatch) {
    if (eagohMeta) {
      logDomainGuardDecision({
        eagohId: eagohMeta.id,
        eagohName: eagohMeta.name,
        eagohDomain: eagohDomainId,
        normalizedDomain: normalizedId,
        prompt,
        detectedTopicDomain: null,
        allowed: true,
      });
    }
    return { ok: true, domain, domainId: normalizedId };
  }

  const isMatch = isPromptInDomain(prompt, eagohDomainId);

  if (!isMatch) {
    const detectedDomainId = getDetectedDomainForPrompt(prompt);
    const rejectionMessage = getDomainRejection(eagohDomainId, detectedDomainId);

    if (eagohMeta) {
      logDomainGuardDecision({
        eagohId: eagohMeta.id,
        eagohName: eagohMeta.name,
        eagohDomain: eagohDomainId,
        normalizedDomain: normalizedId,
        prompt,
        detectedTopicDomain: detectedDomainId,
        allowed: false,
      });
    }

    return {
      ok: false,
      error: "domain_mismatch",
      rejectionMessage,
    };
  }

  if (eagohMeta) {
    logDomainGuardDecision({
      eagohId: eagohMeta.id,
      eagohName: eagohMeta.name,
      eagohDomain: eagohDomainId,
      normalizedDomain: normalizedId,
      prompt,
      detectedTopicDomain: getDetectedDomainForPrompt(prompt),
      allowed: true,
    });
  }

  return { ok: true, domain, domainId: normalizedId };
}

/**
 * Quick convenience check — returns true if a prompt is safe (in domain)
 * for the given EAGOH. Equivalent to calling guardDomainRequest and
 * checking `ok`.
 */
export function canAnswerInDomain(
  eagohDomainId: string | undefined | null,
  prompt: string,
): boolean {
  return guardDomainRequest(eagohDomainId, prompt).ok;
}

/**
 * Name all the session types that must pass through the domain guard.
 * These are the entry points protected against out-of-domain requests.
 */
export const PROTECTED_SESSION_TYPES = [
  "quick-check",
  "quick-analytics",
  "standard",
  "oracle",
  "premium-event",
] as const;
export type ProtectedSessionType = (typeof PROTECTED_SESSION_TYPES)[number];
