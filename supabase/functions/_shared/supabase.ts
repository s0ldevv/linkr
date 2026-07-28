// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export interface CallerAuthContext {
  userId: string;
  token: string;
  sessionId: string | null;
  authenticatedAt: Date | null;
}

export async function getCallerAuthContext(
  req: Request,
): Promise<CallerAuthContext | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  // Use the service-role client to verify the caller's JWT. The publishable/anon
  // key path fails with "unrecognized JWT kid <nil> for algorithm ES256" when the
  // project has been migrated to asymmetric (ES256) JWT signing keys but the
  // configured anon/publishable key is stale or from a different key generation.
  // The service-role client validates the bearer token against GoTrue regardless
  // of signing algorithm, so bootstrap and other auth checks keep working.
  const client = serviceClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  const claims = jwtClaims(token);
  return {
    userId: data.user.id,
    token,
    sessionId: cleanClaim(claims?.session_id),
    authenticatedAt: authenticationTimeFromClaims(claims),
  };
}

export async function getCallerUserId(req: Request): Promise<string | null> {
  return (await getCallerAuthContext(req))?.userId ?? null;
}

function authenticationTimeFromClaims(payload: any | null): Date | null {
  try {
    if (!payload) return null;
    const candidates: number[] = [];
    const authTime = Number(payload?.auth_time);
    if (Number.isFinite(authTime) && authTime > 0) candidates.push(authTime);
    if (Array.isArray(payload?.amr)) {
      for (const method of payload.amr) {
        const timestamp = Number(method?.timestamp);
        if (Number.isFinite(timestamp) && timestamp > 0) {
          candidates.push(timestamp);
        }
      }
    }
    if (!candidates.length) return null;
    return new Date(Math.max(...candidates) * 1000);
  } catch (_) {
    return null;
  }
}

function jwtClaims(token: string): any | null {
  try {
    return JSON.parse(decodeBase64Url(token.split(".")[1] ?? ""));
  } catch (_) {
    return null;
  }
}

function cleanClaim(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text && text.length <= 256 ? text : null;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return new TextDecoder().decode(
    Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
  );
}
