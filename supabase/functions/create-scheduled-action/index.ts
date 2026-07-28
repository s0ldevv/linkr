// deno-lint-ignore-file no-explicit-any
import { ethers } from "https://esm.sh/ethers@6";
import { PublicKey } from "https://esm.sh/@solana/web3.js@1.98.2?target=deno";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { internalErrorResponse, readJsonBody } from "../_shared/http.ts";
import {
  AgentApiError,
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import {
  recordAgentRequest,
  requireAgentApiKey,
} from "../_shared/agent_api_auth.ts";
import { normalizeAmount, normalizeSolAmount } from "../_shared/amounts.ts";
import { estimateEthTransferBalancePreflight } from "../_shared/eth_transfer.ts";
import {
  getErc20TokenBalances,
  getEthBalance,
  normalizeEvmAddress,
  ROBINHOOD_CHAIN_ID,
} from "../_shared/robinhood_chain.ts";
import {
  normalizeIntervalSeconds,
  normalizeScheduleKind,
  type ScheduledActionType,
  type ScheduleKind,
  SCHEDULER_MARKET_CHECK_INTERVAL_SECONDS,
  SCHEDULER_MAX_DELAY_SECONDS,
  SCHEDULER_MIN_DELAY_SECONDS,
  type SchedulerTrigger,
} from "../_shared/scheduler.ts";
import {
  LAMPORTS_PER_SOL,
  normalizeSolanaPublicKey,
  solanaConnection,
} from "../_shared/solana_chain.ts";
import { estimateSolTransferBalancePreflight } from "../_shared/solana_transfer.ts";
import { getSolanaTokenBalanceRaw } from "../_shared/solana_swap/execute.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import {
  insufficientNativeBalanceReply,
  nativeAmountWithReserve,
  nativeBalanceIsTooLow,
  readNativeBalanceReserve,
} from "../_shared/wallet_balance_reply.ts";

type Chain = "robinhood" | "solana";
type TriggerType = "time" | "market_cap";

type WalletRef = {
  id: string;
  address: string;
  public_key: string;
};

type ScheduleRequestContext = {
  agentCtx?: any;
  body: any;
  request: Request;
  sourceSurface: "dashboard" | "agent_api";
  userId: string;
};

function requiredEthForBuy(amountEth: unknown): number {
  return nativeAmountWithReserve(
    amountEth,
    readNativeBalanceReserve("ROBINHOOD_SWAP_BALANCE_RESERVE_ETH", 0.00001),
  );
}

function requiredSolForBuy(amountSol: unknown): number {
  return nativeAmountWithReserve(
    amountSol,
    readNativeBalanceReserve("SOLANA_SWAP_BALANCE_RESERVE_SOL", 0.002),
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const admin = serviceClient();

  if (isAgentApiRequest(req)) {
    let ctx: any = null;
    try {
      if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
        return agentErrorResponse(methodNotAllowed());
      }
      const scope = req.method === "GET" ? "schedule:read" : "schedule:write";
      ctx = await requireAgentApiKey(req, admin, scope, {
        requireIdempotency: req.method !== "GET",
      });
      const result = await handleScheduleRequest(admin, {
        agentCtx: ctx,
        body: ctx.body,
        request: req,
        sourceSurface: "agent_api",
        userId: ctx.userId,
      });
      await recordAgentRequest(admin, ctx, req, 200).catch(() => {});
      return agentJsonResponse(result);
    } catch (error) {
      const responseError = mapAgentScheduleError(error);
      await recordAgentRequest(
        admin,
        ctx ?? {},
        req,
        (responseError as any)?.status ?? 500,
        responseError,
      ).catch(() => {});
      return agentErrorResponse(responseError);
    }
  }

  try {
    if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
      return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
    }
    const userId = await getCallerUserId(req);
    if (!userId) {
      return jsonResponse({ error: "unauthorized" }, { status: 401 });
    }
    const body = req.method === "GET" ? {} : await parseJson(req);
    const result = await handleScheduleRequest(admin, {
      body,
      request: req,
      sourceSurface: "dashboard",
      userId,
    });
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof AgentApiError
      ? error.status
      : statusForError(message);
    if (status >= 500) {
      return internalErrorResponse(error, {
        function: "create-scheduled-action",
      });
    }
    return jsonResponse({
      error: error instanceof AgentApiError ? error.code : message,
      message: error instanceof AgentApiError
        ? error.message
        : userMessageForError(message),
    }, { status });
  }
});

async function handleScheduleRequest(
  admin: any,
  ctx: ScheduleRequestContext,
): Promise<any> {
  if (ctx.request.method === "GET") {
    return await listScheduledActions(admin, ctx);
  }
  if (ctx.request.method === "POST") {
    return await createScheduledAction(admin, ctx);
  }
  if (ctx.request.method === "PATCH") {
    return await mutateScheduledAction(admin, ctx);
  }
  if (ctx.request.method === "DELETE") {
    return await mutateScheduledAction(admin, ctx, "cancel");
  }
  throw new AgentApiError("method_not_allowed", 405);
}

async function parseJson(req: Request): Promise<any> {
  try {
    return await readJsonBody(req, 64 * 1024);
  } catch (_) {
    throw new Error("invalid_json");
  }
}

async function listScheduledActions(admin: any, ctx: ScheduleRequestContext) {
  const url = new URL(ctx.request.url);
  const scheduleId = scheduleIdFrom(url, ctx.body, false);
  if (scheduleId) {
    const { data, error } = await admin
      .from("scheduled_actions")
      .select("*")
      .eq("id", scheduleId)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new AgentApiError("schedule_not_found", 404, "Schedule not found.");
    }
    return { scheduled_action: data };
  }

  const limit = Math.max(
    1,
    Math.min(Math.floor(Number(url.searchParams.get("limit") ?? 50)), 100),
  );
  let query = admin
    .from("scheduled_actions")
    .select("*")
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const status = String(url.searchParams.get("status") ?? "").trim();
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return { scheduled_actions: data ?? [] };
}

