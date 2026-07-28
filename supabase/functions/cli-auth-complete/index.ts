// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import { readJsonBody, consumeRateLimit } from "../_shared/http.ts";
import {
  AgentApiError,
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { ensureProvisionedAuthUser } from "../_shared/provisioning.ts";
import { createApiKeyForAgent } from "../_shared/agent_onboarding.ts";
import {
  cleanCliText,
  hashedRequestValue,
  noStoreHeaders,
  normalizeCliOpaqueCode,
  normalizeCliScopes,
  normalizeCliUserCode,
  requestIp,
  sha256Hex,
} from "../_shared/cli_auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());

  const admin = serviceClient();
  try {
    const ipHash = await hashedRequestValue(requestIp(req));
    const ipLimit = await consumeRateLimit(admin, {
      subjectType: "cli_auth_complete_ip",
      subjectId: ipHash,
      windowSeconds: 60,
      limit: 20,
    });
    if (!ipLimit.allowed) {
      throw new AgentApiError("rate_limit_exceeded", 429, "Too many login completion attempts.");
    }

    const body = await readJsonBody(req, 32 * 1024) as any;
    const deviceCode = normalizeCliOpaqueCode(body?.device_code);
    const userCode = normalizeCliUserCode(body?.user_code ?? body?.code);
    if (!deviceCode || !userCode) {
      throw new AgentApiError("invalid_cli_login_code", 400, "Invalid CLI login code.");
    }

    const deviceCodeHash = await sha256Hex(deviceCode);
    const deviceLimit = await consumeRateLimit(admin, {
      subjectType: "cli_auth_complete_device",
      subjectId: deviceCodeHash,
      windowSeconds: 60,
      limit: 8,
    });
    if (!deviceLimit.allowed) {
      throw new AgentApiError("rate_limit_exceeded", 429, "Too many attempts for this login.");
    }

    const consumed = await admin.rpc("consume_cli_auth_session", {
      p_device_code_hash: deviceCodeHash,
      p_user_code_hash: await sha256Hex(userCode),
    });
    if (consumed.error) throw consumed.error;
    const result = normalizeRpcResult(consumed.data);
    if (result.status !== "ok") {
      throw statusError(result.status);
    }

    const userId = String(result.approved_user_id ?? "");
    if (!userId) throw new AgentApiError("cli_auth_missing_user", 500);
    const scopes = normalizeCliScopes(result.requested_scopes);
    const limits = result.requested_limits && typeof result.requested_limits === "object"
      ? result.requested_limits as Record<string, number | null>
      : {};
    const clientName = cleanCliText(result.client_name, "Device");

    await ensureProvisionedAuthUser(admin, userId, "auth_session");
    const wallet = await findPrimaryWallet(admin, userId);
    const agentProfile = await ensureCliAgentProfile(admin, {
      userId,
      walletId: wallet.id,
      clientName,
    });
    const key = await createApiKeyForAgent(admin, {
      userId,
      agentProfileId: agentProfile.id,
      walletId: wallet.id,
      name: keyName(clientName),
      scopes,
      limits,
      metadata: {
        source: "cli_browser_auth",
        cli_auth_session_id: result.session_id ?? null,
        cli_version: result.cli_version ?? null,
      },
    });

    console.log(JSON.stringify({
      event: "cli_auth_complete",
      user_id: userId,
      agent_profile_id: agentProfile.id,
      api_key_id: key.row.id,
      session_id: result.session_id ?? null,
    }));

    return agentJsonResponse(
      {
        api_key: key.plaintext,
        key: {
          id: key.row.id,
          prefix: key.row.key_prefix,
          name: key.row.name,
          scopes: key.row.scopes,
          status: key.row.status,
          expires_at: key.row.expires_at,
          limits: {
            max_buy_eth: key.row.max_buy_eth,
            max_buy_sol: key.row.max_buy_sol,
            max_sell_percent: key.row.max_sell_percent,
            max_transfer_eth: key.row.max_transfer_eth,
            max_transfer_sol: key.row.max_transfer_sol,
            max_launch_initial_buy_eth: key.row.max_launch_initial_buy_eth,
            max_launch_initial_buy_sol: key.row.max_launch_initial_buy_sol,
            max_liquidity_eth: key.row.max_liquidity_eth,
            daily_request_limit: key.row.daily_request_limit,
            daily_tx_limit: key.row.daily_tx_limit,
          },
        },
        agent_profile: {
          id: agentProfile.id,
          name: agentProfile.name,
          status: agentProfile.status,
        },
      },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    return agentErrorResponse(error);
  }
});

function normalizeRpcResult(value: unknown): Record<string, any> {
  if (value && typeof value === "object") return value as Record<string, any>;
  return { status: "invalid_response" };
}

function statusError(status: unknown): AgentApiError {
  const code = String(status ?? "invalid_cli_login");
  if (code === "pending") {
    return new AgentApiError("cli_login_not_approved", 409, "Finish browser authorization first.");
  }
  if (code === "expired") {
    return new AgentApiError("cli_login_expired", 410, "This CLI login expired.");
  }
  if (code === "invalid_code") {
    return new AgentApiError("invalid_cli_user_code", 403, "The authorization code is incorrect.");
  }
  if (code === "denied") {
    return new AgentApiError("cli_login_denied", 403, "This CLI login was denied.");
  }
  if (code === "consumed") {
    return new AgentApiError("cli_login_already_used", 409, "This CLI login was already used.");
  }
  return new AgentApiError("invalid_cli_login", 403, "This CLI login could not be completed.");
}

async function findPrimaryWallet(admin: any, userId: string) {
  const { data, error } = await admin
    .from("wallets")
    .select("id,user_id,public_key,address,chain_id,wallet_type,explorer_url,is_primary")
    .eq("user_id", userId)
    .eq("wallet_type", "evm")
    .eq("chain_id", 4663)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AgentApiError("wallet_not_found", 500, "CLI wallet was not provisioned.");
  return data;
}

async function ensureCliAgentProfile(
  admin: any,
  args: { userId: string; walletId: string; clientName: string },
) {
  const existing = await admin
    .from("agent_profiles")
    .select("*")
    .eq("user_id", args.userId)
    .eq("agent_type", "developer_app")
    .eq("status", "active")
    .contains("metadata", { source: "cli" })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const inserted = await admin
    .from("agent_profiles")
    .insert({
      user_id: args.userId,
      wallet_id: args.walletId,
      name: "Linkr CLI",
      agent_type: "developer_app",
      public_contact: null,
      terms_accepted_at: new Date().toISOString(),
      metadata: {
        source: "cli",
        created_by: "cli_browser_auth",
        first_client_name: args.clientName,
      },
    })
    .select("*")
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

function keyName(clientName: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `CLI - ${cleanCliText(clientName, "Device")} - ${day}`.slice(0, 80);
}
