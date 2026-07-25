const { getDefaultConfig } = require("expo/metro-config");
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);

// ── OpenTelemetry stub ────────────────────────────────────────────────────
// @supabase/supabase-js dynamically imports `@opentelemetry/api` for trace
// propagation. The ESM build emits `import(OTEL_PKG)` (a variable, not a
// string literal), which Hermes cannot compile — producing
// "Invalid expression encountered" during the release JS bundle build.
// We map the module to a local no-op stub so the import resolves to harmless
// empty functions and the dynamic import is never emitted.
config.resolver = config.resolver || {};
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "@opentelemetry/api": path.resolve(__dirname, "polyfills/opentelemetry-mock.js"),
};

module.exports = withRorkMetro(config);