async function createScheduledAction(admin: any, ctx: ScheduleRequestContext) {
  const body = ctx.body;
  const profile = await loadProfile(admin, ctx.userId);
  const actionType = normalizeActionType(
    body?.action_type ?? body?.side ?? body?.action,
  );
  const chain = normalizeChain(body?.chain ?? body?.network);
  const tokenAddress = normalizeScheduleTokenAddress(chain, actionType, body);
  const slippageBps = defaultSlippageBps(profile, actionType);

  const wallet = await loadScheduleWallet(
    admin,
    ctx.userId,
    chain,
    ctx.agentCtx,
  );
  if (!wallet) {
    throw new AgentApiError(
      chain === "solana" ? "no_solana_wallet" : "no_evm_wallet",
      400,
      chain === "solana"
        ? "Create a Solana wallet before scheduling Solana actions."
        : "Create an EVM wallet before scheduling EVM actions.",
    );
  }

  const trigger = buildTrigger(body);
  const scheduleKind = normalizeScheduleKind(
    body?.schedule_kind ?? body?.kind ?? body?.recurrence,
    trigger.trigger_type,
  );
  if (trigger.trigger_type === "time" && scheduleKind === "condition") {
    throw new AgentApiError(
      "condition_requires_market_cap",
      400,
      "Condition schedules require a market-cap trigger.",
    );
  }
  if (
    trigger.trigger_type === "market_cap" && !marketTriggerAction(actionType)
  ) {
    throw new AgentApiError(
      "market_cap_action_unsupported",
      400,
      "Market-cap schedules currently support buy and sell actions.",
    );
  }

  const recurrence = buildRecurrence(body, scheduleKind, trigger);
  const action = await buildScheduledActionPayload({
    admin,
    profile,
    chain,
    wallet,
    tokenAddress,
    body,
    slippageBps,
    actionType,
    sourceSurface: ctx.sourceSurface,
    userId: ctx.userId,
  });

  const idempotencyKey = idempotencyKeyFor(ctx, body?.client_request_id);
  const persistedAction = action as any;
  const row = scheduledActionRow({
    userId: ctx.userId,
    actionType,
    chain,
    tokenAddress: tokenAddress ?? persistedAction.token_address ??
      persistedAction.token ?? null,
    action,
    trigger,
    scheduleKind,
    recurrence,
    idempotencyKey,
    sourceSurface: ctx.sourceSurface,
  });

  const { data, error } = await admin.from("scheduled_actions").insert(row)
    .select("*").single();
  if (error) {
    if (isUniqueViolation(error)) {
      const { data: existing, error: existingError } = await admin
        .from("scheduled_actions")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingError) throw existingError;
      return { scheduled_action: existing, idempotent_replay: true };
    }
    throw error;
  }

  return { scheduled_action: data };
}

async function mutateScheduledAction(
  admin: any,
  ctx: ScheduleRequestContext,
  forcedAction?: "cancel",
) {
  const url = new URL(ctx.request.url);
  const id = scheduleIdFrom(url, ctx.body, true)!;
  const action = forcedAction ?? normalizeScheduleMutation(ctx.body?.action);
  const patch = buildSchedulePatch(ctx.body, action);
  const { data, error } = await admin.rpc("mutate_linkr_schedule_v1", {
    p_user_id: ctx.userId,
    p_schedule_id: id,
    p_action: action,
    p_patch: patch,
  });
  if (error) throw error;
  return { scheduled_action: data };
}

function buildRecurrence(
  body: any,
  scheduleKind: ScheduleKind,
  trigger: SchedulerTrigger,
) {
  const intervalSeconds = normalizeIntervalSeconds(
    scheduleKind,
    body?.interval_seconds ?? body?.every_seconds ?? body?.repeat_seconds,
  );
  const startsAt = trigger.trigger_type === "time"
    ? trigger.scheduled_for
    : body?.starts_at != null || body?.scheduled_for != null ||
        body?.run_at != null
    ? parseOptionalFutureDate(
      body?.starts_at ?? body?.scheduled_for ?? body?.run_at,
      "starts_at",
    )?.toISOString() ??
      null
    : null;
  const endsAt =
    parseOptionalFutureDate(body?.ends_at, "ends_at")?.toISOString() ?? null;
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new AgentApiError(
      "invalid_ends_at",
      400,
      "ends_at must be after starts_at.",
    );
  }
  const maxOccurrences =
    body?.max_occurrences == null || body?.max_occurrences === ""
      ? null
      : boundedInteger(body.max_occurrences, 1, 10_000, "max_occurrences");
  const priority = body?.priority == null || body?.priority === ""
    ? 50
    : boundedInteger(body.priority, 0, 100, "priority");
  return {
    ends_at: endsAt,
    interval_seconds: intervalSeconds,
    max_occurrences: maxOccurrences,
    priority,
    recurrence_timezone: String(
      body?.recurrence_timezone ?? body?.timezone ?? "UTC",
    ).slice(0, 80),
    starts_at: startsAt,
  };
}

function buildSchedulePatch(body: any, action: string) {
  if (action !== "update") {
    return {
      reason: String(body?.reason ?? "").slice(0, 500) || null,
    };
  }
  const patch: Record<string, unknown> = {};
  if (body?.scheduled_for != null || body?.run_at != null) {
    patch.scheduled_for = parseOptionalFutureDate(
      body.scheduled_for ?? body.run_at,
      "scheduled_for",
      true,
    )?.toISOString();
  }
  if (body?.next_check_at != null) {
    patch.next_check_at = parseOptionalFutureDate(
      body.next_check_at,
      "next_check_at",
      true,
    )?.toISOString();
  }
  if (body?.ends_at != null) {
    patch.ends_at = body.ends_at === null || body.ends_at === ""
      ? null
      : parseOptionalFutureDate(body.ends_at, "ends_at", true)?.toISOString();
  }
  if (body?.interval_seconds != null) {
    patch.interval_seconds = boundedInteger(
      body.interval_seconds,
      60,
      SCHEDULER_MAX_DELAY_SECONDS,
      "interval_seconds",
    );
  }
  if (body?.max_occurrences != null) {
    patch.max_occurrences =
      body.max_occurrences === null || body.max_occurrences === ""
        ? null
        : boundedInteger(body.max_occurrences, 1, 10_000, "max_occurrences");
  }
  if (body?.priority != null) {
    patch.priority = boundedInteger(body.priority, 0, 100, "priority");
  }
  return patch;
}

function isAgentApiRequest(req: Request): boolean {
  return /^Bearer\s+linkr_live_/i.test(req.headers.get("Authorization") ?? "");
}

function scheduleIdFrom(url: URL, body: any, required: boolean): string | null {
  const fromPath = /\/([^/]+)$/.exec(url.pathname)?.[1];
  const pathId = fromPath && fromPath !== "create-scheduled-action"
    ? fromPath
    : null;
  const id = String(
    url.searchParams.get("id") ??
      pathId ??
      body?.id ??
      body?.schedule_id ??
      "",
  ).trim();
  if (!id && required) {
    throw new AgentApiError("missing_schedule_id", 400, "Missing schedule id.");
  }
  return id || null;
}

function normalizeScheduleMutation(
  value: unknown,
): "pause" | "resume" | "cancel" | "update" {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    raw === "pause" || raw === "resume" || raw === "cancel" || raw === "update"
  ) return raw;
  throw new AgentApiError(
    "invalid_schedule_action",
    400,
    "Invalid schedule action.",
  );
}

function parseOptionalFutureDate(
  value: unknown,
  field: string,
  required = false,
): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) {
    if (required) {
      throw new AgentApiError("missing_date", 400, `Missing ${field}.`, {
        field,
      });
    }
    return null;
  }
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new AgentApiError(
      "invalid_date",
      400,
      `${field} must be a valid date.`,
      { field },
    );
  }
  return parsed;
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  field: string,
): number {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new AgentApiError(
      "invalid_integer",
      400,
      `${field} must be between ${min} and ${max}.`,
      { field, min, max },
    );
  }
  return number;
}

