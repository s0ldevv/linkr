// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import {
  AgentApiError,
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "chat:write");

    if (req.method === "GET") {
      const url = new URL(req.url);
      const includeArchived = url.searchParams.get("archived") === "true";
      let query = admin
        .from("linkr_terminal_conversations")
        .select("*")
        .eq("user_id", ctx.userId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (!includeArchived) query = query.eq("status", "active");
      const { data, error } = await query;
      if (error) throw error;
      await recordAgentRequest(admin, ctx, req, 200);
      return agentJsonResponse({ conversations: data ?? [] });
    }

    if (req.method === "POST") {
      const title = safeTitle(ctx.body?.title) ?? "New conversation";
      const { data, error } = await admin
        .from("linkr_terminal_conversations")
        .insert({ user_id: ctx.userId, title, status: "active", source: "cli" })
        .select("*")
        .single();
      if (error) throw error;
      await recordAgentRequest(admin, ctx, req, 201);
      return agentJsonResponse({ conversation: data }, { status: 201 });
    }

    if (req.method === "PATCH") {
      const conversationId = String(ctx.body?.conversation_id ?? "").trim();
      if (!conversationId) throw new AgentApiError("missing_conversation_id", 400);
      const action = String(ctx.body?.action ?? "").trim();
      const patch: Record<string, unknown> = {};
      if (action === "rename") patch.title = safeTitle(ctx.body?.title) ?? "Conversation";
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
        throw new AgentApiError("invalid_action", 400);
      }
      const { data, error } = await admin
        .from("linkr_terminal_conversations")
        .update(patch)
        .eq("id", conversationId)
        .eq("user_id", ctx.userId)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new AgentApiError("conversation_not_found", 404);
      await recordAgentRequest(admin, ctx, req, 200);
      return agentJsonResponse({ conversation: data });
    }

    await recordAgentRequest(admin, ctx, req, 405);
    return agentErrorResponse(methodNotAllowed());
  } catch (error) {
    await recordAgentRequest(admin, ctx ?? {}, req, (error as any)?.status ?? 500, error).catch(
      () => {},
    );
    return agentErrorResponse(error);
  }
});

function safeTitle(value: unknown): string | null {
  const text = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  return text ? text.slice(0, 80) : null;
}
