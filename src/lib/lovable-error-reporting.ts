type LovableErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type LovableEvents = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: LovableErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    __lovableEvents?: LovableEvents;
  }
}

export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  if (isSensitiveErrorSurface(window.location.pathname)) return;
  const safeContext = redactSensitiveValue(context) as Record<string, unknown>;
  window.__lovableEvents?.captureException?.(
    redactSensitiveValue(error),
    {
      source: "react_error_boundary",
      route: window.location.pathname,
      ...safeContext,
    },
    {
      mechanism: "react_error_boundary",
      handled: false,
      severity: "error",
    },
  );
}

const SENSITIVE_ROUTES = ["/app/wallet", "/auth/callback"];
const SENSITIVE_FIELD = /private.?key|secret|token|authorization|ciphertext|challenge/i;

export function isSensitiveErrorSurface(pathname: string): boolean {
  const normalized = String(pathname ?? "").replace(/\/+$/, "") || "/";
  return SENSITIVE_ROUTES.some(
    (route) => normalized === route || normalized.startsWith(`${route}/`),
  );
}

export function redactSensitiveValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: "redacted_error", stack: undefined };
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_FIELD.test(key) ? "[REDACTED]" : redactSensitiveValue(item, seen),
    ]),
  );
}
