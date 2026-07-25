/**
 * Empty mock for server-side-only packages that should never be bundled
 * into the React Native client (e.g., @vercel/oidc, @ai-sdk/gateway, ai).
 *
 * These packages are dependencies of @rork-ai/toolkit-sdk and contain
 * Node.js / Vercel-specific code (OIDC token flows, AI SDK gateways)
 * that are irrelevant to the mobile client. Metro encounters them during
 * dependency traversal and attempts to bundle them. Providing empty stubs
 * stops traversal and prevents build failures.
 */
module.exports = {};