function mapAgentScheduleError(error: unknown): unknown {
  if (error instanceof AgentApiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const status = statusForError(message);
  if (status < 500) {
    return new AgentApiError(
      message.replace(/[^a-z0-9_]+/gi, "_").toLowerCase().slice(0, 80) ||
        "schedule_error",
      status,
      userMessageForError(message),
    );
  }
  return error;
}

function normalizeChain(value: unknown): Chain {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["sol", "solana"].includes(raw)) return "solana";
  if (["eth", "evm", "robinhood", "robinhood_chain", "rhood"].includes(raw)) {
    return "robinhood";
  }
  throw new Error("invalid_chain");
}

function normalizeActionType(value: unknown): ScheduledActionType {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "buy" || raw === "sell" || raw === "transfer") return raw;
  if (["launch", "launch_token", "launch_coin"].includes(raw)) {
    return "launch_coin";
  }
  if (
    [
      "claim_creator_rewards",
      "creator_rewards",
      "creator_rewards_claim",
      "claim_rewards",
    ].includes(raw)
  ) return "claim_creator_rewards";
  if (["add_liquidity", "add_lp"].includes(raw)) return "add_liquidity";
  if (["remove_liquidity", "remove_lp"].includes(raw)) {
    return "remove_liquidity";
  }
  if (["collect_liquidity_fees", "collect_fees"].includes(raw)) {
    return "collect_liquidity_fees";
  }
  throw new Error("invalid_action_type");
}

function normalizeScheduleTokenAddress(
  chain: Chain,
  actionType: ScheduledActionType,
  body: any,
): string | null {
  if (actionType === "transfer" || actionType === "launch_coin") return null;
  const value = body?.token_address ?? body?.token ?? body?.mint ??
    body?.token_mint;
  if (
    actionType === "claim_creator_rewards" &&
    !value &&
    (body?.launch_id || body?.launchId || body?.symbol || body?.token_symbol ||
      body?.latest === true || body?.launch_reference === "latest")
  ) {
    return null;
  }
  if (
    (actionType === "remove_liquidity" ||
      actionType === "collect_liquidity_fees") &&
    !value &&
    (body?.position_id || body?.positionId || body?.position_token_id ||
      body?.positionTokenId)
  ) {
    return null;
  }
  return normalizeTokenAddress(chain, value);
}

function marketTriggerAction(actionType: ScheduledActionType): boolean {
  return actionType === "buy" || actionType === "sell";
}

function defaultSlippageBps(
  profile: any,
  actionType: ScheduledActionType,
): number {
  if (
    ![
      "buy",
      "sell",
      "add_liquidity",
      "remove_liquidity",
      "collect_liquidity_fees",
    ].includes(actionType)
  ) return 0;
  const slippageBps = Number(profile.default_slippage_bps ?? 0);
  if (!Number.isFinite(slippageBps) || slippageBps <= 0) {
    throw new AgentApiError(
      "missing_slippage",
      400,
      "Set a default slippage in Rules first.",
    );
  }
  return slippageBps;
}

function normalizeTokenAddress(chain: Chain, value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new Error(
      chain === "solana" ? "solana_mint_required" : "contract_required",
    );
  }
  try {
    return chain === "solana"
      ? normalizeSolanaPublicKey(text)
      : normalizeEvmAddress(text);
  } catch (_) {
    throw new Error(
      chain === "solana" ? "invalid_solana_mint" : "invalid_evm_contract",
    );
  }
}

function buildTrigger(body: any): SchedulerTrigger {
  const triggerType = normalizeTriggerType(body);
  if (triggerType === "time") {
    return buildTimeTrigger(body);
  }
  return buildMarketCapTrigger(body);
}

function normalizeTriggerType(body: any): TriggerType {
  const raw = String(body?.trigger_type ?? body?.trigger ?? "")
    .trim()
    .toLowerCase();
  if (raw === "time" || raw === "timed") return "time";
  if (raw === "market_cap" || raw === "marketcap" || raw === "mcap") {
    return "market_cap";
  }
  if (
    body?.trigger_value_usd != null ||
    body?.market_cap_usd != null ||
    body?.trigger_direction != null ||
    body?.direction != null
  ) {
    return "market_cap";
  }
  if (
    body?.scheduled_for != null ||
    body?.run_at != null ||
    body?.starts_at != null ||
    body?.interval_seconds != null ||
    body?.every_seconds != null
  ) {
    return "time";
  }
  throw new Error("invalid_trigger_type");
}

function buildTimeTrigger(
  bodyOrValue: unknown,
): Extract<SchedulerTrigger, { trigger_type: "time" }> {
  const body = bodyOrValue && typeof bodyOrValue === "object"
    ? bodyOrValue as Record<string, unknown>
    : null;
  const explicitValue = body
    ? body.scheduled_for ?? body.run_at ?? body.starts_at
    : bodyOrValue;
  const delaySecondsValue = body
    ? positiveNumber(
      body.delay_seconds ?? body.after_seconds ?? body.start_after_seconds,
    )
    : null;
  const intervalSecondsValue = body
    ? positiveNumber(
      body.interval_seconds ?? body.every_seconds ?? body.repeat_seconds,
    )
    : null;
  const scheduledFor = delaySecondsValue != null
    ? new Date(Date.now() + delaySecondsValue * 1000)
    : explicitValue != null && String(explicitValue).trim() !== ""
    ? new Date(String(explicitValue))
    : intervalSecondsValue != null
    ? new Date(Date.now() + intervalSecondsValue * 1000)
    : new Date("");
  if (!Number.isFinite(scheduledFor.getTime())) {
    throw new Error("invalid_scheduled_time");
  }
  const delaySeconds = Math.ceil((scheduledFor.getTime() - Date.now()) / 1000);
  if (delaySeconds < SCHEDULER_MIN_DELAY_SECONDS) {
    throw new Error("scheduled_time_too_soon");
  }
  if (delaySeconds > SCHEDULER_MAX_DELAY_SECONDS) {
    throw new Error("scheduled_time_too_far");
  }
  return {
    trigger_type: "time",
    scheduled_for: scheduledFor.toISOString(),
    delay_seconds: delaySeconds,
  };
}

function buildMarketCapTrigger(
  body: any,
): Extract<SchedulerTrigger, { trigger_type: "market_cap" }> {
  const direction = normalizeDirection(
    body?.trigger_direction ?? body?.direction,
  );
  const valueUsd = positiveNumber(
    body?.trigger_value_usd ?? body?.market_cap_usd,
  );
  if (valueUsd == null) throw new Error("invalid_market_cap");
  return {
    trigger_type: "market_cap",
    trigger_metric: "market_cap_usd",
    trigger_direction: direction,
    trigger_value_usd: valueUsd,
    next_check_at: new Date().toISOString(),
    check_interval_seconds: SCHEDULER_MARKET_CHECK_INTERVAL_SECONDS,
  };
}

