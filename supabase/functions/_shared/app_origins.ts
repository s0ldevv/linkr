// linkr.cash is reachable on both the apex host and the www host, and the apex
// redirects to www. Browsers therefore issue app requests from
// https://www.linkr.cash, so every origin/host allowlist has to treat the two
// spellings as one trusted deployment. Allowing only the apex silently breaks
// CORS preflights and OAuth redirect round-trips for real traffic.
export const LINKR_APEX_ORIGIN = "https://linkr.cash";
export const LINKR_WWW_ORIGIN = "https://www.linkr.cash";
export const LINKR_PUBLIC_ORIGINS: readonly string[] = [
  LINKR_APEX_ORIGIN,
  LINKR_WWW_ORIGIN,
];

const LINKR_PUBLIC_HOSTS = new Set(["linkr.cash", "www.linkr.cash"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function isLinkrPublicOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" &&
      LINKR_PUBLIC_HOSTS.has(url.hostname.toLowerCase());
  } catch (_) {
    return false;
  }
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) &&
      LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  } catch (_) {
    return false;
  }
}

/**
 * Every host spelling a linkr.cash URL can legitimately arrive as. A URL issued
 * for one host can come back on the other after an apex/www redirect, so
 * exact-match lookups (one-time codes bound to a redirect target) must accept
 * the whole set instead of a single string.
 */
export function linkrUrlHostVariants(rawUrl: string): string[] {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    return [rawUrl];
  }
  if (!LINKR_PUBLIC_HOSTS.has(url.hostname.toLowerCase())) return [url.toString()];

  const variants = new Set<string>();
  for (const host of LINKR_PUBLIC_HOSTS) {
    const variant = new URL(url.toString());
    variant.hostname = host;
    variants.add(variant.toString());
  }
  return [...variants];
}
