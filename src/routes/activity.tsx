import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  MessageCircle,
  Rocket,
  Send,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { ChainPill } from "@/components/linkr/ChainPill";
import { MarketingHeader } from "@/components/linkr/MarketingHeader";
import { ProfileHandleLink, ProfileLinkedText } from "@/components/linkr/ProfileHandleLink";
import {
  PublicChainFilter,
  type PublicChainFilterValue,
} from "@/components/linkr/PublicChainFilter";
import { supabase } from "@/integrations/supabase/client";
import { chainPresentationForRecordIfKnown } from "@/lib/linkr/chain-presentation";
import { relativeTime, shortAddress, formatEth, formatUsd } from "@/lib/linkr/format";

type PublicActivity = {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  status: string | null;
  created_at: string;
  amount_eth: number | null;
  amount_sol: number | null;
  amount_usd: number | null;
  chain: string | null;
  native_symbol: string | null;
  launch_platform?: string | null;
  reference: string | null;
  tx_hash: string | null;
  tweet_id?: string | null;
  user_post_text?: string | null;
  user_post_url?: string | null;
  user_post_author?: string | null;
  user_post_name?: string | null;
  user_post_avatar_url?: string | null;
  linkr_response_text?: string | null;
  linkr_response_tweet_id?: string | null;
  linkr_response_status?: string | null;
};
type PublicActivityProfile = {
  handle_key: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
};
type ChainFilter = PublicChainFilterValue;

const LINKR_PROFILE_IMAGE_SRC = "/linkr-logo.png";

const DEMO_ACTIVITY: PublicActivity[] = [
  {
    id: "demo-activity-reply-token",
    kind: "reply",
    title: "Linkr answered",
    detail: "how's this token looking 0x8A1d...0123",
    status: "completed",
    created_at: "2026-07-02T18:52:00.000Z",
    amount_eth: null,
    amount_sol: null,
    amount_usd: null,
    chain: "robinhood",
    native_symbol: "ETH",
    reference: "demo-tweet-token-read",
    tx_hash: null,
    tweet_id: "demo-tweet-token-read",
    user_post_author: "replypilot",
    user_post_text:
      "@linkrbot how's this token looking 0x8A1d4b4C7f8e0a7d9C1b2E3F4a5B6c7D8e9F0123",
    linkr_response_text:
      "$DEMO on Robinhood Chain: price holding near support, liquidity is thin but active, 24h volume is picking up. Clean read: watch liquidity before sizing. DYOR.",
    linkr_response_status: "posted",
  },
  {
    id: "demo-activity-launch-pixel",
    kind: "launch",
    title: "Launched $PIXEL",
    detail: "Pixel Reply minted from an X command",
    status: "confirmed",
    created_at: "2026-07-02T18:44:00.000Z",
    amount_eth: 1.25,
    amount_sol: null,
    amount_usd: 184.5,
    chain: "robinhood",
    native_symbol: "ETH",
    reference: "0x8A1d4b4C7f8e0a7d9C1b2E3F4a5B6c7D8e9F0123",
    tx_hash: "0x9a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef",
  },
  {
    id: "demo-activity-buy-bonk",
    kind: "buy",
    title: "Bought $BONK",
    detail: "Solana swap executed from a reply command",
    status: "completed",
    created_at: "2026-07-02T18:36:00.000Z",
    amount_eth: null,
    amount_sol: 0.42,
    amount_usd: 61.99,
    chain: "solana",
    native_symbol: "SOL",
    reference: "So11111111111111111111111111111111111111112",
    tx_hash: "5Rnyo1Vg2t7uS4qQw9pYxK7bL8aH6mN4cD3eF2gT1rQ8",
  },
  {
    id: "demo-activity-transfer-rush",
    kind: "transfer",
    title: "Transferred ETH",
    detail: "Reply command sent funds to a saved address",
    status: "confirmed",
    created_at: "2026-07-02T18:21:00.000Z",
    amount_eth: 0.18,
    amount_sol: null,
    amount_usd: 26.57,
    chain: "robinhood",
    native_symbol: "ETH",
    reference: "0x91C4E5d6A7B8c9D0E1f234567890abCDef123456",
    tx_hash: "0x7c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef012",
  },
  {
    id: "demo-activity-sell-lime",
    kind: "sell",
    title: "Sold $LIME",
    detail: "Position trimmed from the activity stream",
    status: "completed",
    created_at: "2026-07-02T18:08:00.000Z",
    amount_eth: 0.67,
    amount_sol: null,
    amount_usd: 98.91,
    chain: "robinhood",
    native_symbol: "ETH",
    reference: "0xaB12cD34Ef56a7890bC1234567890dEFa1234567",
    tx_hash: "0x6d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0123",
  },
  {
    id: "demo-activity-transfer-sol",
    kind: "transfer",
    title: "Transferred SOL",
    detail: "Native SOL sent from the user's primary Solana wallet",
    status: "confirmed",
    created_at: "2026-07-02T18:02:00.000Z",
    amount_eth: null,
    amount_sol: 0.08,
    amount_usd: 11.82,
    chain: "solana",
    native_symbol: "SOL",
    reference: "7sKf3r8PzL9yQw2nT6vB4mH1cX5dE9aR2pJ8uV6kS3n",
    tx_hash: "4o7bLq9vE2sX5hP8mN1cD6rT3wY9aK4jF2uG8pS7nM5",
  },
  {
    id: "demo-activity-launch-rush",
    kind: "launch",
    title: "Launched $WAVE",
    detail: "Pump.fun launch recorded with a starter SOL buy",
    status: "processing",
    created_at: "2026-07-02T17:54:00.000Z",
    amount_eth: null,
    amount_sol: 0.2,
    amount_usd: 309.96,
    chain: "solana",
    native_symbol: "SOL",
    launch_platform: "pump_fun",
    reference: "6Mki4nLhYf1QKzZ42t8uFVY6S2PVm2JsxVxK5hH7pump",
    tx_hash: null,
  },
];