function normalizeDirection(value: unknown): "below" | "above" {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["below", "under", "less_than", "less than", "lte", "<="].includes(raw)) {
    return "below";
  }
  if (
    ["above", "over", "greater_than", "greater than", "gte", ">="].includes(raw)
  ) {
    return "above";
  }
  throw new Error("invalid_trigger_direction");
}

async function buildScheduledActionPayload(args: {
  actionType: ScheduledActionType;
  admin: any;
  body: any;
  chain: Chain;
  profile: any;
  slippageBps: number;
  sourceSurface: "dashboard" | "agent_api";
  tokenAddress: string | null;
  userId: string;
  wallet: WalletRef;
}) {
  const {
    actionType,
    admin,
    body,
    chain,
    profile,
    slippageBps,
    sourceSurface,
    tokenAddress,
    userId,
    wallet,
  } = args;
  if (actionType === "buy") {
    return await buildBuyAction(
      admin,
      profile,
      chain,
      wallet,
      requiredToken(tokenAddress, chain),
      body,
      slippageBps,
    );
  }
  if (actionType === "sell") {
    return await buildSellAction(
      admin,
      profile,
      chain,
      wallet,
      requiredToken(tokenAddress, chain),
      body,
      slippageBps,
    );
  }
  if (actionType === "transfer") {
    return await buildTransferAction(admin, profile, chain, wallet, body);
  }
  if (actionType === "launch_coin") {
    return await buildLaunchScheduleAction(
      admin,
      profile,
      chain,
      wallet,
      body,
      sourceSurface,
    );
  }
  if (actionType === "claim_creator_rewards") {
    return await buildCreatorRewardsScheduleAction(
      admin,
      userId,
      chain,
      body,
      sourceSurface,
    );
  }
  if (actionType === "add_liquidity") {
    return await buildAddLiquidityScheduleAction(
      admin,
      userId,
      chain,
      body,
      sourceSurface,
      slippageBps,
    );
  }
  if (actionType === "remove_liquidity") {
    return await buildRemoveLiquidityScheduleAction(
      admin,
      userId,
      chain,
      body,
      sourceSurface,
      slippageBps,
      false,
    );
  }
  return await buildRemoveLiquidityScheduleAction(
    admin,
    userId,
    chain,
    body,
    sourceSurface,
    slippageBps,
    true,
  );
}

async function buildBuyAction(
  admin: any,
  profile: any,
  chain: Chain,
  wallet: WalletRef,
  tokenAddress: string,
  body: any,
  slippageBps: number,
) {
  const amountOriginal = positiveNumber(body?.amount ?? body?.amount_original);
  if (amountOriginal == null) throw new Error("invalid_buy_amount");
  const unit = normalizeBuyUnit(
    chain,
    body?.amount_unit ?? body?.amount_original_unit,
  );
  const normalized = chain === "solana"
    ? await normalizeSolAmount(admin, {
      amount_original: amountOriginal,
      amount_original_unit: unit,
    })
    : await normalizeAmount(admin, {
      amount_original: amountOriginal,
      amount_original_unit: unit,
    });
  if ("error" in normalized) throw new Error(normalized.error);

  if (chain === "solana") {
    const amountSol = Number(normalized.amount_sol ?? 0);
    enforceBuyCap("solana", amountSol, profile);
    await assertSolBalance(wallet.address, requiredSolForBuy(amountSol));
    return {
      intent: "buy_token",
      chain,
      output_mint: tokenAddress,
      token_address: tokenAddress,
      address_source: "dashboard",
      input_asset: "native_sol",
      amount_sol: amountSol,
      amount_usd: normalized.amount_usd,
      amount_original: amountOriginal,
      amount_original_unit: unit,
      sol_price_usd: normalized.sol_price_usd ?? null,
      slippage_bps: slippageBps,
      settings_snapshot: snapshotLimits(profile),
      source: "dashboard",
    };
  }

  const amountEth = Number(normalized.amount_eth ?? 0);
  enforceBuyCap("robinhood", amountEth, profile);
  await assertEthBalance(wallet.address, requiredEthForBuy(amountEth));
  return {
    intent: "buy_token",
    chain,
    output_mint: tokenAddress,
    token_address: tokenAddress,
    address_source: "dashboard",
    input_asset: "native_eth",
    amount_eth: amountEth,
    amount_usd: normalized.amount_usd,
    amount_original: amountOriginal,
    amount_original_unit: unit,
    eth_price_usd: normalized.eth_price_usd ?? null,
    slippage_bps: slippageBps,
    settings_snapshot: snapshotLimits(profile),
    source: "dashboard",
  };
}

async function buildSellAction(
  _admin: any,
  profile: any,
  chain: Chain,
  wallet: WalletRef,
  tokenAddress: string,
  body: any,
  slippageBps: number,
) {
  const sellMode = String(body?.sell_mode ?? body?.amount_unit ?? "")
    .trim()
    .toLowerCase();
  const amountAll = sellMode === "all" || body?.amount_all === true;
  const amountPct = amountAll
    ? null
    : positiveNumber(body?.sell_percent ?? body?.amount_pct);
  if (!amountAll && (amountPct == null || amountPct > 100)) {
    throw new Error("invalid_sell_amount");
  }
  enforceSellCap(amountAll, amountPct, profile);

  if (chain === "solana") {
    await assertSolTokenPosition(wallet.address, tokenAddress);
  } else await assertEvmTokenPosition(wallet.address, tokenAddress);

  return {
    intent: "sell_token",
    chain,
    input_mint: tokenAddress,
    token_address: tokenAddress,
    amount_pct: amountPct,
    amount_all: amountAll,
    slippage_bps: slippageBps,
    settings_snapshot: snapshotLimits(profile),
    source: "dashboard",
  };
}

