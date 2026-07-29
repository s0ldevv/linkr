import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Pause, Play, Plus, XCircle } from "lucide-react";
import { ChainPill } from "@/components/linkr/ChainPill";
import { DashboardStatCard } from "@/components/linkr/DashboardStatCard";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { formatEth, formatUsd, shortAddress } from "@/lib/linkr/format";
import { toast } from "sonner";

type ScheduledAction = Tables<"scheduled_actions"> & {
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  ends_at?: string | null;
  executed_at?: string | null;
  failed_at?: string | null;
  failed_occurrence_count?: number | null;
  interval_seconds?: number | null;
  last_execution_at?: string | null;
  max_occurrences?: number | null;
  occurrence_count?: number | null;
  paused_at?: string | null;
  processed_at?: string | null;
  schedule_kind?: string | null;
  successful_occurrence_count?: number | null;
};
type SchedulerChain = "robinhood" | "solana";
type SchedulerActionType =
  | "buy"
  | "sell"
  | "transfer"
  | "launch_coin"
  | "claim_creator_rewards"
  | "add_liquidity"
  | "remove_liquidity"
  | "collect_liquidity_fees";
type SchedulerTriggerType = "time" | "market_cap";
type ScheduleKind = "one_time" | "interval" | "daily" | "weekly";
type FirstRunMode = "after_interval" | "soon" | "at_time";
type BuyUnit = "eth" | "sol" | "usd";
type TransferUnit = "eth" | "sol" | "usd";
type SellMode = "all" | "percent";
type TriggerDirection = "below" | "above";
type ScheduleOccurrence = {
  attempt_count: number | null;
  completed_at: string | null;
  due_at: string;
  error: string | null;
  id: string;
  observed_value_usd: number | null;
  occurrence_key: string;
  schedule_id: string;
  started_at: string | null;
  status: string;
  transaction_hash: string | null;
  transaction_id: string | null;
  transaction_signature: string | null;
};
type UntypedSupabaseQuery = {
  eq: (column: string, value: unknown) => UntypedSupabaseQuery;
  in: (column: string, values: readonly string[]) => UntypedSupabaseQuery;
  limit: (count: number) => Promise<{ data: unknown; error: { message?: string } | null }>;
  order: (column: string, options: { ascending: boolean }) => UntypedSupabaseQuery;
  select: (columns: string) => UntypedSupabaseQuery;
};
type UntypedSupabaseClient = {
  from: (table: string) => UntypedSupabaseQuery;
};

const ACTION_OPTIONS: Array<{ value: SchedulerActionType; label: string }> = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "transfer", label: "Transfer" },
  { value: "launch_coin", label: "Launch" },
  { value: "claim_creator_rewards", label: "Creator rewards" },
  { value: "add_liquidity", label: "Add liquidity" },
  { value: "remove_liquidity", label: "Remove liquidity" },
  { value: "collect_liquidity_fees", label: "Collect fees" },
];

const SCHEDULE_KIND_OPTIONS: Array<{ value: ScheduleKind; label: string }> = [
  { value: "one_time", label: "Once" },
  { value: "interval", label: "Interval" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

type CreateScheduledActionResponse = {
  scheduled_action?: ScheduledAction | null;
  error?: string;
  message?: string;
};

type ScheduleControlAction = "pause" | "resume" | "cancel";

type SchedulerTokenFacts = {
  chain?: string | null;
  chain_id?: number | null;
  mint?: string | null;
  token_address?: string | null;
  explorer_url?: string | null;
  symbol?: string | null;
  name?: string | null;
  price_usd?: number | null;
  price_change_24h?: number | null;
  liquidity_usd?: number | null;
  market_cap_usd?: number | null;
  fdv_usd?: number | null;
  freshness?: string | null;
  warnings?: string[];
};

export const Route = createFileRoute("/_authenticated/app/scheduler")({
  head: () => ({ meta: [{ title: "Scheduler - Linkr" }] }),
  component: SchedulerPage,
});

function SchedulerPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const schedulerQuery = useQuery({
    queryKey: ["scheduled-actions", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scheduled_actions")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(150);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!user) return;
    const invalidate = () => {
      void queryClient.invalidateQueries({
        queryKey: ["scheduled-actions", user.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ["schedule-occurrences", user.id],
      });
    };
    const channel = supabase
      .channel("scheduled-actions-" + user.id)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scheduled_actions",
          filter: "user_id=eq." + user.id,
        },
        invalidate,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "linkr_schedule_occurrences",
          filter: "user_id=eq." + user.id,
        },
        invalidate,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, user]);

  const rows = useMemo(() => schedulerQuery.data ?? [], [schedulerQuery.data]);
  const scheduleIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const occurrenceQuery = useQuery({
    queryKey: ["schedule-occurrences", user?.id, scheduleIds.join(",")],
    enabled: Boolean(user?.id && scheduleIds.length > 0),
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as UntypedSupabaseClient)
        .from("linkr_schedule_occurrences")
        .select(
          "id,schedule_id,occurrence_key,due_at,started_at,completed_at,status,attempt_count,transaction_id,transaction_hash,transaction_signature,observed_value_usd,error",
        )
        .eq("user_id", user!.id)
        .in("schedule_id", scheduleIds)
        .order("due_at", { ascending: false })
        .limit(600);
      if (error) throw error;
      return (data ?? []) as ScheduleOccurrence[];
    },
  });
  const occurrencesBySchedule = useMemo(
    () => groupOccurrencesBySchedule(occurrenceQuery.data ?? []),
    [occurrenceQuery.data],
  );
  const timed = useMemo(() => rows.filter((row) => row.trigger_type === "time"), [rows]);
  const market = useMemo(() => rows.filter((row) => row.trigger_type === "market_cap"), [rows]);
  const stats = useMemo(
    () => ({
      pending: rows.filter((row) => row.status === "pending" || row.status === "processing").length,
      timed: timed.length,
      market: market.length,
      executed: rows.filter((row) => row.status === "executed").length,
    }),
    [market.length, rows, timed.length],
  );

  const controlMutation = useMutation({
    mutationFn: invokeSchedulerControl,
    onSuccess: async (data, variables) => {
      toast.success(scheduleControlSuccess(variables.action));
      if (user?.id) {
        if (data.scheduled_action) {
          queryClient.setQueryData<ScheduledAction[]>(
            ["scheduled-actions", user.id],
            (current) =>
              current?.map((row) =>
                row.id === data.scheduled_action?.id
                  ? ({ ...row, ...data.scheduled_action } as ScheduledAction)
                  : row,
              ) ?? current,
          );
        }
        await queryClient.invalidateQueries({
          queryKey: ["scheduled-actions", user.id],
        });
        await queryClient.invalidateQueries({
          queryKey: ["schedule-occurrences", user.id],
        });
      }
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Schedule update failed");
    },
  });

  return (
    <div className="app-dashboard-page app-scheduler-page">
      <header className="app-live-hero app-dashboard-hero app-scheduler-hero">
        <div>
          <p className="app-live-kicker">Scheduler</p>
          <h1>Timed and market-cap actions.</h1>
          <p>
            Track the wallet, launch, rewards, and liquidity actions you asked Linkr to run later.
            Timed actions and market-cap triggers stay separated so it is clear what is waiting and
            what ran.
          </p>
        </div>
        <div className="app-live-signal" aria-label="Scheduler worker status">
          <span />
          watching
        </div>
      </header>

      <section className="app-dashboard-launch-stats" aria-label="Scheduler stats">
        <DashboardStatCard label="Active" value={String(stats.pending)} />
        <DashboardStatCard label="Timed" value={String(stats.timed)} />
        <DashboardStatCard label="Market cap" value={String(stats.market)} />
        <DashboardStatCard label="Executed" value={String(stats.executed)} />
      </section>

      <SchedulerCreateForm
        onCreated={() =>
          user?.id &&
          queryClient.invalidateQueries({
            queryKey: ["scheduled-actions", user.id],
          })
        }
      />

      <SchedulerSection
        title="Timed actions"
        description="Wallet, launch, rewards, and liquidity actions waiting for a scheduled time."
        empty="No timed actions scheduled."
        loading={schedulerQuery.isLoading}
        busyId={controlMutation.isPending ? (controlMutation.variables?.id ?? null) : null}
        onControl={(id, action) => controlMutation.mutate({ id, action })}
        occurrencesBySchedule={occurrencesBySchedule}
        rows={timed}
      />

      <SchedulerSection
        title="Market-cap triggers"
        description="Buy and sell orders that run when public market data crosses the trigger."
        empty="No market-cap triggers scheduled."
        loading={schedulerQuery.isLoading}
        busyId={controlMutation.isPending ? (controlMutation.variables?.id ?? null) : null}
        onControl={(id, action) => controlMutation.mutate({ id, action })}
        occurrencesBySchedule={occurrencesBySchedule}
        rows={market}
      />
    </div>
  );
}

