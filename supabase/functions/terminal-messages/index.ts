// deno-lint-ignore-file no-explicit-any

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import { safeErrorResponse } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  const userId = await getCallerUserId(req);
  if (!userId) return jsonResponse({ error: "unauthorized" }, { status: 401 });
  const admin = serviceClient();

  try {
    const url = new URL(req.url);
    const conversationId = String(url.searchParams.get("conversation_id") ?? "").trim();
    if (!conversationId) return jsonResponse({ error: "missing_conversation_id" }, { status: 400 });
    const limit = clampLimit(url.searchParams.get("limit"), 80);
    const before = url.searchParams.get("before");

    const own = await admin
      .from("linkr_terminal_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (own.error) throw own.error;
    if (!own.data) return jsonResponse({ error: "conversation_not_found" }, { status: 404 });

    let query = admin
      .from("linkr_terminal_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (before) query = query.lt("created_at", before);
    const { data, error } = await query;
    if (error) throw error;

    return jsonResponse({ messages: [...(data ?? [])].reverse() });
  } catch (error) {
    return safeErrorResponse(error, { functionName: "terminal-messages" });
  }
});

function clampLimit(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value ?? fallback));
  return Number.isFinite(n) && n > 0 ? Math.min(120, n) : fallback;
}
