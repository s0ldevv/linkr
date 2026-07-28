// deno-lint-ignore-file no-explicit-any

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import { readJsonBody, safeErrorResponse } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const userId = await getCallerUserId(req);
  if (!userId) return jsonResponse({ error: "unauthorized" }, { status: 401 });
  const admin = serviceClient();

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const includeArchived = url.searchParams.get("archived") === "true";
      let query = admin
        .from("linkr_terminal_conversations")
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (!includeArchived) query = query.eq("status", "active");
      const { data, error } = await query;
      if (error) throw error;
      return jsonResponse({ conversations: data ?? [] });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req, 64 * 1024) as any;
      const title = safeTitle(body?.title) ?? "New conversation";
      const { data, error } = await admin
        .from("linkr_terminal_conversations")
        .insert({ user_id: userId, title, status: "active", source: "terminal" })
        .select("*")
        .single();
      if (error) throw error;
      return jsonResponse({ conversation: data });
    }

    if (req.method === "PATCH") {
      const body = await readJsonBody(req, 64 * 1024) as any;
      const conversationId = String(body?.conversation_id ?? "").trim();
      if (!conversationId)
        return jsonResponse({ error: "missing_conversation_id" }, { status: 400 });
      const action = String(body?.action ?? "").trim();
      const patch: Record<string, unknown> = {};
      if (action === "rename") patch.title = safeTitle(body?.title) ?? "Conversation";
      else if (action === "archive") {
        patch.status = "archived";
        patch.archived_at = new Date().toISOString();
      } else if (action === "restore") {
        patch.status = "active";
        patch.archived_at = null;
      } else if (action === "delete") {
        patch.status = "deleted";
        patch.deleted_at = new Date().toISOString();
      } else {
        return jsonResponse({ error: "invalid_action" }, { status: 400 });
      }
      const { data, error } = await admin
        .from("linkr_terminal_conversations")
        .update(patch)
        .eq("id", conversationId)
        .eq("user_id", userId)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse({ error: "conversation_not_found" }, { status: 404 });
      return jsonResponse({ conversation: data });
    }

    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  } catch (error) {
    return safeErrorResponse(error, { functionName: "terminal-conversations" });
  }
});

function safeTitle(value: unknown): string | null {
  const text = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  return text ? text.slice(0, 80) : null;
}
