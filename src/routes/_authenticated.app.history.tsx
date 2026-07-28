import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ChainPill } from "@/components/linkr/ChainPill";
import { DashboardStatCard } from "@/components/linkr/DashboardStatCard";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { chainPresentationForRecord, type ChainTone } from "@/lib/linkr/chain-presentation";
import { relativeTime, shortAddress, formatEth, formatUsd } from "@/lib/linkr/format";
import type { Tables } from "@/integrations/supabase/types";

type Tx = Tables<"transactions">;
type Run = Tables<"agent_runs">;
type Pending = Tables<"pending_actions">;
type Launch = Tables<"coin_launches">;
type Tweet = Pick<
  Tables<"tweets_inbox">,
  "tweet_id" | "text" | "tweet_url" | "author_username" | "created_at"
>;
type Reply = Pick<
  Tables<"twitter_replies">,
  | "id"
  | "tweet_id"
  | "reply_text"
  | "reply_tweet_id"
  | "status"
  | "error"
  | "created_at"
  | "posted_at"
>;

type ActivityConversation = {
  userLabel: string;
  userText: string | null;
  responseText: string | null;
  responseStatus: string | null;
  responseError: string | null;
  tweetUrl: string | null;
  replyUrl: string | null;
};

type ActivityItem = {
  id: string;
  kind:
    | "buy"
    | "sell"
    | "burn"
    | "transfer"
    | "inquiry"
    | "launch"
    | "pending"
    | "agent"
    | "action";
  title: string;
  detail: string;
  status: string | null;
  createdAt: string;
  amount?: string;
  chainLabel?: string;
  chainTone?: ChainTone;
  reference?: string | null;
  conversation?: ActivityConversation;
  raw?: unknown;
};

export const Route = createFileRoute("/_authenticated/app/history")({
  head: () => ({ meta: [{ title: "Activity - Linkr" }] }),
  component: ActivityPage,
});

function ActivityPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const activityQuery = useQuery({
    queryKey: ["activity-feed", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [tx, runs, pending, launches] = await Promise.all([
        supabase
          .from("transactions")
          .select("*")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false })
          .limit(80),
        supabase
          .from("agent_runs")
          .select("*")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false })
          .limit(80),
        supabase
          .from("pending_actions")
          .select("*")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false })
          .limit(40),
        supabase
          .from("coin_launches")
          .select("*")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false })
          .limit(40),
      ]);

      for (const result of [tx, runs, pending, launches]) {
        if (result.error) throw result.error;
      }

      const txData = tx.data ?? [];
      const runData = runs.data ?? [];
      const pendingData = pending.data ?? [];
      const launchData = launches.data ?? [];
      const tweetIds = uniqueStrings([
        ...txData.map((row) => row.tweet_id),
        ...runData.map((row) => row.tweet_id),
        ...pendingData.map((row) => row.tweet_id),
        ...launchData.map((row) => row.tweet_id),
      ]);

      let tweetData: Tweet[] = [];
      let replyData: Reply[] = [];
      if (tweetIds.length > 0) {
        const [tweets, replies] = await Promise.all([
          supabase
            .from("tweets_inbox")
            .select("tweet_id,text,tweet_url,author_username,created_at")
            .in("tweet_id", tweetIds),
          supabase
            .from("twitter_replies")
            .select("id,tweet_id,reply_text,reply_tweet_id,status,error,created_at,posted_at")
            .in("tweet_id", tweetIds)
            .order("created_at", { ascending: false }),
        ]);

        for (const result of [tweets, replies]) {
          if (result.error) throw result.error;
        }

        tweetData = (tweets.data ?? []) as Tweet[];
        replyData = (replies.data ?? []) as Reply[];
      }

      return {
        tx: txData,
        runs: runData,
        pending: pendingData,
        launches: launchData,
        tweets: tweetData,
        replies: replyData,
      };
    },
  });

  useEffect(() => {
    if (!user) return;
    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: ["activity-feed", user.id] });
    const channel = supabase
      .channel("activity-feed-" + user.id)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transactions", filter: "user_id=eq." + user.id },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_runs", filter: "user_id=eq." + user.id },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pending_actions", filter: "user_id=eq." + user.id },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "coin_launches", filter: "user_id=eq." + user.id },
        invalidate,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, user]);

  const data = activityQuery.data;
  const items = useMemo(() => buildActivity(data), [data]);
  const stats = useMemo(() => {
    const buys = items.filter((i) => i.kind === "buy").length;
    const sells = items.filter((i) => i.kind === "sell").length;
    const transfers = items.filter((i) => i.kind === "transfer").length;
    const responses = items.filter(
      (i) => i.conversation?.responseText || i.kind === "inquiry" || i.kind === "agent",
    ).length;
    return { buys, sells, transfers, responses };
  }, [items]);

  return (
    <div className="app-dashboard-page app-history-page">
      <header className="app-live-hero app-activity-hero">
        <div>
          <p className="app-live-kicker">History</p>
          <h1>Everything Linkr handled for you.</h1>
          <p>
            Your posts, Linkr's replies, buys, sells, token burns, sends, launches, and
            confirmations all land in one clean record.
          </p>
        </div>
        <div className="app-live-signal" aria-label="Live status">
          <span />
          listening
        </div>
      </header>

      <section className="app-dashboard-launch-stats" aria-label="Activity stats">
        <DashboardStatCard label="Buys" value={String(stats.buys)} />
        <DashboardStatCard label="Sells" value={String(stats.sells)} />
        <DashboardStatCard label="Transfers" value={String(stats.transfers)} />
        <DashboardStatCard label="Responses" value={String(stats.responses)} />
      </section>

      <section
        className="sm-card app-dashboard-card app-history-console"
        aria-labelledby="history-feed-title"
      >
        <div className="app-dashboard-card-head app-dashboard-section-head">
          <div>
            <h2 id="history-feed-title">Conversation history</h2>
            <p className="app-dashboard-section-copy">
              Your post and Linkr's response are separated clearly in each record.
            </p>
          </div>
        </div>

        {activityQuery.isLoading && <div className="app-empty-state">Loading history...</div>}
        {!activityQuery.isLoading && items.length === 0 && (
          <div className="app-empty-state">
            No activity yet. Once Linkr sees your posts or runs actions, the post and response
            history appears here.
          </div>
        )}
        {items.length > 0 && (
          <div className="app-history-feed" role="list" aria-label="Post and response history">
            {items.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function buildActivity(data?: {
  tx: Tx[];
  runs: Run[];
  pending: Pending[];
  launches: Launch[];
  tweets: Tweet[];
  replies: Reply[];
}): ActivityItem[] {
  if (!data) return [];

  const tweetsById = new Map(data.tweets.map((tweet) => [tweet.tweet_id, tweet]));
  const repliesByTweetId = buildReplyMap(data.replies);
  const conversationForTweet = (tweetId: string | null, fallbackUserText?: string | null) => {
    if (!tweetId && !fallbackUserText) return undefined;
    const tweet = tweetId ? tweetsById.get(tweetId) : undefined;
    const reply = tweetId ? repliesByTweetId.get(tweetId) : undefined;
    const userText = tweet?.text ?? fallbackUserText ?? null;
    const responseText = reply?.reply_text ?? null;
    if (!userText && !responseText) return undefined;

    return {
      userLabel: tweet?.author_username
        ? "Your post (@" + tweet.author_username + ")"
        : "Your post",
      userText,
      responseText,
      responseStatus: reply?.status ?? null,
      responseError: reply?.error ?? null,
      tweetUrl: tweet?.tweet_url ?? null,
      replyUrl: reply?.reply_tweet_id ? xStatusUrl(reply.reply_tweet_id) : null,
    };
  };

  const txItems = data.tx.map((tx): ActivityItem => {
    const kind = normalizeAction(tx.action);
    const conversation = conversationForTweet(tx.tweet_id);
    const chain = chainPresentationForRecord(tx);
    return {
      id: "tx-" + tx.id,
      kind,
      title: titleForKind(kind, tx.action),
      detail: tx.error || summarizeText(conversation?.userText) || detailForTx(tx),
      status: tx.status,
      createdAt: tx.created_at,
      amount: amountForTx(tx),
      chainLabel: chain.label,
      chainTone: chain.chain,
      reference: tx.tx_hash || tx.tx_signature || tx.tweet_id,
      conversation,
      raw: tx,
    };
  });

  const runItems = data.runs.map((run): ActivityItem => {
    const intent = run.intent ?? "agent";
    const kind = intent.includes("inquiry") || intent.includes("question") ? "inquiry" : "agent";
    const fallbackUserText = textFromRun(run);
    const conversation = conversationForTweet(run.tweet_id, fallbackUserText);
    const detail =
      run.error ||
      summarizeText(conversation?.userText) ||
      summarizeText(conversation?.responseText) ||
      humanizeIntent(intent);
    return {
      id: "run-" + run.id,
      kind,
      title: "Linkr responded",
      detail,
      status: run.status,
      createdAt: run.created_at,
      reference: run.tweet_id,
      conversation,
      raw: run,
    };
  });

  const pendingItems = data.pending.map((pending): ActivityItem => {
    const conversation = conversationForTweet(pending.tweet_id);
    const chain = pendingChainMeta(pending);
    return {
      id: "pending-" + pending.id,
      kind: "pending",
      title: "Confirmation pending",
      detail: summarizeText(conversation?.userText) || humanizeIntent(pending.intent),
      status: pending.status,
      createdAt: pending.created_at,
      chainLabel: chain?.label,
      chainTone: chain?.chain,
      reference: pending.tweet_id,
      conversation,
      raw: pending,
    };
  });

  const launchItems = data.launches.map((launch): ActivityItem => {
    const conversation = conversationForTweet(launch.tweet_id);
    const chain = chainPresentationForRecord(launch);
    return {
      id: "launch-" + launch.id,
      kind: "launch",
      title: chain.chain === "solana" ? "Pump.fun launch" : "Robinhood launch",
      detail: summarizeText(conversation?.userText) || "$" + launch.symbol + " - " + launch.name,
      status: launch.status,
      createdAt: launch.created_at,
      amount:
        launch.dev_buy_usd != null
          ? formatUsd(launch.dev_buy_usd)
          : launch.chain === "solana" || launch.launch_platform === "pump_fun"
            ? Number(launch.dev_buy_sol ?? 0).toFixed(3) + " SOL"
            : formatEth(launch.dev_buy_eth, 3) + " ETH",
      chainLabel: chain.label,
      chainTone: chain.chain,
      reference: launch.mint || launch.tx_signature || launch.tweet_id,
      conversation,
      raw: launch,
    };
  });

  return [...txItems, ...runItems, ...pendingItems, ...launchItems].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function normalizeAction(action: string | null): ActivityItem["kind"] {
  const value = (action ?? "").toLowerCase();
  if (value.includes("buy")) return "buy";
  if (value.includes("sell")) return "sell";
  if (value.includes("burn")) return "burn";
  if (value.includes("transfer") || value.includes("send")) return "transfer";
  if (value.includes("launch")) return "launch";
  if (value.includes("inquiry") || value.includes("balance") || value.includes("explain"))
    return "inquiry";
  return "action";
}

function titleForKind(kind: ActivityItem["kind"], fallback: string | null) {
  const titles: Record<ActivityItem["kind"], string> = {
    buy: "Buy executed",
    sell: "Sell executed",
    burn: "Token burn confirmed",
    transfer: "Transfer handled",
    inquiry: "Linkr responded",
    launch: "Launch handled",
    pending: "Confirmation pending",
    agent: "Linkr responded",
    action: "Action handled",
  };
  return titles[kind] || fallback || "Action handled";
}

function detailForTx(tx: Tx) {
  if (tx.output_mint) return "Output " + shortAddress(tx.output_mint, 6, 6);
  if (tx.input_mint) return "Input " + shortAddress(tx.input_mint, 6, 6);
  return tx.tweet_id ? "Tweet " + shortAddress(tx.tweet_id, 6, 4) : "Wallet action";
}

function amountForTx(tx: Tx) {
  if (tx.amount_usd != null) return formatUsd(tx.amount_usd);
  if (tx.amount_eth != null) return formatEth(tx.amount_eth, 4) + " ETH";
  if (tx.amount_sol != null) return formatEth(tx.amount_sol, 4) + " SOL";
  if (tx.action === "burn" && tx.amount_original != null) {
    return String(tx.amount_original) + " tokens";
  }
  if (tx.amount_original != null && tx.amount_original_unit) {
    return formatEth(tx.amount_original, 4) + " " + tx.amount_original_unit;
  }
  return undefined;
}

function pendingChainMeta(pending: Pending) {
  const payload = pending.action_payload;
  if (!isRecord(payload)) return null;
  const chain = firstString(payload.chain, payload.launch_chain, payload.target_chain);
  const launchPlatform = firstString(payload.launch_platform, payload.launchPlatform);
  const nativeSymbol = firstString(payload.native_symbol, payload.nativeSymbol);
  if (!chain && !launchPlatform && !nativeSymbol) return null;
  return chainPresentationForRecord({
    chain,
    launch_platform: launchPlatform,
    native_symbol: nativeSymbol,
  });
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => !!value)));
}

function buildReplyMap(replies: Reply[]) {
  const map = new Map<string, Reply>();
  for (const reply of replies) {
    if (!reply.tweet_id) continue;
    const current = map.get(reply.tweet_id);
    if (!current || isPreferredReply(reply, current)) {
      map.set(reply.tweet_id, reply);
    }
  }
  return map;
}

function isPreferredReply(candidate: Reply, current: Reply) {
  const rankDelta = replyStatusRank(candidate.status) - replyStatusRank(current.status);
  if (rankDelta !== 0) return rankDelta > 0;
  return new Date(candidate.created_at).getTime() > new Date(current.created_at).getTime();
}

function replyStatusRank(status: string | null) {
  const value = (status ?? "").toLowerCase();
  if (value === "posted" || value === "completed" || value === "success") return 4;
  if (value === "pending") return 3;
  if (value === "failed") return 1;
  return 2;
}

function summarizeText(text: string | null | undefined, max = 130) {
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max - 1).trimEnd() + "...";
}

function humanizeIntent(intent: string | null | undefined) {
  const value = (intent ?? "agent").replace(/[_-]+/g, " ").trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Agent run";
}

function xStatusUrl(tweetId: string) {
  return "https://x.com/i/web/status/" + encodeURIComponent(tweetId);
}

function textFromRun(run: Run) {
  return firstString(
    stringAt(run.thread_context, ["tweet", "text"]),
    stringAt(run.thread_context, ["bot_mention_tweet", "text"]),
    stringAt(run.thread_context, ["text"]),
    stringAt(run.classification, ["tweet_text"]),
    stringAt(run.extraction, ["tweet_text"]),
  );
}

function firstString(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function stringAt(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === "string" ? current : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const conversation = item.conversation;
  const displayStatus = conversation?.responseStatus ?? item.status;
  const responseFallback =
    item.status === "failed"
      ? item.detail
      : "Response is still being prepared or has not been posted yet.";

  return (
    <article className={"app-history-card app-history-" + item.kind} role="listitem">
      {conversation ? (
        <div className="app-history-dialogue">
          <MessageBlock
            label={conversation.userLabel}
            text={conversation.userText}
            fallback="Original post unavailable."
            tone="user"
          />
          <MessageBlock
            label="Linkr response"
            text={conversation.responseText}
            fallback={responseFallback}
            tone="bot"
          />
        </div>
      ) : (
        <div className="app-history-summary">
          <strong>{item.title}</strong>
          <p>{item.detail}</p>
        </div>
      )}

      <footer className="app-history-footer" aria-label="Record details">
        <div className="app-history-meta">
          <span>{displayKindLabel(item)}</span>
          <span>{relativeTime(item.createdAt)}</span>
          {item.chainLabel && (
            <ChainPill
              chain={item.chainTone}
              className="app-history-chain-pill"
              iconOnly
              label={item.chainLabel}
            />
          )}
          {item.amount && <span>{item.amount}</span>}
          {item.reference && <code>{shortAddress(item.reference, 6, 6)}</code>}
        </div>
        <div className="app-history-actions">
          {conversation?.responseError && (
            <span className="app-history-error">{conversation.responseError}</span>
          )}
          {displayStatus && <Status status={displayStatus} />}
          {conversation?.tweetUrl && (
            <a href={conversation.tweetUrl} target="_blank" rel="noreferrer">
              View post
            </a>
          )}
          {conversation?.replyUrl && (
            <a href={conversation.replyUrl} target="_blank" rel="noreferrer">
              View reply
            </a>
          )}
        </div>
      </footer>
    </article>
  );
}

function displayKind(item: ActivityItem) {
  if (item.kind === "inquiry" || item.kind === "agent") return "reply";
  if (item.kind === "action" && item.conversation) return "reply";
  return item.kind;
}

function displayKindLabel(item: ActivityItem) {
  const label = displayKind(item);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function MessageBlock({
  label,
  text,
  fallback,
  tone,
}: {
  label: string;
  text: string | null;
  fallback: string;
  tone: "user" | "bot";
}) {
  return (
    <div className={"app-history-message app-history-message-" + tone}>
      <span>{label}</span>
      <p>{text || fallback}</p>
    </div>
  );
}

function Status({ status }: { status: string | null }) {
  return (
    <span className={"app-status app-status-" + (status ?? "unknown")}>{status ?? "unknown"}</span>
  );
}