async function buildTransferAction(
  admin: any,
  profile: any,
  chain: Chain,
  wallet: WalletRef,
  body: any,
) {
  const recipient = normalizeRecipient(chain, body?.recipient ?? body?.to);
  const amountOriginal = positiveNumber(
    body?.amount ??
      body?.amount_original ??
      (chain === "solana" ? body?.amount_sol : body?.amount_eth),
  );
  if (amountOriginal == null) throw new Error("invalid_transfer_amount");
  const unit = normalizeTransferUnit(
    chain,
    body?.amount_unit ??
      body?.amount_original_unit ??
      (chain === "solana" && body?.amount_sol != null ? "sol" : null) ??
      (chain === "robinhood" && body?.amount_eth != null ? "eth" : null),
  );
  const normalized = chain === "solana"
    ? await normalizeSolAmount(admin, {
      amount_original: amountOriginal,
      amount_original_unit: unit,
    })
    : await normalizeAmount(admin, {
      amount_original: amountOriginal,
      amount_original_unit: unit,
    });
  if ("error" in normalized) throw new Error(normalized.error);

  if (chain === "solana") {
    const amountSol = Number(normalized.amount_sol ?? 0);
    enforceTransferCap("solana", amountSol, profile);
    const preflight = await estimateSolTransferBalancePreflight({
      from_address: wallet.address,
      recipient,
      amount_sol: amountSol,
    });
    if (preflight.balanceLamports < preflight.requiredLamports) {
      throw new Error(
        insufficientNativeBalanceReply({
          symbol: "SOL",
          currentBalance: Number(preflight.balanceLamports) / 1_000_000_000,
          requiredAmount: Number(preflight.requiredLamports) / 1_000_000_000,
        }),
      );
    }
    return {
      intent: "transfer_native",
      chain,
      recipient,
      input_asset: "native_sol",
      amount_sol: amountSol,
      amount_usd: normalized.amount_usd,
      amount_original: amountOriginal,
      amount_original_unit: unit,
      sol_price_usd: normalized.sol_price_usd ?? null,
      settings_snapshot: snapshotLimits(profile),
      source: "dashboard",
    };
  }

  const amountEth = Number(normalized.amount_eth ?? 0);
  enforceTransferCap("robinhood", amountEth, profile);
  const preflight = await estimateEthTransferBalancePreflight({
    from_address: wallet.address,
    recipient,
    amount_eth: amountEth,
  });
  if (preflight.balanceWei < preflight.requiredBalanceWei) {
    throw new Error(
      insufficientNativeBalanceReply({
        symbol: "ETH",
        currentBalance: Number(ethers.formatEther(preflight.balanceWei)),
        requiredAmount: Number(
          ethers.formatEther(preflight.requiredBalanceWei),
        ),
      }),
    );
  }
  return {
    intent: "transfer_native",
    chain,
    recipient,
    input_asset: "native_eth",
    amount_eth: amountEth,
    amount_usd: normalized.amount_usd,
    amount_original: amountOriginal,
    amount_original_unit: unit,
    eth_price_usd: normalized.eth_price_usd ?? null,
    settings_snapshot: snapshotLimits(profile),
    source: "dashboard",
  };
}

async function buildLaunchScheduleAction(
  admin: any,
  profile: any,
  chain: Chain,
  wallet: WalletRef,
  body: any,
  sourceSurface: "dashboard" | "agent_api",
) {
  const name = cleanLaunchText(body?.name, chain === "solana" ? 32 : 60);
  if (!name) throw new Error("launch_name_required");
  const symbol = cleanLaunchSymbol(body?.symbol ?? body?.ticker, chain);
  if (!symbol) throw new Error("launch_symbol_required");
  const description = cleanLaunchText(body?.description, 512);
  if (!description) throw new Error("launch_description_required");
  const imageUrl = requiredHttps(
    body?.image_url ?? body?.image,
    "invalid_image_url",
  );
  const amount = readLaunchInitialBuy(body, chain);
  enforceLaunchCap(profile, chain, amount);
  const { rehostLaunchImageUrl } = await import("../_shared/bounded_media.ts");
  let hostedImageUrl: string;
  try {
    hostedImageUrl = await rehostLaunchImageUrl(admin, imageUrl);
  } catch (error) {
    throw new Error(
      `image_unusable:${
        String(error instanceof Error ? error.message : error).slice(0, 80)
      }`,
    );
  }
  return {
    intent: "launch_coin",
    chain,
    wallet_id: wallet.id,
    wallet_address: wallet.address,
    name,
    symbol,
    description,
    image_url: hostedImageUrl,
    original_image_url: imageUrl,
    ...(chain === "solana"
      ? { initial_buy_sol: amount, amount_sol: amount }
      : { initial_buy_eth: amount, amount_eth: amount }),
    website_url: optionalHttps(body?.website_url ?? body?.website),
    twitter_url: optionalHttps(
      body?.twitter_url ?? body?.twitter ?? body?.x_url ?? body?.x,
    ),
    telegram_url: optionalHttps(body?.telegram_url ?? body?.telegram),
    source_url: optionalHttps(body?.source_url ?? body?.source_tweet_url),
    raw_user_text: String(body?.raw_user_text ?? body?.text ?? "").slice(
      0,
      2000,
    ) || null,
    settings_snapshot: snapshotLimits(profile),
    source: sourceSurface,
  };
}

async function buildCreatorRewardsScheduleAction(
  admin: any,
  userId: string,
  chain: Chain,
  body: any,
  sourceSurface: "dashboard" | "agent_api",
) {
  const { previewCreatorRewardsClaim } = await import(
    "../_shared/creator_rewards_claim.ts"
  );
  const request = {
    launch_id: body?.launch_id ?? body?.launchId ?? null,
    token_address: body?.token_address ?? body?.token ?? body?.address ?? null,
    mint: body?.mint ?? body?.token_mint ?? null,
    symbol: body?.symbol ?? body?.token_symbol ?? body?.coin_symbol ?? null,
    latest: body?.latest === true || body?.launch_reference === "latest",
    chain,
  };
  const preview = await previewCreatorRewardsClaim(admin, userId, request);
  if (preview.chain !== chain) {
    throw new Error("scheduled_rewards_chain_mismatch");
  }
  return {
    intent: "claim_creator_rewards",
    chain,
    launch_id: preview.launch?.id ?? request.launch_id,
    token: preview.address,
    token_address: preview.address,
    symbol: preview.launch?.symbol ?? request.symbol,
    latest: request.latest,
    creation_preview: {
      chain: preview.chain,
      address: preview.address,
      summary: preview.summary,
      snapshot: preview.snapshot,
    },
    source: sourceSurface,
  };
}

async function buildAddLiquidityScheduleAction(
  admin: any,
  userId: string,
  chain: Chain,
  body: any,
  sourceSurface: "dashboard" | "agent_api",
  slippageBps: number,
) {
  const request = {
    ...body,
    chain,
    slippage_bps: body?.slippage_bps ?? body?.slippageBps ?? slippageBps,
  };
  const quote = chain === "solana"
    ? await (await import("../_shared/pump_liquidity/actions.ts"))
      .quotePumpAddLiquidity(admin, userId, request)
    : await (await import("../_shared/robinhood_liquidity/quote.ts"))
      .quoteAddLiquidity(admin, userId, request);
  return {
    intent: "add_liquidity",
    chain,
    token: quote.token_address,
    token_address: quote.token_address,
    token_symbol: quote.token_symbol ?? null,
    amount_eth: chain === "robinhood" && (quote as any).eth_amount_wei
      ? Number(ethers.formatEther(BigInt((quote as any).eth_amount_wei)))
      : null,
    amount_sol: chain === "solana" && (quote as any).sol_amount_lamports
      ? Number((quote as any).sol_amount_lamports) / 1_000_000_000
      : null,
    amount_original: positiveNumber(
      body?.amount ?? body?.amount_original ?? body?.amount_eth ??
        body?.token_amount,
    ),
    amount_original_unit: chain === "solana" ? "token" : "eth",
    slippage_bps: Number((quote as any).slippage_bps ?? slippageBps),
    creation_quote: compactQuote(quote),
    source: sourceSurface,
  };
}

