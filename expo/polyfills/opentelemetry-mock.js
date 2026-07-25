/**
 * No-op mock for @opentelemetry/api.
 *
 * @supabase/supabase-js dynamically imports this module for trace propagation.
 * Hermes (React Native's JS engine) cannot compile dynamic import() expressions,
 * so we provide this stub that returns null/no-op values.
 *
 * All functions return either null or a no-op, which causes supabase-js to
 * skip trace propagation gracefully. This is production-safe — OpenTelemetry
 * tracing has no effect on React Native functionality.
 */

const noop = () => {};

export const context = {
  active: () => null,
};

export const propagation = {
  inject: noop,
  extract: noop,
};

export const trace = {
  getTracer: () => ({
    startSpan: () => ({
      end: noop,
      setAttribute: noop,
      setStatus: noop,
    }),
  }),
};

export default { context, propagation, trace };