export const Route = createFileRoute("/activity")({
  head: () => ({ meta: [{ title: "Public Activity - Linkr" }] }),
  component: PublicActivityPage,
});

function PublicActivityPage() {
  const [chainFilter, setChainFilter] = useState<ChainFilter>("all");
  const activityQuery = useQuery({
    queryKey: ["public-activity-feed"],
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("public_activity_feed" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(80);
      let activity: PublicActivity[];

      if (error) {
        const { data: launches, error: launchesError } = await supabase
          .from("coin_launches")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(80);
        if (launchesError) throw error;
        activity = (launches ?? []).map((launch) => ({
          id: "launch:" + launch.id,
          kind: "launch",
          title: "Launched $" + launch.symbol,
          detail: launch.description || launch.name,
          status: launch.status,
          created_at: launch.created_at,
          amount_eth: launch.dev_buy_eth,
          amount_sol: launch.dev_buy_sol,
          amount_usd: launch.dev_buy_usd,
          chain: launch.chain,
          native_symbol: launch.chain === "solana" ? "SOL" : "ETH",
          launch_platform: launch.launch_platform,
          reference: launch.token_address ?? launch.mint,
          tx_hash: launch.tx_signature,
          tweet_id: launch.tweet_id,
          user_post_text: null,
          user_post_url: null,
          user_post_author: null,
          user_post_name: null,
          user_post_avatar_url: null,
          linkr_response_text: null,
          linkr_response_tweet_id: null,
          linkr_response_status: null,
        })) satisfies PublicActivity[];
      } else {
        activity = (data ?? []) as PublicActivity[];
      }

      return enrichActivityProfiles(activity);
    },
  });

  const realItems = activityQuery.data ?? [];
  const items = realItems.length > 0 ? realItems : DEMO_ACTIVITY;
  const visibleItems = useMemo(() => filterByChain(items, chainFilter), [chainFilter, items]);
  return (
    <div className="min-h-screen sm-public-board-page sm-public-activity-page">
      <MarketingHeader />
      <main className="sm-public-board-shell">
        <section
          className="sm-public-panel sm-public-activity-panel"
          aria-labelledby="activity-stream-title"
        >
          <div className="sm-public-section-head">
            <div>
              <h2 id="activity-stream-title">Activity</h2>
              <p>Public questions, Linkr replies, and onchain activity in one readable stream.</p>
            </div>
          </div>
          <div className="sm-public-filter-toolbar">
            <PublicChainFilter
              active={chainFilter}
              ariaLabel="Filter activity by chain"
              counts={chainCounts(items)}
              onChange={setChainFilter}
            />
          </div>
          <div
            className="sm-public-activity-table sm-public-activity-list"
            role="list"
            aria-label="Public questions and responses"
          >
            {visibleItems.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

async function enrichActivityProfiles(activity: PublicActivity[]) {
  const handles = Array.from(
    new Set(
      activity
        .map((item) => normalizeHandle(item.user_post_author)?.toLowerCase())
        .filter((handle): handle is string => Boolean(handle)),
    ),
  );

  if (handles.length === 0) return activity;

  const { data, error } = await supabase
    .from("public_activity_profiles" as never)
    .select("*")
    .in("handle_key" as never, handles as never);

  // The activity stream remains usable while a new database migration is rolling out.
  if (error) return activity;

  const profiles = new Map(
    ((data ?? []) as unknown as PublicActivityProfile[]).map((profile) => [
      profile.handle_key,
      profile,
    ]),
  );

  return activity.map((item) => {
    const handle = normalizeHandle(item.user_post_author)?.toLowerCase();
    const profile = handle ? profiles.get(handle) : null;
    if (!profile) return item;

    return {
      ...item,
      user_post_author: profile.handle || item.user_post_author,
      user_post_name: profile.display_name,
      user_post_avatar_url: profile.avatar_url,
    };
  });
}

function ActivityRow({ item }: { item: PublicActivity }) {
  const userPost = cleanText(item.user_post_text);
  const response = cleanText(item.linkr_response_text);
  const hasConversation = !!userPost || !!response;
  const responseUrl = item.linkr_response_tweet_id
    ? xStatusUrl(item.linkr_response_tweet_id)
    : null;
  const linkUrl = responseUrl ?? item.user_post_url ?? null;
  const detail = userPost || cleanText(item.detail) || "Linkr event";
  const reference = item.reference || item.tx_hash || item.tweet_id;
  const amount = amountForActivity(item);
  const chain = chainPresentationForRecordIfKnown(item);
  const kind = displayKind(item);
  const handle = normalizeHandle(item.user_post_author);
  const actor = item.user_post_name?.trim() || (handle ? `@${handle}` : "Community member");
  const title = hasConversation ? `${actor} asked Linkr` : item.title;

  return (
    <article
      className={"sm-public-activity-row sm-public-activity-" + kind}
      data-conversation={hasConversation ? "true" : "false"}
      data-kind={kind}
      role="listitem"
    >
      <div className="sm-public-activity-card-head">
        <div className="sm-public-activity-card-title">
          {hasConversation ? (
            <ProfileAvatar avatarUrl={item.user_post_avatar_url} handle={handle} />
          ) : (
            <span className="sm-public-activity-kind" aria-hidden="true">
              <ActivityIcon kind={kind} />
            </span>
          )}
          <div className="sm-public-activity-heading-copy">
            {!hasConversation && <span>{activityKindLabel(kind)}</span>}
            {hasConversation ? (
              <strong className="sm-public-conversation-title">
                {handle ? <ProfileHandleLink handle={handle}>@{handle}</ProfileHandleLink> : actor}
                <span> asked Linkr</span>
              </strong>
            ) : (
              <strong>{title}</strong>
            )}
            <small className="sm-public-activity-context">
              <time dateTime={item.created_at} title={formatActivityDate(item.created_at)}>
                {relativeTime(item.created_at)}
              </time>
              {!hasConversation && (
                <>
                  <i aria-hidden="true" />
                  {chain && <ChainMark chain={chain.chain} />}
                </>
              )}
            </small>
          </div>
        </div>

        <div className="sm-public-activity-head-actions">
          {hasConversation && chain && <ChainMark chain={chain.chain} />}
          <span className={"sm-public-status sm-public-status-" + (item.status ?? "unknown")}>
            {statusLabel(item.status)}
          </span>
          {linkUrl && (
            <a
              className="sm-public-activity-link"
              href={linkUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open conversation on X"
            >
              <ArrowUpRight aria-hidden="true" size={18} strokeWidth={2.4} />
              <span>View on X</span>
            </a>
          )}
        </div>
      </div>

      {hasConversation ? (
        <div className="sm-public-activity-conversation">
          <ConversationMessage
            avatarUrl={item.user_post_avatar_url}
            displayName={item.user_post_name}
            handle={handle}
            label="Question"
            text={userPost}
            fallback="Original post unavailable"
          />
          <ConversationMessage
            handle="linkrbot"
            label="Linkr reply"
            text={response}
            fallback="Response pending"
            linkr
          />
        </div>
      ) : (
        <div className="sm-public-activity-event-body">
          <span>What happened</span>
          <p className="sm-public-activity-detail">
            <ProfileLinkedText text={summarizeText(detail, 220)} />
          </p>
        </div>
      )}

      <ActivityFacts
        amount={amount}
        reference={reference}
        responseStatus={item.linkr_response_status}
      />
    </article>
  );
}

function ConversationMessage({
  avatarUrl,
  displayName,
  handle,
  label,
  text,
  fallback,
  linkr = false,
}: {
  avatarUrl?: string | null;
  displayName?: string | null;
  handle: string | null;
  label: string;
  text: string | null;
  fallback: string;
  linkr?: boolean;
}) {
  return (
    <div className={linkr ? "sm-public-message sm-public-message-accent" : "sm-public-message"}>
      <div className="sm-public-message-author">
        <ProfileAvatar
          avatarUrl={linkr ? LINKR_PROFILE_IMAGE_SRC : avatarUrl}
          handle={handle}
          linkr={linkr}
        />
        <span>
          <small>{label}</small>
          {linkr ? (
            <strong>Linkr</strong>
          ) : handle ? (
            <ProfileHandleLink handle={handle}>@{handle}</ProfileHandleLink>
          ) : (
            <strong>{displayName?.trim() || "Community member"}</strong>
          )}
        </span>
      </div>
      <p>{text ? <ProfileLinkedText text={text} /> : fallback}</p>
    </div>
  );
}

function ProfileAvatar({
  avatarUrl,
  handle,
  linkr,
}: {
  avatarUrl?: string | null;
  handle: string | null;
  linkr?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const fallback = linkr ? "L" : (handle?.charAt(0) || "?").toUpperCase();

  return (
    <span className="sm-public-profile-avatar" data-linkr={linkr ? "true" : "false"}>
      <span aria-hidden="true">{fallback}</span>
      {avatarUrl && !imageFailed && (
        <img src={avatarUrl} alt="" loading="lazy" onError={() => setImageFailed(true)} />
      )}
    </span>
  );
}

function ActivityFacts({
  amount,
  reference,
  responseStatus,
}: {
  amount: string;
  reference: string | null | undefined;
  responseStatus?: string | null;
}) {
  if (amount === "none" && !reference && !responseStatus) return null;

  return (
    <div className="sm-public-activity-facts" aria-label="Activity details">
      {amount !== "none" && (
        <span>
          <small>Value</small>
          <strong>{amount}</strong>
        </span>
      )}
      {responseStatus && (
        <span>
          <small>X reply</small>
          <strong>{statusLabel(responseStatus)}</strong>
        </span>
      )}
      {reference && (
        <span>
          <small>Reference</small>
          <code>{shortAddress(reference, 7, 7)}</code>
        </span>
      )}
    </div>
  );
}

function ActivityIcon({ kind }: { kind: string }) {
  if (kind === "reply") return <MessageCircle />;
  if (kind === "launch") return <Rocket />;
  if (kind === "buy") return <TrendingUp />;
  if (kind === "sell") return <TrendingDown />;
  if (kind === "transfer" || kind === "send") return <Send />;
  return <WalletCards />;
}

function ChainMark({ chain }: { chain: "robinhood" | "solana" }) {
  return (
    <ChainPill
      chain={chain}
      className="sm-public-activity-chain"
      label={chain === "solana" ? "Solana" : "Robinhood"}
    />
  );
}

function amountForActivity(item: PublicActivity) {
  if (item.amount_usd != null) return formatUsd(item.amount_usd);
  if (item.chain === "solana" || item.native_symbol === "SOL")
    return item.amount_sol != null ? `${Number(item.amount_sol).toFixed(4)} SOL` : "none";
  if (item.amount_eth != null) return formatEth(item.amount_eth, 4) + " ETH";
  return "none";
}

function filterByChain(items: PublicActivity[], chainFilter: ChainFilter) {
  if (chainFilter === "all") return items;
  return items.filter((item) => chainKey(item) === chainFilter);
}

function chainCounts(items: PublicActivity[]): Record<ChainFilter, number> {
  return items.reduce(
    (counts, item) => {
      counts.all += 1;
      const chain = chainKey(item);
      if (chain) counts[chain] += 1;
      return counts;
    },
    { all: 0, robinhood: 0, solana: 0 },
  );
}

function chainKey(item: PublicActivity): Exclude<ChainFilter, "all"> | null {
  return chainPresentationForRecordIfKnown(item)?.chain ?? null;
}

function cleanText(text: string | null | undefined) {
  const value = text?.trim();
  return value ? value : null;
}

function summarizeText(text: string, max = 140) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max - 1).trimEnd() + "...";
}

function displayKind(item: PublicActivity) {
  if (item.kind === "inquiry" || item.kind === "agent") return "reply";
  return (item.kind || "event").toLowerCase();
}

function activityKindLabel(kind: string) {
  if (kind === "reply") return "Conversation";
  if (kind === "launch") return "Token launch";
  if (kind === "buy") return "Buy order";
  if (kind === "sell") return "Sell order";
  if (kind === "transfer" || kind === "send") return "Transfer";
  return "Onchain activity";
}

function normalizeHandle(handle: string | null | undefined) {
  const normalized = handle?.trim().replace(/^@/, "");
  return normalized || null;
}

function statusLabel(status: string | null | undefined) {
  const normalized = status?.trim().replace(/[_-]+/g, " ") || "Unknown";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatActivityDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function xStatusUrl(tweetId: string) {
  return "https://x.com/i/web/status/" + encodeURIComponent(tweetId);
}