async function buildRemoveLiquidityScheduleAction(
  admin: any,
  userId: string,
  chain: Chain,
  body: any,
  sourceSurface: "dashboard" | "agent_api",
  slippageBps: number,
  collectFees: boolean,
) {
  if (chain === "solana" && collectFees) {
    throw new Error("solana_collect_liquidity_fees_unsupported");
  }
  const request = {
    ...body,
    chain,
    slippage_bps: body?.slippage_bps ?? body?.slippageBps ?? slippageBps,
  };
  const quote = chain === "solana"
    ? await (await import("../_shared/pump_liquidity/actions.ts"))
      .quotePumpRemoveLiquidity(admin, userId, request)
    : collectFees
    ? await (await import("../_shared/robinhood_liquidity/quote.ts"))
      .quoteCollectFees(admin, userId, request)
    : await (await import("../_shared/robinhood_liquidity/quote.ts"))
      .quoteRemoveLiquidity(admin, userId, request);
  const action = collectFees ? "collect_liquidity_fees" : "remove_liquidity";
  return {
    intent: action,
    chain,
    token: quote.token_address,
    token_address: quote.token_address,
    token_symbol: quote.token_symbol ?? null,
    position_id: (quote as any).position_id ?? body?.position_id ?? null,
    position_token_id: (quote as any).position_token_id ??
      (quote as any).lp_token_account ?? null,
    percent: (quote as any).requested_percent ?? null,
    amount_pct: (quote as any).requested_percent ?? null,
    slippage_bps: Number((quote as any).slippage_bps ?? slippageBps),
    creation_quote: compactQuote(quote),
    source: sourceSurface,
  };
}

function normalizeBuyUnit(chain: Chain, value: unknown): "eth" | "sol" | "usd" {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "usd") return "usd";
  if (chain === "solana" && raw === "sol") return "sol";
  if (chain === "robinhood" && raw === "eth") return "eth";
  throw new Error(
    chain === "solana" ? "invalid_solana_buy_unit" : "invalid_evm_buy_unit",
  );
}

function normalizeTransferUnit(
  chain: Chain,
  value: unknown,
): "eth" | "sol" | "usd" {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return chain === "solana" ? "sol" : "eth";
  if (raw === "usd") return "usd";
  if (chain === "solana" && raw === "sol") return "sol";
  if (chain === "robinhood" && raw === "eth") return "eth";
  throw new Error(
    chain === "solana"
      ? "invalid_solana_transfer_unit"
      : "invalid_evm_transfer_unit",
  );
}

function normalizeRecipient(chain: Chain, value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error("recipient_required");
  try {
    return chain === "solana"
      ? normalizeSolanaPublicKey(text)
      : normalizeEvmAddress(text);
  } catch (_) {
    throw new Error(
      chain === "solana" ? "invalid_solana_recipient" : "invalid_evm_recipient",
    );
  }
}

function enforceBuyCap(chain: Chain, amountNative: number, profile: any) {
  if (!Number.isFinite(amountNative) || amountNative <= 0) {
    throw new Error("invalid_buy_amount");
  }
  const cap = chain === "solana"
    ? Number(profile?.max_auto_buy_sol ?? 0)
    : Number(profile?.max_auto_buy_eth ?? 0);
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error(
      chain === "solana"
        ? "max_auto_buy_sol_disabled"
        : "max_auto_buy_eth_disabled",
    );
  }
  if (amountNative > cap) {
    throw new Error(
      chain === "solana"
        ? "max_auto_buy_sol_exceeded"
        : "max_auto_buy_eth_exceeded",
    );
  }
}

function enforceSellCap(
  amountAll: boolean,
  amountPct: number | null,
  profile: any,
) {
  const cap = Number(profile?.max_auto_sell_percent ?? 0);
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error("max_auto_sell_percent_disabled");
  }
  if (!amountAll && Number(amountPct ?? 0) > cap) {
    throw new Error("max_auto_sell_percent_exceeded");
  }
}

function enforceTransferCap(chain: Chain, amountNative: number, profile: any) {
  if (!Number.isFinite(amountNative) || amountNative <= 0) {
    throw new Error("invalid_transfer_amount");
  }
  const cap = chain === "solana"
    ? Number(profile?.max_auto_transfer_sol ?? 0)
    : Number(profile?.max_auto_transfer_eth ?? 0);
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error(
      chain === "solana"
        ? "max_auto_transfer_sol_disabled"
        : "max_auto_transfer_eth_disabled",
    );
  }
  if (amountNative > cap) {
    throw new Error(
      chain === "solana"
        ? "max_auto_transfer_sol_exceeded"
        : "max_auto_transfer_eth_exceeded",
    );
  }
}

async function assertEthBalance(address: string, requiredAmount: number) {
  const currentBalance = await getEthBalance(address);
  if (nativeBalanceIsTooLow(currentBalance, requiredAmount)) {
    throw new Error(
      insufficientNativeBalanceReply({
        symbol: "ETH",
        currentBalance,
        requiredAmount,
      }),
    );
  }
}

async function assertSolBalance(address: string, requiredAmount: number) {
  const lamports = await solanaConnection().getBalance(
    new PublicKey(address),
    "confirmed",
  );
  const currentBalance = lamports / LAMPORTS_PER_SOL;
  if (nativeBalanceIsTooLow(currentBalance, requiredAmount)) {
    throw new Error(
      insufficientNativeBalanceReply({
        symbol: "SOL",
        currentBalance,
        requiredAmount,
      }),
    );
  }
}

async function assertEvmTokenPosition(address: string, tokenAddress: string) {
  const balances = await getErc20TokenBalances(address);
  const holding = balances.find(
    (item: any) =>
      String(item.token_address ?? item.mint ?? "").toLowerCase() ===
        tokenAddress.toLowerCase(),
  );
  const rawBalance = holding?.raw_value == null
    ? 0n
    : BigInt(holding.raw_value);
  if (rawBalance <= 0n) throw new Error("no_token_position");
}

async function assertSolTokenPosition(address: string, tokenMint: string) {
  const balance = await getSolanaTokenBalanceRaw({
    owner: address,
    mint: tokenMint,
  });
  if (balance.amount <= 0n) throw new Error("no_token_position");
}

