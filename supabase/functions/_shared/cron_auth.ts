// deno-lint-ignore-file no-explicit-any

import { jsonResponse } from "./cors.ts";

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function isCronAuthorized(req: Request): boolean {
  const internalKey = Deno.env.get("X_INTERNAL_CRON_KEY")?.trim() ?? "";
  const suppliedInternalKey = (
    req.headers.get("x-internal-key") ??
    req.headers.get("x-linkr-cron-secret") ??
    ""
  ).trim();
  if (
    internalKey &&
    suppliedInternalKey &&
    timingSafeEqual(suppliedInternalKey, internalKey)
  ) {
    return true;
  }

  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  const suppliedBearer = bearerToken(req.headers.get("authorization"));
  return Boolean(
    serviceRole && suppliedBearer && timingSafeEqual(suppliedBearer, serviceRole)
  );
}

export function unauthorizedCronResponse() {
  return jsonResponse({ error: "unauthorized" }, { status: 401 });
}

function bearerToken(value: string | null): string {
  const match = /^Bearer\s+(.+)$/i.exec(value?.trim() ?? "");
  return match?.[1]?.trim() ?? "";
}
