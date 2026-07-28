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
  if (req.method !== "GET") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "chat:write");
    const url = new URL(req.url);
    const conversationId = String(url.searchParams.get("conversation_id") ?? "").trim();
    if (!conversationId) {
      throw new AgentApiError("missing_conversation_id", 400, "Missing conversation_id.");
    }
    const limit = clampLimit(url.searchParams.get("limit"), 80);
    const before = url.searchParams.get("before");

    const own = await admin
      .from("linkr_terminal_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (own.error) throw own.error;
    if (!own.data) throw new AgentApiError("conversation_not_found", 404);

    let query = admin
      .from("linkr_terminal_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (before) query = query.lt("created_at", before);
    const { data, error } = await query;
    if (error) throw error;

    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse({ messages: [...(data ?? [])].reverse() });
  } catch (error) {
    await recordAgentRequest(admin, ctx ?? {}, req, (error as any)?.status ?? 500, error).catch(
      () => {},
    );
    return agentErrorResponse(error);
  }
});

function clampLimit(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value ?? fallback));
  return Number.isFinite(n) && n > 0 ? Math.min(120, n) : fallback;
}