function scheduledActionRow(args: {
  userId: string;
  actionType: ScheduledActionType;
  chain: Chain;
  tokenAddress: string | null;
  action: any;
  trigger: SchedulerTrigger;
  scheduleKind: ScheduleKind;
  recurrence: {
    ends_at: string | null;
    interval_seconds: number | null;
    max_occurrences: number | null;
    priority: number;
    recurrence_timezone: string;
    starts_at: string | null;
  };
  idempotencyKey: string;
  sourceSurface: "dashboard" | "agent_api";
}) {
  const trigger = args.trigger;
  const action = args.action;
  return {
    user_id: args.userId,
    source: args.sourceSurface,
    source_surface: args.sourceSurface,
    source_tweet_id: null,
    source_tweet_url: null,
    pending_action_id: null,
    action_type: args.actionType,
    trigger_type: trigger.trigger_type,
    chain: args.chain,
    status: "pending",
    token_address: args.tokenAddress,
    token_symbol: action.token_symbol ?? null,
    recipient: action.recipient ?? null,
    amount_original: action.amount_original ?? null,
    amount_original_unit: action.amount_original_unit ?? null,
    amount_eth: action.amount_eth ?? null,
    amount_sol: action.amount_sol ?? null,
    amount_usd: action.amount_usd ?? null,
    amount_pct: action.amount_pct ?? null,
    amount_all: action.amount_all === true,
    slippage_bps: action.slippage_bps ?? null,
    scheduled_for: trigger.trigger_type === "time"
      ? trigger.scheduled_for
      : null,
    trigger_metric: trigger.trigger_type === "market_cap"
      ? trigger.trigger_metric
      : null,
    trigger_direction: trigger.trigger_type === "market_cap"
      ? trigger.trigger_direction
      : null,
    trigger_value_usd: trigger.trigger_type === "market_cap"
      ? trigger.trigger_value_usd
      : null,
    next_check_at: trigger.trigger_type === "market_cap"
      ? args.recurrence.starts_at ?? trigger.next_check_at
      : null,
    schedule_kind: args.scheduleKind,
    priority: args.recurrence.priority,
    interval_seconds: args.recurrence.interval_seconds,
    recurrence_timezone: args.recurrence.recurrence_timezone,
    starts_at: args.recurrence.starts_at,
    ends_at: args.recurrence.ends_at,
    max_occurrences: args.recurrence.max_occurrences,
    updated_by_user_id: args.userId,
    idempotency_key: args.idempotencyKey,
    action_payload: { ...action, source: args.sourceSurface },
    trigger_payload: {
      ...trigger,
      schedule_kind: args.scheduleKind,
      recurrence: args.recurrence,
    },
  };
}

async function loadProfile(admin: any, userId: string) {
  const { data, error } = await admin.from("profiles").select("*").eq(
    "user_id",
    userId,
  ).single();
  if (error) throw error;
  return data;
}

async function loadEvmWalletRef(
  admin: any,
  userId: string,
): Promise<WalletRef | null> {
  const { data, error } = await admin
    .from("wallets")
    .select("id,address,public_key")
    .eq("user_id", userId)
    .eq("wallet_type", "evm")
    .eq("chain_id", ROBINHOOD_CHAIN_ID)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const address = normalizeEvmAddress(data.address ?? data.public_key);
  return { id: data.id, address, public_key: address };
}

async function loadSolanaWalletRef(
  admin: any,
  userId: string,
): Promise<WalletRef | null> {
  const { data, error } = await admin
    .from("wallets")
    .select("id,address,public_key")
    .eq("user_id", userId)
    .eq("wallet_type", "solana")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const address = normalizeSolanaPublicKey(data.address ?? data.public_key);
  return { id: data.id, address, public_key: address };
}

async function loadScheduleWallet(
  admin: any,
  userId: string,
  chain: Chain,
  agentCtx?: any,
): Promise<WalletRef | null> {
  if (agentCtx?.walletId) {
    const wallet = agentCtx.wallet;
    if (chain === "solana") {
      if (wallet?.wallet_type !== "solana") {
        throw new AgentApiError(
          "wallet_chain_mismatch",
          403,
          "API key is not bound to a Solana wallet.",
        );
      }
      const address = normalizeSolanaPublicKey(
        wallet.address ?? wallet.public_key,
      );
      return { id: wallet.id, address, public_key: address };
    }
    if (
      wallet?.wallet_type !== "evm" ||
      Number(wallet?.chain_id) !== ROBINHOOD_CHAIN_ID
    ) {
      throw new AgentApiError(
        "wallet_chain_mismatch",
        403,
        "API key is not bound to a Robinhood Chain wallet.",
      );
    }
    const address = normalizeEvmAddress(wallet.address ?? wallet.public_key);
    return { id: wallet.id, address, public_key: address };
  }
  return chain === "solana"
    ? await loadSolanaWalletRef(admin, userId)
    : await loadEvmWalletRef(admin, userId);
}

function positiveNumber(value: unknown): number | null {
  if (typeof value === "string") {
    const parsed = parseCompactNumber(value);
    if (parsed != null) return parsed;
  }
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseCompactNumber(value: string): number | null {
  const text = value
    .trim()
    .replace(/[$,\s_]/g, "")
    .toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base) || base <= 0) return null;
  const multiplier = match[2] === "b"
    ? 1_000_000_000
    : match[2] === "m"
    ? 1_000_000
    : match[2] === "k"
    ? 1_000
    : 1;
  return base * multiplier;
}

function idempotencyKeyFor(
  ctx: ScheduleRequestContext,
  value: unknown,
): string {
  if (ctx.sourceSurface === "agent_api") {
    const agent = ctx.agentCtx;
    if (!agent?.apiKeyId || !agent?.idempotencyKey) {
      throw new AgentApiError(
        "idempotency_required",
        400,
        "Idempotency-Key is required.",
      );
    }
    return `agent-schedule:${agent.apiKeyId}:${agent.idempotencyKey}`;
  }
  const raw = String(value ?? "").trim();
  const clientPart = /^[A-Za-z0-9._:-]{8,120}$/.test(raw)
    ? raw
    : crypto.randomUUID();
  return `dashboard-schedule:${ctx.userId}:${clientPart}`;
}

function snapshotLimits(p: any) {
  return {
    default_slippage_bps: Number(p.default_slippage_bps ?? 0),
    max_auto_buy_eth: Number(p.max_auto_buy_eth ?? 0),
    max_auto_buy_sol: Number(p.max_auto_buy_sol ?? 0),
    max_auto_sell_percent: Number(p.max_auto_sell_percent ?? 0),
    max_auto_transfer_eth: Number(p.max_auto_transfer_eth ?? 0),
    max_auto_transfer_sol: Number(p.max_auto_transfer_sol ?? 0),
    max_auto_dev_buy_eth: Number(p.max_auto_dev_buy_eth ?? 0),
    max_auto_dev_buy_sol: Number(p.max_auto_dev_buy_sol ?? 0),
    require_confirmation_for_all_tx: !!p.require_confirmation_for_all_tx,
  };
}

function requiredToken(value: string | null, chain: Chain): string {
  if (value) return value;
  throw new Error(
    chain === "solana" ? "solana_mint_required" : "contract_required",
  );
}