function SchedulerCreateForm({ onCreated }: { onCreated: () => void }) {
  const [chain, setChain] = useState<SchedulerChain>("robinhood");
  const [actionType, setActionType] = useState<SchedulerActionType>("buy");
  const [triggerType, setTriggerType] = useState<SchedulerTriggerType>("time");
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>("one_time");
  const [firstRunMode, setFirstRunMode] = useState<FirstRunMode>("after_interval");
  const [tokenAddress, setTokenAddress] = useState("");
  const [recipient, setRecipient] = useState("");
  const [buyAmount, setBuyAmount] = useState("");
  const [buyUnit, setBuyUnit] = useState<BuyUnit>("eth");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferUnit, setTransferUnit] = useState<TransferUnit>("eth");
  const [sellMode, setSellMode] = useState<SellMode>("all");
  const [sellPercent, setSellPercent] = useState("50");
  const [launchName, setLaunchName] = useState("");
  const [launchSymbol, setLaunchSymbol] = useState("");
  const [launchDescription, setLaunchDescription] = useState("");
  const [launchImageUrl, setLaunchImageUrl] = useState("");
  const [launchInitialBuy, setLaunchInitialBuy] = useState("0");
  const [launchWebsiteUrl, setLaunchWebsiteUrl] = useState("");
  const [launchTwitterUrl, setLaunchTwitterUrl] = useState("");
  const [launchTelegramUrl, setLaunchTelegramUrl] = useState("");
  const [creatorRewardsLatest, setCreatorRewardsLatest] = useState(true);
  const [creatorRewardsLaunchId, setCreatorRewardsLaunchId] = useState("");
  const [creatorRewardsSymbol, setCreatorRewardsSymbol] = useState("");
  const [liquidityNativeAmount, setLiquidityNativeAmount] = useState("");
  const [liquidityTokenAmount, setLiquidityTokenAmount] = useState("");
  const [liquidityPositionId, setLiquidityPositionId] = useState("");
  const [liquidityPercent, setLiquidityPercent] = useState("100");
  const [scheduledFor, setScheduledFor] = useState(() => toDateTimeLocal(Date.now() + 60 * 60_000));
  const [intervalSeconds, setIntervalSeconds] = useState("3600");
  const [triggerDirection, setTriggerDirection] = useState<TriggerDirection>("below");
  const [marketCap, setMarketCap] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [debouncedTokenAddress, setDebouncedTokenAddress] = useState("");

  useEffect(() => {
    if (chain === "solana" && buyUnit === "eth") setBuyUnit("sol");
    if (chain === "robinhood" && buyUnit === "sol") setBuyUnit("eth");
    if (chain === "solana" && transferUnit === "eth") setTransferUnit("sol");
    if (chain === "robinhood" && transferUnit === "sol") setTransferUnit("eth");
  }, [buyUnit, chain, transferUnit]);

  useEffect(() => {
    if (!marketTriggerAction(actionType) && triggerType === "market_cap") {
      setTriggerType("time");
    }
  }, [actionType, triggerType]);

  useEffect(() => {
    if (triggerType === "market_cap") setScheduleKind("one_time");
  }, [triggerType]);

  useEffect(() => {
    if (actionType === "collect_liquidity_fees" && chain === "solana") {
      setChain("robinhood");
    }
  }, [actionType, chain]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedTokenAddress(tokenAddress.trim());
    }, 650);
    return () => window.clearTimeout(timer);
  }, [tokenAddress]);

  const nativeUnit = chain === "solana" ? "sol" : "eth";
  const buyUnitOptions = [nativeUnit, "usd"] as BuyUnit[];
  const transferUnitOptions = [nativeUnit, "usd"] as TransferUnit[];
  const minScheduledFor = useMemo(() => toDateTimeLocal(Date.now() + 60_000), []);
  const typedTokenAddress = tokenAddress.trim();
  const typedTokenChain = detectSchedulerTokenChain(typedTokenAddress);
  const debouncedTokenChain = detectSchedulerTokenChain(debouncedTokenAddress);
  const tokenLookupReady =
    actionUsesTokenLookup(actionType) &&
    debouncedTokenAddress.trim().length > 0 &&
    debouncedTokenChain === chain;

  const tokenLookupQuery = useQuery({
    queryKey: ["scheduler-token-preview", chain, debouncedTokenAddress],
    enabled: tokenLookupReady,
    staleTime: 30_000,
    retry: false,
    queryFn: () => fetchSchedulerTokenFacts(debouncedTokenAddress),
  });

  const tokenLookupStatus =
    !actionUsesTokenLookup(actionType) || typedTokenAddress.length === 0
      ? null
      : typedTokenAddress.length > 0 && !typedTokenChain
        ? chain === "solana"
          ? "Enter a full Solana mint for the selected network."
          : "Enter a full Robinhood EVM contract for the selected network."
        : typedTokenChain && typedTokenChain !== chain
          ? typedTokenChain === "solana"
            ? "That looks like a Solana mint. Switch the scheduler network to Solana to load it."
            : "That looks like a Robinhood EVM contract. Switch the scheduler network to Robinhood Chain to load it."
          : null;

  const createMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        chain,
        action_type: actionType,
        trigger_type: triggerType,
        client_request_id: browserRequestId(),
      };

      if (actionType === "buy") {
        body.token_address = tokenAddress.trim();
        body.amount = buyAmount.trim();
        body.amount_unit = buyUnit;
      } else if (actionType === "sell") {
        body.token_address = tokenAddress.trim();
        body.sell_mode = sellMode;
        if (sellMode === "percent") body.sell_percent = sellPercent.trim();
      } else if (actionType === "transfer") {
        body.recipient = recipient.trim();
        body.amount = transferAmount.trim();
        body.amount_unit = transferUnit;
      } else if (actionType === "launch_coin") {
        body.name = launchName.trim();
        body.symbol = launchSymbol.trim();
        body.description = launchDescription.trim();
        body.image_url = launchImageUrl.trim();
        body.amount = launchInitialBuy.trim() || "0";
        if (chain === "solana") body.initial_buy_sol = launchInitialBuy.trim() || "0";
        else body.initial_buy_eth = launchInitialBuy.trim() || "0";
        if (launchWebsiteUrl.trim()) body.website_url = launchWebsiteUrl.trim();
        if (launchTwitterUrl.trim()) body.twitter_url = launchTwitterUrl.trim();
        if (launchTelegramUrl.trim()) body.telegram_url = launchTelegramUrl.trim();
      } else if (actionType === "claim_creator_rewards") {
        body.latest = creatorRewardsLatest;
        if (creatorRewardsLaunchId.trim()) body.launch_id = creatorRewardsLaunchId.trim();
        if (tokenAddress.trim()) body.token_address = tokenAddress.trim();
        if (creatorRewardsSymbol.trim()) body.symbol = creatorRewardsSymbol.trim();
      } else if (actionType === "add_liquidity") {
        body.token_address = tokenAddress.trim();
        if (chain === "solana") {
          body.token_amount = liquidityTokenAmount.trim();
          body.amount = liquidityTokenAmount.trim();
        } else {
          body.amount_eth = liquidityNativeAmount.trim();
          body.amount = liquidityNativeAmount.trim();
          if (liquidityTokenAmount.trim()) body.token_amount = liquidityTokenAmount.trim();
        }
      } else {
        if (tokenAddress.trim()) body.token_address = tokenAddress.trim();
        if (liquidityPositionId.trim()) body.position_id = liquidityPositionId.trim();
        if (actionType === "remove_liquidity") {
          body.percent = liquidityPercent.trim();
        }
      }

      if (triggerType === "time") {
        body.schedule_kind = scheduleKind;
        if (scheduleKind === "interval") {
          body.interval_seconds = intervalSeconds.trim();
          if (firstRunMode === "soon") {
            body.scheduled_for = new Date(Date.now() + 60_000).toISOString();
          } else if (firstRunMode === "at_time") {
            body.scheduled_for = new Date(scheduledFor).toISOString();
          }
        } else {
          body.scheduled_for = new Date(scheduledFor).toISOString();
        }
      } else {
        body.schedule_kind = scheduleKind;
        body.trigger_direction = triggerDirection;
        body.trigger_value_usd = marketCap.trim();
        if (scheduleKind !== "one_time") {
          body.starts_at = new Date(scheduledFor).toISOString();
        }
        if (scheduleKind === "interval") {
          body.interval_seconds = intervalSeconds.trim();
        }
      }

      const { data, error } = await supabase.functions.invoke<CreateScheduledActionResponse>(
        "create-scheduled-action",
        { body },
      );
      if (error) {
        throw new Error(await readFunctionErrorMessage(error, "Schedule creation failed"));
      }
      if (data?.error) throw new Error(data.message ?? data.error);
      if (!data?.scheduled_action) throw new Error("Schedule creation failed");
      return data.scheduled_action;
    },
    onSuccess: () => {
      toast.success("Scheduled action created");
      setFormError(null);
      setTokenAddress("");
      setRecipient("");
      setBuyAmount("");
      setTransferAmount("");
      setMarketCap("");
      setLaunchName("");
      setLaunchSymbol("");
      setLaunchDescription("");
      setLaunchImageUrl("");
      setLaunchInitialBuy("0");
      setLaunchWebsiteUrl("");
      setLaunchTwitterUrl("");
      setLaunchTelegramUrl("");
      setCreatorRewardsLatest(true);
      setCreatorRewardsLaunchId("");
      setCreatorRewardsSymbol("");
      setLiquidityNativeAmount("");
      setLiquidityTokenAmount("");
      setLiquidityPositionId("");
      setLiquidityPercent("100");
      setScheduleKind("one_time");
      setFirstRunMode("after_interval");
      setScheduledFor(toDateTimeLocal(Date.now() + 60 * 60_000));
      onCreated();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Schedule creation failed";
      setFormError(message);
      toast.error(message);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (tokenLookupStatus) {
      setFormError(tokenLookupStatus);
      toast.error(tokenLookupStatus);
      return;
    }
    if (!marketTriggerAction(actionType) && triggerType === "market_cap") {
      const message = "Market-cap triggers currently support buy and sell actions.";
      setFormError(message);
      toast.error(message);
      return;
    }
    createMutation.mutate();
  }

  const submitDisabled =
    createMutation.isPending ||
    (requiresTokenAddress(actionType, {
      creatorRewardsLatest,
      creatorRewardsLaunchId,
      creatorRewardsSymbol,
      liquidityPositionId,
    }) &&
      tokenAddress.trim().length === 0) ||
    (actionType === "transfer" && recipient.trim().length === 0) ||
    Boolean(tokenLookupStatus) ||
    (actionType === "buy" && buyAmount.trim().length === 0) ||
    (actionType === "transfer" && transferAmount.trim().length === 0) ||
    (actionType === "sell" && sellMode === "percent" && sellPercent.trim().length === 0) ||
    (actionType === "launch_coin" &&
      (launchName.trim().length === 0 ||
        launchSymbol.trim().length === 0 ||
        launchDescription.trim().length === 0 ||
        launchImageUrl.trim().length === 0)) ||
    (actionType === "claim_creator_rewards" &&
      !creatorRewardsLatest &&
      creatorRewardsLaunchId.trim().length === 0 &&
      creatorRewardsSymbol.trim().length === 0 &&
      tokenAddress.trim().length === 0) ||
    (actionType === "add_liquidity" &&
      (chain === "solana"
        ? liquidityTokenAmount.trim().length === 0
        : liquidityNativeAmount.trim().length === 0)) ||
    (actionType === "remove_liquidity" && liquidityPercent.trim().length === 0) ||
    (triggerType === "time" && scheduleKind !== "interval" && scheduledFor.trim().length === 0) ||
    (triggerType === "time" &&
      scheduleKind === "interval" &&
      firstRunMode === "at_time" &&
      scheduledFor.trim().length === 0) ||
    (triggerType === "time" &&
      scheduleKind === "interval" &&
      intervalSeconds.trim().length === 0) ||
    (triggerType === "market_cap" &&
      scheduleKind !== "one_time" &&
      scheduleKind === "interval" &&
      intervalSeconds.trim().length === 0) ||
    (triggerType === "market_cap" && marketCap.trim().length === 0);

  return (
    <section
      className="sm-card app-dashboard-card app-scheduler-composer"
      aria-labelledby="create-scheduled-action"
    >
      <div className="app-dashboard-card-head app-dashboard-section-head">
        <div>
          <h2 id="create-scheduled-action">Schedule from dashboard</h2>
          <p className="app-dashboard-section-copy">
            Create timed wallet, launch, rewards, and liquidity actions. Market-cap triggers are
            available for buy and sell schedules.
          </p>
        </div>
      </div>

      <form className="app-scheduler-form" onSubmit={submit}>
        <div className="app-scheduler-flow">
          <SchedulerStep index={1} title="Action">
            <div className="app-scheduler-choice-grid">
              <SegmentedControl<SchedulerChain>
                label="Network"
                value={chain}
                options={[
                  { value: "robinhood", label: "EVM" },
                  { value: "solana", label: "Solana" },
                ]}
                onChange={setChain}
              />
              <Field label="Action" htmlFor="scheduler-action-type">
                <SchedulerSelect<SchedulerActionType>
                  id="scheduler-action-type"
                  value={actionType}
                  options={ACTION_OPTIONS}
                  onChange={setActionType}
                  triggerClassName="app-scheduler-action-select"
                />
              </Field>
              <SegmentedControl<SchedulerTriggerType>
                label="Trigger"
                value={triggerType}
                options={[
                  { value: "time", label: "Time" },
                  ...(!marketTriggerAction(actionType)
                    ? []
                    : [{ value: "market_cap" as const, label: "Market cap" }]),
                ]}
                onChange={setTriggerType}
              />
            </div>
          </SchedulerStep>

          <SchedulerStep index={2} title="Details">
            <div className="app-scheduler-form-grid app-scheduler-detail-grid">
              {actionType === "launch_coin" ? (
                <>
                  <Field label="Token name" htmlFor="launch-name">
                    <input
                      id="launch-name"
                      className="app-scheduler-input"
                      value={launchName}
                      onChange={(event) => setLaunchName(event.target.value)}
                      placeholder="Testing"
                    />
                  </Field>
                  <Field label="Ticker" htmlFor="launch-symbol">
                    <input
                      id="launch-symbol"
                      className="app-scheduler-input"
                      value={launchSymbol}
                      onChange={(event) => setLaunchSymbol(event.target.value)}
                      placeholder="TEST"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Image URL" htmlFor="launch-image">
                    <input
                      id="launch-image"
                      className="app-scheduler-input"
                      value={launchImageUrl}
                      onChange={(event) => setLaunchImageUrl(event.target.value)}
                      placeholder="https://..."
                      inputMode="url"
                    />
                  </Field>
                  <Field label="Description" htmlFor="launch-description">
                    <input
                      id="launch-description"
                      className="app-scheduler-input"
                      value={launchDescription}
                      onChange={(event) => setLaunchDescription(event.target.value)}
                      placeholder="What the token is about"
                    />
                  </Field>
                  <Field label={`Initial buy (${nativeUnit.toUpperCase()})`} htmlFor="launch-buy">
                    <input
                      id="launch-buy"
                      className="app-scheduler-input"
                      value={launchInitialBuy}
                      onChange={(event) => setLaunchInitialBuy(event.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label="Website URL" htmlFor="launch-website">
                    <input
                      id="launch-website"
                      className="app-scheduler-input"
                      value={launchWebsiteUrl}
                      onChange={(event) => setLaunchWebsiteUrl(event.target.value)}
                      placeholder="https://linkr.cash/..."
                      inputMode="url"
                    />
                  </Field>
                  <Field label="X URL" htmlFor="launch-twitter">
                    <input
                      id="launch-twitter"
                      className="app-scheduler-input"
                      value={launchTwitterUrl}
                      onChange={(event) => setLaunchTwitterUrl(event.target.value)}
                      placeholder="https://x.com/..."
                      inputMode="url"
                    />
                  </Field>
                  <Field label="Telegram URL" htmlFor="launch-telegram">
                    <input
                      id="launch-telegram"
                      className="app-scheduler-input"
                      value={launchTelegramUrl}
                      onChange={(event) => setLaunchTelegramUrl(event.target.value)}
                      placeholder="https://t.me/..."
                      inputMode="url"
                    />
                  </Field>
                </>
              ) : actionType === "transfer" ? (
                <Field
                  label={chain === "solana" ? "Solana recipient" : "EVM recipient"}
                  htmlFor="recipient"
                >
                  <input
                    id="recipient"
                    className="app-scheduler-input sm-mono"
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                    placeholder={
                      chain === "solana"
                        ? "So11111111111111111111111111111111111111112"
                        : "0x0000000000000000000000000000000000000000"
                    }
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
              ) : actionType === "claim_creator_rewards" ? (
                <>
                  <label className="app-scheduler-field app-scheduler-check-field">
                    <span>Latest launch</span>
                    <input
                      type="checkbox"
                      checked={creatorRewardsLatest}
                      onChange={(event) => setCreatorRewardsLatest(event.target.checked)}
                    />
                  </label>
                  <Field label="Launch ID" htmlFor="creator-rewards-launch">
                    <input
                      id="creator-rewards-launch"
                      className="app-scheduler-input sm-mono"
                      value={creatorRewardsLaunchId}
                      onChange={(event) => setCreatorRewardsLaunchId(event.target.value)}
                      placeholder="optional"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label={chain === "solana" ? "Mint" : "Token contract"} htmlFor="token">
                    <input
                      id="token"
                      className="app-scheduler-input sm-mono"
                      value={tokenAddress}
                      onChange={(event) => setTokenAddress(event.target.value)}
                      placeholder="optional"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label="Symbol" htmlFor="creator-rewards-symbol">
                    <input
                      id="creator-rewards-symbol"
                      className="app-scheduler-input"
                      value={creatorRewardsSymbol}
                      onChange={(event) => setCreatorRewardsSymbol(event.target.value)}
                      placeholder="optional"
                    />
                  </Field>
                </>
              ) : isLiquidityAction(actionType) ? (
                <>
                  <Field label={chain === "solana" ? "Mint" : "Token contract"} htmlFor="token">
                    <input
                      id="token"
                      className="app-scheduler-input sm-mono"
                      value={tokenAddress}
                      onChange={(event) => setTokenAddress(event.target.value)}
                      placeholder={
                        chain === "solana"
                          ? "So11111111111111111111111111111111111111112"
                          : "0x0000000000000000000000000000000000000000"
                      }
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  {actionType === "add_liquidity" ? (
                    <>
                      {chain === "robinhood" && (
                        <Field label="ETH amount" htmlFor="liquidity-native-amount">
                          <input
                            id="liquidity-native-amount"
                            className="app-scheduler-input"
                            value={liquidityNativeAmount}
                            onChange={(event) => setLiquidityNativeAmount(event.target.value)}
                            placeholder="0.01"
                            inputMode="decimal"
                          />
                        </Field>
                      )}
                      <Field
                        label={chain === "solana" ? "Token amount" : "Token amount optional"}
                        htmlFor="liquidity-token-amount"
                      >
                        <input
                          id="liquidity-token-amount"
                          className="app-scheduler-input"
                          value={liquidityTokenAmount}
                          onChange={(event) => setLiquidityTokenAmount(event.target.value)}
                          placeholder={chain === "solana" ? "1000" : "auto"}
                          inputMode="decimal"
                        />
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field label="Position ID" htmlFor="liquidity-position">
                        <input
                          id="liquidity-position"
                          className="app-scheduler-input sm-mono"
                          value={liquidityPositionId}
                          onChange={(event) => setLiquidityPositionId(event.target.value)}
                          placeholder="optional if token is provided"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </Field>
                      {actionType === "remove_liquidity" && (
                        <Field label="Percent" htmlFor="liquidity-percent">
                          <input
                            id="liquidity-percent"
                            className="app-scheduler-input"
                            value={liquidityPercent}
                            onChange={(event) => setLiquidityPercent(event.target.value)}
                            placeholder="100"
                            inputMode="decimal"
                          />
                        </Field>
                      )}
                    </>
                  )}
                </>
              ) : (
                <Field label={chain === "solana" ? "Solana mint" : "EVM contract"} htmlFor="token">
                  <input
                    id="token"
                    className="app-scheduler-input sm-mono"
                    value={tokenAddress}
                    onChange={(event) => setTokenAddress(event.target.value)}
                    placeholder={
                      chain === "solana"
                        ? "So11111111111111111111111111111111111111112"
                        : "0x0000000000000000000000000000000000000000"
                    }
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
              )}

              {actionType === "buy" ? (
                <div className="app-scheduler-amount-pair">
                  <Field label="Buy amount" htmlFor="buy-amount">
                    <input
                      id="buy-amount"
                      className="app-scheduler-input"
                      value={buyAmount}
                      onChange={(event) => setBuyAmount(event.target.value)}
                      placeholder={chain === "solana" ? "0.1" : "0.01"}
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label="Unit" htmlFor="buy-unit">
                    <SchedulerSelect<BuyUnit>
                      id="buy-unit"
                      value={buyUnit}
                      options={buyUnitOptions.map((unit) => ({
                        value: unit,
                        label: unit.toUpperCase(),
                      }))}
                      onChange={setBuyUnit}
                    />
                  </Field>
                </div>
              ) : actionType === "sell" ? (
                <div className="app-scheduler-sell-box">
                  <SegmentedControl<SellMode>
                    label="Sell amount"
                    value={sellMode}
                    options={[
                      { value: "all", label: "100%" },
                      { value: "percent", label: "Custom %" },
                    ]}
                    onChange={setSellMode}
                  />
                  {sellMode === "percent" && (
                    <Field label="Percent" htmlFor="sell-percent">
                      <input
                        id="sell-percent"
                        className="app-scheduler-input"
                        value={sellPercent}
                        onChange={(event) => setSellPercent(event.target.value)}
                        placeholder="50"
                        inputMode="decimal"
                      />
                    </Field>
                  )}
                </div>
              ) : actionType === "transfer" ? (
                <div className="app-scheduler-amount-pair">
                  <Field label="Transfer amount" htmlFor="transfer-amount">
                    <input
                      id="transfer-amount"
                      className="app-scheduler-input"
                      value={transferAmount}
                      onChange={(event) => setTransferAmount(event.target.value)}
                      placeholder={chain === "solana" ? "0.1" : "0.01"}
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label="Unit" htmlFor="transfer-unit">
                    <SchedulerSelect<TransferUnit>
                      id="transfer-unit"
                      value={transferUnit}
                      options={transferUnitOptions.map((unit) => ({
                        value: unit,
                        label: unit.toUpperCase(),
                      }))}
                      onChange={setTransferUnit}
                    />
                  </Field>
                </div>
              ) : null}
            </div>

            {actionUsesTokenLookup(actionType) && tokenAddress.trim().length > 0 && (
              <SchedulerTokenPreview
                chain={chain}
                error={tokenLookupQuery.error}
                facts={tokenLookupQuery.data ?? null}
                loading={tokenLookupQuery.isFetching}
                status={tokenLookupStatus}
                tokenAddress={tokenAddress}
              />
            )}
          </SchedulerStep>

          <SchedulerStep index={3} title={triggerType === "time" ? "Schedule" : "Market rule"}>
            <div className="app-scheduler-form-grid app-scheduler-timing-grid">
              {triggerType === "time" ? (
                <>
                  <Field label="Repeat" htmlFor="schedule-kind">
                    <SchedulerSelect<ScheduleKind>
                      id="schedule-kind"
                      value={scheduleKind}
                      options={SCHEDULE_KIND_OPTIONS}
                      onChange={setScheduleKind}
                    />
                  </Field>
                  {scheduleKind === "interval" ? (
                    <SegmentedControl<FirstRunMode>
                      label="First run"
                      value={firstRunMode}
                      options={[
                        { value: "after_interval", label: "After interval" },
                        { value: "soon", label: "Soon" },
                        { value: "at_time", label: "At time" },
                      ]}
                      onChange={setFirstRunMode}
                    />
                  ) : (
                    <Field label="Run at" htmlFor="scheduled-for">
                      <input
                        id="scheduled-for"
                        className="app-scheduler-input"
                        type="datetime-local"
                        min={minScheduledFor}
                        value={scheduledFor}
                        onChange={(event) => setScheduledFor(event.target.value)}
                      />
                    </Field>
                  )}
                  {scheduleKind === "interval" && firstRunMode === "at_time" && (
                    <Field label="First run at" htmlFor="scheduled-for">
                      <input
                        id="scheduled-for"
                        className="app-scheduler-input"
                        type="datetime-local"
                        min={minScheduledFor}
                        value={scheduledFor}
                        onChange={(event) => setScheduledFor(event.target.value)}
                      />
                    </Field>
                  )}
                  {scheduleKind === "interval" && (
                    <Field label="Every seconds" htmlFor="interval-seconds">
                      <input
                        id="interval-seconds"
                        className="app-scheduler-input"
                        value={intervalSeconds}
                        onChange={(event) => setIntervalSeconds(event.target.value)}
                        placeholder="3600"
                        inputMode="numeric"
                      />
                    </Field>
                  )}
                </>
              ) : (
                <>
                  <SegmentedControl<TriggerDirection>
                    label="Condition"
                    value={triggerDirection}
                    options={[
                      { value: "below", label: "Below" },
                      { value: "above", label: "Above" },
                    ]}
                    onChange={setTriggerDirection}
                  />
                  <Field label="Market cap" htmlFor="market-cap">
                    <input
                      id="market-cap"
                      className="app-scheduler-input"
                      value={marketCap}
                      onChange={(event) => setMarketCap(event.target.value)}
                      placeholder="50000"
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label="Repeat" htmlFor="market-schedule-kind">
                    <SchedulerSelect<ScheduleKind>
                      id="market-schedule-kind"
                      value={scheduleKind}
                      options={SCHEDULE_KIND_OPTIONS}
                      onChange={setScheduleKind}
                    />
                  </Field>
                  {scheduleKind !== "one_time" && (
                    <Field label="First check" htmlFor="market-starts-at">
                      <input
                        id="market-starts-at"
                        className="app-scheduler-input"
                        type="datetime-local"
                        min={minScheduledFor}
                        value={scheduledFor}
                        onChange={(event) => setScheduledFor(event.target.value)}
                      />
                    </Field>
                  )}
                  {scheduleKind === "interval" && (
                    <Field label="Repeat seconds" htmlFor="market-interval-seconds">
                      <input
                        id="market-interval-seconds"
                        className="app-scheduler-input"
                        value={intervalSeconds}
                        onChange={(event) => setIntervalSeconds(event.target.value)}
                        placeholder="3600"
                        inputMode="numeric"
                      />
                    </Field>
                  )}
                </>
              )}
            </div>
          </SchedulerStep>
        </div>

        <div className="app-scheduler-form-foot">
          {formError && <div className="app-scheduler-form-error">{formError}</div>}
          <Button type="submit" className="app-scheduler-submit gap-2" disabled={submitDisabled}>
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Schedule
          </Button>
        </div>
      </form>
    </section>
  );
}

function SchedulerTokenPreview({
  chain,
  error,
  facts,
  loading,
  status,
  tokenAddress,
}: {
  chain: SchedulerChain;
  error: unknown;
  facts: SchedulerTokenFacts | null;
  loading: boolean;
  status: string | null;
  tokenAddress: string;
}) {
  const trimmed = tokenAddress.trim();
  if (!trimmed) return null;

  const detectedChain = facts ? schedulerChainFromMarketLabel(facts.chain) : null;
  const chainMismatch = detectedChain && detectedChain !== chain;
  const marketCap = facts?.market_cap_usd ?? facts?.fdv_usd ?? null;
  const marketCapLabel = facts?.market_cap_usd != null ? "Market cap" : "FDV";
  const name =
    facts?.name ||
    facts?.symbol ||
    shortAddress(facts?.token_address ?? facts?.mint ?? trimmed, 6, 6);
  const symbol = facts?.symbol ? `$${facts.symbol}` : "TOKEN";

  if (status) {
    return (
      <div className="app-scheduler-token-preview app-scheduler-token-preview-muted">
        <AlertCircle aria-hidden="true" />
        <span>{status}</span>
      </div>
    );
  }

  if (loading && !facts) {
    return (
      <div className="app-scheduler-token-preview app-scheduler-token-preview-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>Looking up token details...</span>
      </div>
    );
  }

  if (error && !facts) {
    return (
      <div className="app-scheduler-token-preview app-scheduler-token-preview-muted">
        <AlertCircle aria-hidden="true" />
        <span>No live token details found yet. You can still schedule with the full address.</span>
      </div>
    );
  }

  if (!facts) return null;

  return (
    <div
      className="app-scheduler-token-preview"
      data-chain-mismatch={chainMismatch ? "true" : undefined}
    >
      <div className="app-scheduler-token-preview-main">
        <span className="app-scheduler-token-icon" aria-hidden="true">
          {symbol.replace("$", "").slice(0, 2).toUpperCase() || "TK"}
        </span>
        <div>
          <strong>{name}</strong>
          <span>
            {symbol} · {facts.chain ?? "Token"} ·{" "}
            {shortAddress(facts.token_address ?? facts.mint ?? trimmed, 5, 5)}
          </span>
        </div>
      </div>
      <div className="app-scheduler-token-preview-stats">
        <TokenPreviewStat label={marketCapLabel} value={formatCompactUsdValue(marketCap)} />
        <TokenPreviewStat label="Price" value={formatTokenPrice(facts.price_usd)} />
        <TokenPreviewStat label="Liquidity" value={formatCompactUsdValue(facts.liquidity_usd)} />
      </div>
      <div className="app-scheduler-token-preview-foot">
        <span>
          <CheckCircle2 aria-hidden="true" />
          {facts.freshness ?? "live"} market data
        </span>
        {chainMismatch && (
          <span className="app-scheduler-token-warning">
            Switch network to {detectedChain === "solana" ? "Solana" : "Robinhood Chain"} before
            scheduling.
          </span>
        )}
        {facts.explorer_url && (
          <a href={facts.explorer_url} target="_blank" rel="noreferrer">
            Explorer
          </a>
        )}
      </div>
    </div>
  );
}

function TokenPreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function SchedulerSection({
  busyId,
  title,
  description,
  empty,
  loading,
  onControl,
  occurrencesBySchedule,
  rows,
}: {
  busyId: string | null;
  title: string;
  description: string;
  empty: string;
  loading: boolean;
  onControl: (id: string, action: ScheduleControlAction) => void;
  occurrencesBySchedule: Map<string, ScheduleOccurrence[]>;
  rows: ScheduledAction[];
}) {
  return (
    <section
      className="sm-card app-dashboard-card app-history-console"
      aria-labelledby={slug(title)}
    >
      <div className="app-dashboard-card-head app-dashboard-section-head">
        <div>
          <h2 id={slug(title)}>{title}</h2>
          <p className="app-dashboard-section-copy">{description}</p>
        </div>
      </div>
      {loading && <div className="app-empty-state">Loading scheduled actions...</div>}
      {!loading && rows.length === 0 && <div className="app-empty-state">{empty}</div>}
      {rows.length > 0 && (
        <div className="app-history-feed" role="list" aria-label={title}>
          {rows.map((row) => (
            <SchedulerRow
              key={row.id}
              busy={busyId === row.id}
              occurrences={occurrencesBySchedule.get(row.id) ?? []}
              onControl={onControl}
              row={row}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SchedulerRow({
  busy,
  occurrences,
  onControl,
  row,
}: {
  busy: boolean;
  occurrences: ScheduleOccurrence[];
  onControl: (id: string, action: ScheduleControlAction) => void;
  row: ScheduledAction;
}) {
  const chain = row.chain === "solana" ? "solana" : "robinhood";
  const target = scheduleTarget(row);
  const latestOccurrence = occurrences[0] ?? null;
  const displayStatus = scheduleDisplayStatus(row, latestOccurrence);
  const runSummary = scheduleRunSummary(row, latestOccurrence);
  const transactionHash = latestTransactionHash(row, latestOccurrence);
  const txUrl = transactionExplorerUrl(chain, transactionHash);
  const shouldShowRecurrence = !scheduleCannotRun(row) && isRecurringRow(row);
  const canPause = row.status === "pending" || row.status === "processing";
  const canResume = row.status === "paused";
  const canCancel = ["pending", "processing", "paused"].includes(row.status);
  return (
    <article className="app-history-card app-scheduler-card" role="listitem">
      <div className="app-history-summary">
        <strong>{actionTitle(row)}</strong>
        <p>{triggerText(row)}</p>
        {runSummary && <p className="app-scheduler-run-summary">{runSummary}</p>}
      </div>
      <footer className="app-history-footer" aria-label="Scheduled action details">
        <div className="app-history-meta">
          <ChainPill className="app-history-chain-pill" chain={chain} />
          <span className={displayStatus.className}>{displayStatus.label}</span>
          <code>{shortAddress(target)}</code>
          <span>{amountText(row)}</span>
          {latestOccurrence && (
            <span>
              occurrence {latestOccurrence.status}
              {latestOccurrence.completed_at ? ` ${timeAgo(latestOccurrence.completed_at)}` : ""}
            </span>
          )}
          {row.last_observed_value_usd != null && (
            <span>last {formatUsd(row.last_observed_value_usd)}</span>
          )}
          {row.last_checked_at && <span>checked {timeAgo(row.last_checked_at)}</span>}
          {row.error && <span className="app-history-error">{row.error}</span>}
          {shouldShowRecurrence && row.schedule_kind && row.schedule_kind !== "one_time" && (
            <span>{recurrenceText(row)}</span>
          )}
        </div>
        <div className="app-history-actions">
          {transactionHash && txUrl ? (
            <a href={txUrl} target="_blank" rel="noreferrer">
              TX {shortAddress(transactionHash)}
            </a>
          ) : transactionHash ? (
            <span className="app-status">TX {shortAddress(transactionHash)}</span>
          ) : null}
          {occurrences.length > 0 && (
            <details className="app-scheduler-occurrences">
              <summary>Runs</summary>
              <div className="app-scheduler-occurrence-list">
                {occurrences.slice(0, 5).map((occurrence) => (
                  <ScheduleOccurrenceRow
                    chain={chain}
                    key={occurrence.id}
                    occurrence={occurrence}
                  />
                ))}
              </div>
            </details>
          )}
          {row.source_tweet_url && (
            <a href={row.source_tweet_url} target="_blank" rel="noreferrer">
              Source
            </a>
          )}
          {canPause && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onControl(row.id, "pause")}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
              Pause
            </Button>
          )}
          {canResume && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onControl(row.id, "resume")}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Resume
            </Button>
          )}
          {canCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onControl(row.id, "cancel")}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              Cancel
            </Button>
          )}
        </div>
      </footer>
    </article>
  );
}

function ScheduleOccurrenceRow({
  chain,
  occurrence,
}: {
  chain: SchedulerChain;
  occurrence: ScheduleOccurrence;
}) {
  const txHash = occurrence.transaction_signature ?? occurrence.transaction_hash;
  const txUrl = transactionExplorerUrl(chain, txHash);
  return (
    <div className="app-scheduler-occurrence-row">
      <span className={statusClass(occurrence.status)}>{occurrence.status}</span>
      <span>due {timeAgo(occurrence.due_at)}</span>
      {occurrence.completed_at && <span>done {timeAgo(occurrence.completed_at)}</span>}
      {occurrence.attempt_count != null && <span>attempts {occurrence.attempt_count}</span>}
      {occurrence.error && <span className="app-history-error">{occurrence.error}</span>}
      {txHash && txUrl ? (
        <a href={txUrl} target="_blank" rel="noreferrer">
          TX {shortAddress(txHash)}
        </a>
      ) : txHash ? (
        <span>TX {shortAddress(txHash)}</span>
      ) : null}
    </div>
  );
}

function SchedulerStep({
  children,
  index,
  title,
}: {
  children: ReactNode;
  index: number;
  title: string;
}) {
  const id = `scheduler-step-${index}`;
  return (
    <section className="app-scheduler-step" aria-labelledby={id}>
      <div className="app-scheduler-step-head">
        <span className="app-scheduler-step-number" aria-hidden="true">
          {index}
        </span>
        <h3 id={id}>{title}</h3>
      </div>
      <div className="app-scheduler-step-content">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label className="app-scheduler-field" htmlFor={htmlFor}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function SchedulerSelect<T extends string>({
  id,
  value,
  options,
  onChange,
  triggerClassName,
}: {
  id: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  triggerClassName?: string;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label;

  return (
    <Select value={value} onValueChange={(nextValue) => onChange(nextValue as T)}>
      <SelectTrigger
        id={id}
        type="button"
        data-active="true"
        data-selected="true"
        className={["app-scheduler-input app-scheduler-select-trigger", triggerClassName]
          .filter(Boolean)
          .join(" ")}
      >
        <SelectValue placeholder={selectedLabel ?? "Select"} />
      </SelectTrigger>
      <SelectContent className="app-scheduler-select-content" align="start">
        {options.map((option) => (
          <SelectItem className="app-scheduler-select-item" value={option.value} key={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="app-scheduler-segment-group">
      <span>{label}</span>
      <div className="app-scheduler-segment" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            className={value === option.value ? "is-active" : undefined}
            aria-pressed={value === option.value}
            data-active={value === option.value ? "true" : undefined}
            data-selected={value === option.value ? "true" : undefined}
            data-state={value === option.value ? "active" : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function actionTitle(row: ScheduledAction): string {
  const action = actionLabel(row.action_type);
  const chain = row.chain === "solana" ? "Solana" : "Robinhood Chain";
  return `${action} on ${chain}`;
}

function groupOccurrencesBySchedule(
  occurrences: ScheduleOccurrence[],
): Map<string, ScheduleOccurrence[]> {
  const grouped = new Map<string, ScheduleOccurrence[]>();
  for (const occurrence of occurrences) {
    const list = grouped.get(occurrence.schedule_id) ?? [];
    list.push(occurrence);
    grouped.set(occurrence.schedule_id, list);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) => new Date(right.due_at).getTime() - new Date(left.due_at).getTime());
  }
  return grouped;
}

function isRecurringRow(row: ScheduledAction): boolean {
  return ["interval", "daily", "weekly"].includes(String(row.schedule_kind ?? ""));
}

function scheduleCannotRun(row: ScheduledAction): boolean {
  return ["cancelled", "executed", "failed", "expired"].includes(String(row.status ?? ""));
}

function scheduleDisplayStatus(
  row: ScheduledAction,
  latestOccurrence: ScheduleOccurrence | null,
): { className: string; label: string } {
  if (row.status === "cancelled") {
    return { className: statusClass("cancelled"), label: "Cancelled" };
  }
  if (row.status === "paused") {
    return { className: statusClass("paused"), label: "Paused" };
  }
  if (row.status === "executed") {
    return { className: statusClass("executed"), label: "Executed" };
  }
  if (row.status === "failed") {
    return { className: statusClass("failed"), label: "Failed" };
  }
  if (row.status === "expired") {
    return { className: statusClass("expired"), label: "Expired" };
  }
  if (row.status === "processing") {
    return { className: statusClass("processing"), label: "Running" };
  }
  if (row.status === "pending" && isRecurringRow(row)) {
    if (latestOccurrence?.status === "retrying") {
      return { className: statusClass("processing"), label: "Retrying" };
    }
    if (latestOccurrence?.status === "failed") {
      return { className: statusClass("failed"), label: "Needs attention" };
    }
    if (
      latestOccurrence?.status === "succeeded" ||
      Number(row.successful_occurrence_count ?? 0) > 0
    ) {
      return { className: statusClass("succeeded"), label: "Active" };
    }
    if (Number(row.failed_occurrence_count ?? 0) > 0) {
      return { className: statusClass("failed"), label: "Needs attention" };
    }
    return { className: statusClass("pending"), label: "Waiting first run" };
  }
  return { className: statusClass(row.status), label: row.status };
}

function scheduleRunSummary(
  row: ScheduledAction,
  latestOccurrence: ScheduleOccurrence | null,
): string | null {
  const latestStatus = latestOccurrence?.status;
  const latestCompletedAt = latestOccurrence?.completed_at ?? row.last_execution_at;
  if (row.status === "cancelled") {
    const cancelled = row.cancelled_at ? `Cancelled ${timeAgo(row.cancelled_at)}.` : "Cancelled.";
    return `${cancelled} No future runs will execute.`;
  }
  if (row.status === "paused") return "Paused. It will not run until resumed.";
  if (row.status === "expired") return "Expired before execution.";
  if (latestStatus === "succeeded" || Number(row.successful_occurrence_count ?? 0) > 0) {
    const last = latestCompletedAt ? `Last run succeeded ${timeAgo(latestCompletedAt)}.` : "";
    const next =
      row.scheduled_for && row.status === "pending"
        ? ` Next run ${futureTime(row.scheduled_for)}.`
        : "";
    return `${last}${next}`.trim() || null;
  }
  if (latestStatus === "retrying") {
    const next = row.scheduled_for ?? row.next_check_at;
    return next
      ? `Last run is retrying. Next attempt ${futureTime(next)}.`
      : "Last run is retrying.";
  }
  if (latestStatus === "failed" || row.status === "failed") {
    return row.error ? `Last run failed: ${row.error}` : "Last run failed.";
  }
  if (row.status === "processing") return "Executing this scheduled action now.";
  if (isRecurringRow(row) && row.status === "pending") {
    return row.scheduled_for
      ? `First run ${futureTime(row.scheduled_for)}.`
      : "Waiting for first run.";
  }
  return null;
}

function triggerText(row: ScheduledAction): string {
  if (row.status === "cancelled") {
    return row.cancelled_at ? `Cancelled ${timeAgo(row.cancelled_at)}` : "Cancelled";
  }
  if (row.status === "paused") return "Paused";
  if (row.status === "executed") {
    const completedAt = row.executed_at ?? row.processed_at ?? row.last_execution_at;
    return completedAt ? `Executed ${timeAgo(completedAt)}` : "Executed";
  }
  if (row.status === "failed") {
    return row.failed_at ? `Failed ${timeAgo(row.failed_at)}` : "Failed";
  }
  if (row.status === "expired") return "Expired";
  if (row.trigger_type === "time") {
    if (isRecurringRow(row)) {
      const prefix = Number(row.occurrence_count ?? 0) > 0 ? "Next run" : "First run";
      return row.scheduled_for ? `${prefix} ${futureTime(row.scheduled_for)}` : `${prefix} soon`;
    }
    return row.scheduled_for
      ? `Runs ${futureTime(row.scheduled_for)}`
      : "Runs at the scheduled time";
  }
  const direction = row.trigger_direction === "below" ? "below" : "above";
  const threshold =
    row.trigger_value_usd == null ? "the trigger" : formatUsd(row.trigger_value_usd);
  const next = row.next_check_at ? ` Next check ${futureTime(row.next_check_at)}.` : "";
  return `Runs when market cap is ${direction} ${threshold}.${next}`;
}

function latestTransactionHash(
  row: ScheduledAction,
  latestOccurrence: ScheduleOccurrence | null,
): string | null {
  return (
    latestOccurrence?.transaction_signature ??
    latestOccurrence?.transaction_hash ??
    row.transaction_signature ??
    row.transaction_hash ??
    null
  );
}

function transactionExplorerUrl(
  chain: SchedulerChain,
  txHash: string | null | undefined,
): string | null {
  const hash = String(txHash ?? "").trim();
  if (!hash) return null;
  return chain === "solana"
    ? `https://solscan.io/tx/${encodeURIComponent(hash)}`
    : `https://robinhoodchain.blockscout.com/tx/${encodeURIComponent(hash)}`;
}

function amountText(row: ScheduledAction): string {
  const payload = (row.action_payload ?? {}) as Record<string, unknown>;
  if (row.action_type === "launch_coin") {
    const amount = row.chain === "solana" ? row.amount_sol : row.amount_eth;
    if (amount != null) {
      return `dev buy ${formatEth(amount, 6)} ${row.chain === "solana" ? "SOL" : "ETH"}`;
    }
    return String(payload.symbol ?? row.token_symbol ?? "launch");
  }
  if (row.action_type === "claim_creator_rewards") {
    if (payload.latest === true) return "latest launch";
    return String(payload.symbol ?? row.token_symbol ?? "claim");
  }
  if (row.action_type === "add_liquidity") {
    if (row.amount_sol != null) return `${formatEth(row.amount_sol, 6)} SOL LP`;
    if (row.amount_eth != null) return `${formatEth(row.amount_eth, 6)} ETH LP`;
    return "add liquidity";
  }
  if (row.action_type === "remove_liquidity") {
    return row.amount_pct != null ? `${formatEth(row.amount_pct, 2)}% LP` : "remove liquidity";
  }
  if (row.action_type === "collect_liquidity_fees") {
    return "collect fees";
  }
  if (row.action_type === "sell") {
    if (row.amount_all) return "100%";
    return row.amount_pct != null ? `${formatEth(row.amount_pct, 2)}%` : "sell";
  }
  if (row.amount_original != null && row.amount_original_unit) {
    const unit = row.amount_original_unit.toUpperCase();
    if (unit === "USD") return formatUsd(row.amount_original);
    return `${formatEth(row.amount_original, 6)} ${unit}`;
  }
  if (row.amount_eth != null) return `${formatEth(row.amount_eth)} ETH`;
  if (row.amount_sol != null) return `${formatEth(row.amount_sol)} SOL`;
  if (row.amount_usd != null) return formatUsd(row.amount_usd);
  return row.action_type;
}

function actionLabel(actionType: string | null | undefined): string {
  switch (actionType) {
    case "buy":
      return "Buy";
    case "sell":
      return "Sell";
    case "transfer":
      return "Transfer";
    case "launch_coin":
      return "Launch";
    case "claim_creator_rewards":
      return "Creator rewards claim";
    case "add_liquidity":
      return "Add liquidity";
    case "remove_liquidity":
      return "Remove liquidity";
    case "collect_liquidity_fees":
      return "Collect liquidity fees";
    default:
      return "Action";
  }
}

function scheduleTarget(row: ScheduledAction): string | null {
  const payload = (row.action_payload ?? {}) as Record<string, unknown>;
  if (row.action_type === "transfer") return row.recipient;
  if (row.action_type === "launch_coin") {
    return String(payload.symbol ?? payload.name ?? row.token_symbol ?? "").trim() || null;
  }
  if (row.action_type === "claim_creator_rewards") {
    const fallback = String(
      payload.launch_id ?? payload.symbol ?? (payload.latest === true ? "latest" : ""),
    ).trim();
    return row.token_address ?? (fallback || null);
  }
  if (isLiquidityAction(row.action_type as SchedulerActionType)) {
    const fallback = String(payload.position_id ?? payload.position_token_id ?? "").trim();
    return row.token_address ?? (fallback || null);
  }
  return row.token_address;
}

function marketTriggerAction(actionType: SchedulerActionType): boolean {
  return actionType === "buy" || actionType === "sell";
}

function isLiquidityAction(actionType: SchedulerActionType): boolean {
  return (
    actionType === "add_liquidity" ||
    actionType === "remove_liquidity" ||
    actionType === "collect_liquidity_fees"
  );
}

function actionUsesTokenLookup(actionType: SchedulerActionType): boolean {
  return (
    actionType === "buy" ||
    actionType === "sell" ||
    actionType === "claim_creator_rewards" ||
    isLiquidityAction(actionType)
  );
}

function requiresTokenAddress(
  actionType: SchedulerActionType,
  values: {
    creatorRewardsLatest: boolean;
    creatorRewardsLaunchId: string;
    creatorRewardsSymbol: string;
    liquidityPositionId: string;
  },
): boolean {
  if (actionType === "buy" || actionType === "sell" || actionType === "add_liquidity") {
    return true;
  }
  if (actionType === "claim_creator_rewards") {
    return (
      !values.creatorRewardsLatest &&
      values.creatorRewardsLaunchId.trim().length === 0 &&
      values.creatorRewardsSymbol.trim().length === 0
    );
  }
  if (actionType === "remove_liquidity" || actionType === "collect_liquidity_fees") {
    return values.liquidityPositionId.trim().length === 0;
  }
  return false;
}

function recurrenceText(row: ScheduledAction): string {
  const count = Number(row.occurrence_count ?? 0);
  const max = row.max_occurrences ? `/${row.max_occurrences}` : "";
  const prefix =
    row.schedule_kind === "daily"
      ? "Daily"
      : row.schedule_kind === "weekly"
        ? "Weekly"
        : row.interval_seconds
          ? `Every ${formatInterval(row.interval_seconds)}`
          : "Recurring";
  return `${prefix} - runs ${count}${max}`;
}

function formatInterval(seconds: number): string {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "interval";
  if (value % 86_400 === 0) return `${value / 86_400}d`;
  if (value % 3_600 === 0) return `${value / 3_600}h`;
  if (value % 60 === 0) return `${value / 60}m`;
  return `${value}s`;
}

function futureTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "soon";
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "from now" : "ago";
  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return diff >= 0 ? "now" : "just now";
  if (minutes < 60) {
    return diff >= 0 ? `in ${minutes}m` : `${minutes}m ${suffix}`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) return diff >= 0 ? `in ${hours}h` : `${hours}h ${suffix}`;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function timeAgo(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "recently";
  const minutes = Math.round(Math.max(0, Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return date.toLocaleDateString();
}

function statusClass(status: string): string {
  const base = "app-status";
  if (status === "executed" || status === "succeeded" || status === "confirmed") {
    return `${base} app-status-success`;
  }
  if (status === "failed" || status === "expired" || status === "cancelled") {
    return `${base} app-status-danger`;
  }
  if (status === "retrying" || status === "paused") return `${base} app-status-pending`;
  return base;
}

function scheduleControlSuccess(action: ScheduleControlAction): string {
  if (action === "pause") return "Schedule paused";
  if (action === "resume") return "Schedule resumed";
  return "Schedule cancelled";
}

async function invokeSchedulerControl(input: {
  action: ScheduleControlAction;
  id: string;
}): Promise<CreateScheduledActionResponse> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!baseUrl) throw new Error("Supabase URL is not configured.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in before updating schedules.");
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/functions/v1/create-scheduled-action`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: input.action,
        id: input.id,
        reason: input.action === "cancel" ? "dashboard_cancelled" : undefined,
      }),
    },
  );
  const json = (await response.json().catch(() => ({}))) as CreateScheduledActionResponse;
  if (!response.ok || json.error) {
    throw new Error(json.message ?? json.error ?? "Schedule update failed");
  }
  return json;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function toDateTimeLocal(timestamp: number): string {
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function browserRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `browser-${Date.now()}`;
}

async function readFunctionErrorMessage(error: unknown, fallback: string) {
  const maybeError = error as {
    context?: { json?: () => Promise<unknown> };
    message?: string;
  };
  const body = await maybeError.context?.json?.().catch(() => null);
  if (body && typeof body === "object") {
    const payload = body as { error?: unknown; message?: unknown };
    if (payload.message) return String(payload.message);
    if (payload.error) return String(payload.error);
  }
  return maybeError.message ?? fallback;
}

async function fetchSchedulerTokenFacts(tokenAddress: string): Promise<SchedulerTokenFacts> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!baseUrl) throw new Error("Supabase URL is not configured.");
  const url = new URL(`${baseUrl}/functions/v1/market-data/token`);
  url.searchParams.set("mint", tokenAddress);
  const response = await fetch(url.toString());
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      json && typeof json === "object" && "error" in json
        ? String((json as { error: unknown }).error)
        : "Token lookup failed",
    );
  }
  return json as SchedulerTokenFacts;
}

function detectSchedulerTokenChain(value: string): SchedulerChain | null {
  const trimmed = value.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return "robinhood";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) return "solana";
  return null;
}

function schedulerChainFromMarketLabel(value: string | null | undefined): SchedulerChain | null {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("solana")) return "solana";
  if (normalized.includes("robinhood")) return "robinhood";
  return null;
}

function formatCompactUsdValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return `$${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: Number(value) >= 10_000 ? 1 : 2,
    notation: Number(value) >= 10_000 ? "compact" : "standard",
  }).format(Number(value))}`;
}

function formatTokenPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  const number = Number(value);
  if (number > 0 && number < 0.01) return `$${number.toPrecision(3)}`;
  return formatUsd(number);
}
