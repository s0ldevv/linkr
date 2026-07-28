export const DEFAULT_AUTH_DESTINATION = "/app";

export function sanitizeAuthReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_AUTH_DESTINATION;

  try {
    const origin = typeof window === "undefined" ? "https://linkr.invalid" : window.location.origin;
    const target = new URL(value, origin);
    if (target.origin !== origin) return DEFAULT_AUTH_DESTINATION;

    const pathname = target.pathname.replace(/\/+$/, "") || "/";
    if (pathname === "/" || pathname === "/auth" || pathname.startsWith("/auth/")) {
      return DEFAULT_AUTH_DESTINATION;
    }

    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return DEFAULT_AUTH_DESTINATION;
  }
}

export function authSearchFor(returnTo: string): { returnTo?: string } {
  const destination = sanitizeAuthReturnTo(returnTo);
  return destination === DEFAULT_AUTH_DESTINATION ? {} : { returnTo: destination };
}