function cleanLaunchText(value: unknown, max: number): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function cleanLaunchSymbol(value: unknown, chain: Chain): string {
  const max = chain === "solana" ? 10 : 20;
  return String(value ?? "")
    .replace(/^\$/, "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, max);
}

function readLaunchInitialBuy(body: any, chain: Chain): number {
  const value = chain === "solana"
    ? body?.initial_buy_sol ?? body?.dev_buy_sol ?? body?.amount_sol ??
      body?.amount ?? "0"
    : body?.initial_buy_eth ?? body?.dev_buy_eth ?? body?.amount_eth ??
      body?.amount ?? "0";
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,18})?$/.test(text)) {
    throw new Error("invalid_initial_buy");
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("invalid_initial_buy");
  }
  return amount;
}

function enforceLaunchCap(profile: any, chain: Chain, amount: number) {
  const cap = Number(
    chain === "solana"
      ? profile?.max_auto_dev_buy_sol ?? 0
      : profile?.max_auto_dev_buy_eth ?? 0,
  );
  const absoluteCap = chain === "solana" ? 5 : 0.1;
  const allowed = Math.min(
    absoluteCap,
    Number.isFinite(cap) ? Math.max(0, cap) : 0,
  );
  if (amount > allowed) throw new Error("launch_cap_exceeded");
}

function requiredHttps(value: unknown, code: string): string {
  const text = String(value ?? "").trim();
  if (!/^https:\/\//i.test(text)) throw new Error(code);
  return text;
}

function optionalHttps(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > 2048 || !/^https:\/\//i.test(text)) {
    throw new Error("invalid_metadata_url");
  }
  return text;
}

function compactQuote(quote: any) {
  const keys = [
    "action",
    "chain",
    "platform",
    "token_address",
    "token_symbol",
    "pool_address",
    "pool_fee",
    "wallet_address",
    "eth_amount_wei",
    "sol_amount_lamports",
    "token_amount_wei",
    "token_amount_raw",
    "liquidity_delta",
    "lp_token_amount",
    "position_id",
    "position_token_id",
    "lp_token_account",
    "requested_percent",
    "slippage_bps",
  ];
  const compact: Record<string, unknown> = {};
  for (const key of keys) {
    if (quote?.[key] != null) compact[key] = quote[key];
  }
  return compact;
}

function isUniqueViolation(error: any): boolean {
  return (
    error?.code === "23505" ||
    /duplicate key|already exists|unique/i.test(
      String(error?.message ?? error ?? ""),
    )
  );
}

function statusForError(message: string): number {
  if (/unauthorized/.test(message)) return 401;
  if (/not_found|no_.*wallet|no_token_position/.test(message)) return 400;
  if (
    /invalid|missing|required|disabled|exceeded|too_soon|too_far|unavailable|unsupported|mismatch|unusable/
      .test(message)
  ) {
    return 400;
  }
  if (/Your balance is too low/.test(message)) return 400;
  return 500;
}

function userMessageForError(message: string): string {
  const map: Record<string, string> = {
    invalid_json: "Request body must be valid JSON.",
    invalid_chain: "Choose EVM or Solana.",
    invalid_action_type:
      "Choose buy, sell, transfer, launch, creator rewards, or liquidity.",
    contract_required: "Enter a full EVM contract address.",
    invalid_evm_contract: "Enter a valid full EVM contract address.",
    solana_mint_required: "Enter a full Solana mint address.",
    invalid_solana_mint: "Enter a valid full Solana mint address.",
    invalid_trigger_type: "Choose time or market cap.",
    invalid_scheduled_time: "Choose a valid scheduled time.",
    scheduled_time_too_soon: "Choose a time at least 1 minute from now.",
    scheduled_time_too_far: "Scheduled actions can be at most 30 days out.",
    invalid_trigger_direction:
      "Choose above or below for the market-cap trigger.",
    invalid_market_cap: "Enter a positive market cap.",
    invalid_buy_amount: "Enter a positive buy amount.",
    invalid_sell_amount:
      "Enter a sell percent from 0.01 to 100, or choose 100%.",
    invalid_solana_buy_unit: "Solana buys must use SOL or USD.",
    invalid_evm_buy_unit: "EVM buys must use ETH or USD.",
    max_auto_buy_sol_disabled: "Set a Solana buy cap in Rules first.",
    max_auto_buy_eth_disabled: "Set an EVM buy cap in Rules first.",
    max_auto_buy_sol_exceeded: "This buy is above your Solana buy cap.",
    max_auto_buy_eth_exceeded: "This buy is above your EVM buy cap.",
    max_auto_sell_percent_disabled: "Set a max sell percent in Rules first.",
    max_auto_sell_percent_exceeded: "This sell is above your max sell percent.",
    invalid_transfer_amount: "Enter a positive transfer amount.",
    recipient_required: "Enter a recipient address.",
    invalid_solana_recipient: "Enter a valid full Solana recipient address.",
    invalid_evm_recipient: "Enter a valid full EVM recipient address.",
    invalid_solana_transfer_unit: "Solana transfers must use SOL or USD.",
    invalid_evm_transfer_unit: "EVM transfers must use ETH or USD.",
    max_auto_transfer_sol_disabled: "Set a Solana transfer cap in Rules first.",
    max_auto_transfer_eth_disabled: "Set an EVM transfer cap in Rules first.",
    max_auto_transfer_sol_exceeded:
      "This transfer is above your Solana transfer cap.",
    max_auto_transfer_eth_exceeded:
      "This transfer is above your EVM transfer cap.",
    invalid_schedule_kind: "Choose a supported schedule kind.",
    invalid_interval_seconds: "Enter a valid repeat interval.",
    interval_too_short:
      "Recurring schedules must repeat at least 1 minute apart.",
    interval_too_long: "Recurring schedules can repeat at most every 30 days.",
    recurring_market_cap_unsupported:
      "Market-cap schedules cannot be recurring.",
    condition_requires_market_cap:
      "Condition schedules require a market-cap trigger.",
    eth_price_unavailable:
      "ETH price is unavailable right now. Try a native ETH amount.",
    sol_price_unavailable:
      "SOL price is unavailable right now. Try a native SOL amount.",
    no_token_position: "That token was not found in your selected wallet.",
    market_cap_action_unsupported:
      "Market-cap schedules currently support buy and sell actions.",
    launch_name_required: "Enter a launch name.",
    launch_symbol_required: "Enter a launch ticker.",
    launch_description_required: "Enter a launch description.",
    invalid_image_url: "Use an HTTPS image URL for scheduled launches.",
    image_unusable: "The launch image could not be read safely.",
    invalid_initial_buy: "Enter a valid initial buy amount.",
    launch_cap_exceeded:
      "The launch initial buy is above your configured launch cap.",
    invalid_metadata_url: "Metadata links must be HTTPS URLs.",
    scheduled_rewards_chain_mismatch:
      "The creator rewards launch does not match the selected chain.",
    solana_collect_liquidity_fees_unsupported:
      "Solana PumpSwap fees are collected during liquidity removal, not as a separate schedule.",
  };
  return map[message] ?? message;
}
