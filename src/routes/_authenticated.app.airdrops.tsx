import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  Boxes,
  AlertCircle,
  Clock3,
  ExternalLink,
  Gift,
  ReceiptText,
  Send,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { ChainPill } from "@/components/linkr/ChainPill";
import { DashboardStatCard } from "@/components/linkr/DashboardStatCard";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime, shortAddress } from "@/lib/linkr/format";

type NumericValue = number | string | null;

type HolderAirdropRow = {
  id: string;
  user_id: string;
  launch_id: string;
  pending_action_id: string | null;
  work_item_id: string | null;
  source_tweet_id: string;
  mint: string;
  wallet_address: string;
  source_token_account: string;
  token_decimals: number;
  source_balance_raw: NumericValue;
  requested_raw: NumericValue;
  allocated_raw: NumericValue;
  dust_raw: NumericValue;
  recipient_count: number;
  holder_account_count: number;
  snapshot_slot: number;
  snapshot_provider: string;
  snapshot_fetched_at: string;
  snapshot_checksum: string | null;
  excluded_dev_wallet: string;
  excluded_largest_owner: string;
  status: string;
  confirmed_at: string | null;
  completed_at: string | null;
  notification_sent_at: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
};

type HolderAirdropRecipientRow = {
  id: string;
  airdrop_id: string;
  ordinal: number;
  owner_address: string;
  holder_balance_raw: NumericValue;
  allocation_raw: NumericValue;
  status: string;
  batch_id: string | null;
  transaction_signature: string | null;
};

type HolderAirdropBatchRow = {
  id: string;
  airdrop_id: string;
  batch_index: number;
  first_ordinal: number;
  last_ordinal: number;
  recipient_count: number;
  allocated_raw: NumericValue;
  status: string;
  signature: string | null;
  broadcast_at: string | null;
  confirmed_at: string | null;
  last_error_code: string | null;
};

type LaunchLite = {
  id: string;
  name: string | null;
  symbol: string | null;
  image_url: string | null;
  stable_logo_url: string | null;
  mint: string | null;
  token_address: string | null;
};

type TweetLite = {
  tweet_id: string;
  text: string | null;
  tweet_url: string | null;
  author_username: string | null;
  created_at: string | null;
};

type QueryResult<Row> = { data: Row[] | null; error: { message: string } | null };
type QueryBuilder<Row> = PromiseLike<QueryResult<Row>> & {
  eq(column: string, value: unknown): QueryBuilder<Row>;
  in(column: string, value: string[]): QueryBuilder<Row>;
  limit(count: number): QueryBuilder<Row>;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<Row>;
};
type UntypedSupabase = {
  from<Row>(table: string): { select(columns: string): QueryBuilder<Row> };
};

type AirdropDashboardData = {
  airdrops: HolderAirdropRow[];
  batches: HolderAirdropBatchRow[];
  launchesById: Map<string, LaunchLite>;
  tweetsById: Map<string, TweetLite>;
};

const EMPTY_AIRDROPS: HolderAirdropRow[] = [];
const EMPTY_BATCHES: HolderAirdropBatchRow[] = [];

export const Route = createFileRoute("/_authenticated/app/airdrops")({
  head: () => ({ meta: [{ title: "Airdrops - Linkr" }] }),
  component: AirdropsPage,
});

function AirdropsPage() {
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const airdropsQuery = useQuery({
    queryKey: ["holder-airdrops-dashboard", user?.id],
    enabled: !!user,
    refetchInterval: 15_000,
    queryFn: async () => fetchAirdropDashboardData(user!.id),
  });

  const data = airdropsQuery.data;
  const airdrops = data?.airdrops ?? EMPTY_AIRDROPS;
  const batches = data?.batches ?? EMPTY_BATCHES;
  const selectedAirdrop = useMemo(
    () => airdrops.find((airdrop) => airdrop.id === selectedId) ?? airdrops[0] ?? null,
    [airdrops, selectedId],
  );
  const selectedBatches = useMemo(
    () => batches.filter((batch) => batch.airdrop_id === selectedAirdrop?.id),
    [batches, selectedAirdrop?.id],
  );
  const selectedLaunch = selectedAirdrop ? data?.launchesById.get(selectedAirdrop.launch_id) : null;
  const selectedTweet = selectedAirdrop
    ? data?.tweetsById.get(selectedAirdrop.source_tweet_id)
    : null;

  const recipientsQuery = useQuery({
    queryKey: ["holder-airdrop-recipients", selectedAirdrop?.id],
    enabled: !!selectedAirdrop?.id,
    refetchInterval: selectedAirdrop && !isTerminalStatus(selectedAirdrop.status) ? 15_000 : false,
    queryFn: async () => fetchAirdropRecipients(selectedAirdrop!.id),
  });

  const recipients = recipientsQuery.data ?? [];
  const stats = summarizeAirdrops(airdrops, batches);
  const completedSignal = `${stats.completedBatches}/${stats.totalBatches || 0} batches`;

  return (
    <div className="app-dashboard-page app-airdrops-page">
      <header className="app-live-hero app-dashboard-hero app-airdrops-hero">
        <div className="app-dashboard-hero-copy">
          <p className="app-live-kicker">Holder airdrops</p>
          <h1>Airdrops</h1>
          <p>
            Track every holder airdrop from immutable snapshot through confirmed batches, with the
            exact recipient allocation ledger in one place.
          </p>
        </div>
        <div className="app-live-signal" aria-label="Airdrop batch status">
          <span />
          {stats.activeAirdrops > 0 ? `${stats.activeAirdrops} active` : completedSignal}
        </div>
      </header>

      <section className="app-dashboard-launch-stats app-airdrops-stats" aria-label="Airdrop stats">
        <DashboardStatCard
          label="Airdrops"
          value={String(stats.totalAirdrops)}
          detail={`${stats.completedAirdrops} completed`}
          icon={<Gift />}
        />
        <DashboardStatCard
          label="Recipients"
          value={stats.totalRecipients.toLocaleString()}
          detail="Eligible wallets"
          icon={<UsersRound />}
        />
        <DashboardStatCard
          label="Batches"
          value={completedSignal}
          detail="Confirmed / total"
          icon={<Boxes />}
        />
        <DashboardStatCard
          label="Active"
          value={String(stats.activeAirdrops)}
          detail="Queued or running"
          icon={<Send />}
        />
      </section>

      <div className="app-airdrops-layout">
        <section className="sm-card app-dashboard-card app-airdrops-list-card">
          <div className="app-dashboard-card-head app-dashboard-section-head">
            <div>
              <h2>Recent airdrops</h2>
              <p className="app-dashboard-section-copy">
                Snapshot, queue, execution, and final status for each holder distribution.
              </p>
            </div>
          </div>

          {airdropsQuery.isLoading && <div className="app-empty-state">Loading airdrops...</div>}
          {airdropsQuery.isError && (
            <div className="app-empty-state">Could not load holder airdrops.</div>
          )}
          {!airdropsQuery.isLoading && !airdropsQuery.isError && airdrops.length === 0 && (
            <div className="app-empty-state">
              Airdrops you prepare through @linkrcash will appear here.
            </div>
          )}

          {airdrops.length > 0 && (
            <div className="app-airdrop-list" role="list">
              {airdrops.map((airdrop) => (
                <AirdropListRow
                  key={airdrop.id}
                  active={selectedAirdrop?.id === airdrop.id}
                  airdrop={airdrop}
                  batches={batches.filter((batch) => batch.airdrop_id === airdrop.id)}
                  launch={data?.launchesById.get(airdrop.launch_id)}
                  onSelect={() => setSelectedId(airdrop.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="sm-card app-dashboard-card app-airdrop-detail-card">
          {selectedAirdrop ? (
            <AirdropDetail
              airdrop={selectedAirdrop}
              batches={selectedBatches}
              launch={selectedLaunch}
              recipients={recipients}
              recipientsLoading={recipientsQuery.isLoading}
              tweet={selectedTweet}
            />
          ) : (
            <div className="app-empty-state">Select an airdrop to inspect recipients.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function AirdropListRow({
  active,
  airdrop,
  batches,
  launch,
  onSelect,
}: {
  active: boolean;
  airdrop: HolderAirdropRow;
  batches: HolderAirdropBatchRow[];
  launch?: LaunchLite;
  onSelect: () => void;
}) {
  const symbol = tokenSymbol(launch, airdrop);
  const progress = batchProgress(batches);

  return (
    <button className="app-airdrop-list-row" type="button" data-active={active} onClick={onSelect}>
      <TokenMark launch={launch} symbol={symbol} />
      <span className="app-airdrop-list-main">
        <b>{symbol}</b>
        <small>
          {airdrop.recipient_count.toLocaleString()} recipients · {relativeTime(airdrop.created_at)}
        </small>
      </span>
      <span className="app-airdrop-list-meta">
        <span className={statusClass(airdrop.status)}>{airdrop.status}</span>
        <small>
          {progress.confirmed}/{progress.total || 0}
        </small>
      </span>
    </button>
  );
}

function AirdropDetail({
  airdrop,
  batches,
  launch,
  recipients,
  recipientsLoading,
  tweet,
}: {
  airdrop: HolderAirdropRow;
  batches: HolderAirdropBatchRow[];
  launch?: LaunchLite | null;
  recipients: HolderAirdropRecipientRow[];
  recipientsLoading: boolean;
  tweet?: TweetLite | null;
}) {
  const symbol = tokenSymbol(launch, airdrop);
  const progress = batchProgress(batches);
  const progressStyle = { "--airdrop-progress": `${progress.percent}%` } as CSSProperties;

  return (
    <>
      <div className="app-airdrop-detail-head">
        <div className="app-airdrop-token-lockup">
          <TokenMark launch={launch ?? undefined} symbol={symbol} />
          <div>
            <p className="app-live-kicker">Selected airdrop</p>
            <h2>{symbol}</h2>
            <small>{launch?.name ?? shortAddress(airdrop.mint, 6, 6)}</small>
          </div>
        </div>
        <span className={statusClass(airdrop.status)}>{airdrop.status}</span>
      </div>

      <div className="app-airdrop-progress" style={progressStyle}>
        <div>
          <span />
        </div>
        <small>
          {progress.confirmed} confirmed · {progress.running} running · {progress.failed} failed
        </small>
      </div>

      <div className="app-airdrop-actions" aria-label="Airdrop links">
        <Link to="/coin/$mint" params={{ mint: airdrop.mint }}>
          <ExternalLink aria-hidden="true" size={15} />
          Coin
        </Link>
        <a
          href={xStatusUrl(tweet?.tweet_url, airdrop.source_tweet_id)}
          target="_blank"
          rel="noreferrer"
        >
          <ReceiptText aria-hidden="true" size={15} />
          Source
        </a>
        <a href={`https://solscan.io/token/${airdrop.mint}`} target="_blank" rel="noreferrer">
          <ShieldCheck aria-hidden="true" size={15} />
          Mint
        </a>
      </div>

      <div className="app-airdrop-detail-grid">
        <AirdropMetric
          icon={<WalletCards />}
          label="Requested"
          value={formatTokenRaw(airdrop.requested_raw, airdrop.token_decimals, symbol)}
        />
        <AirdropMetric
          icon={<Send />}
          label="Allocated"
          value={formatTokenRaw(airdrop.allocated_raw, airdrop.token_decimals, symbol)}
        />
        <AirdropMetric
          icon={<UsersRound />}
          label="Recipients"
          value={airdrop.recipient_count.toLocaleString()}
        />
        <AirdropMetric icon={<Clock3 />} label="Snapshot" value={`slot ${airdrop.snapshot_slot}`} />
      </div>

      <div className="app-airdrop-ledger-facts">
        <Fact label="Created" value={relativeTime(airdrop.created_at)} />
        <Fact
          label="Completed"
          value={airdrop.completed_at ? relativeTime(airdrop.completed_at) : "--"}
        />
        <Fact
          label="Dust retained"
          value={formatTokenRaw(airdrop.dust_raw, airdrop.token_decimals, symbol)}
        />
        <Fact label="Source wallet" value={shortAddress(airdrop.wallet_address, 6, 6)} mono />
        <Fact
          label="Creator excluded"
          value={shortAddress(airdrop.excluded_dev_wallet, 6, 6)}
          mono
        />
        <Fact
          label="Top holder excluded"
          value={shortAddress(airdrop.excluded_largest_owner, 6, 6)}
          mono
        />
        <Fact label="Snapshot provider" value={airdrop.snapshot_provider.replace(/_/g, " ")} />
        <Fact label="Checksum" value={shortAddress(airdrop.snapshot_checksum, 8, 8)} mono />
      </div>

      {tweet?.text && (
        <div className="app-airdrop-source-post">
          <span>Your post</span>
          <p>{tweet.text}</p>
        </div>
      )}

      <div className="app-airdrop-batches" aria-label="Airdrop batches">
        {batches.map((batch) => (
          <div key={batch.id} className="app-airdrop-batch-pill">
            <span className={statusClass(batch.status)}>{batch.status}</span>
            <b>#{batch.batch_index + 1}</b>
            <small>{batch.recipient_count} wallets</small>
          </div>
        ))}
      </div>

      <div className="app-airdrop-recipient-panel">
        <div className="app-dashboard-card-head app-dashboard-section-head">
          <div>
            <h2>Recipient ledger</h2>
            <p className="app-dashboard-section-copy">
              Each wallet, holder balance, allocation, status, and transaction signature.
            </p>
          </div>
          <span className="app-airdrop-recipient-count">{recipients.length.toLocaleString()}</span>
        </div>

        {recipientsLoading && <div className="app-empty-state">Loading recipients...</div>}
        {!recipientsLoading && recipients.length === 0 && (
          <div className="app-empty-state">No recipient rows found for this airdrop.</div>
        )}
        {recipients.length > 0 && (
          <div className="app-airdrop-recipient-list" role="list">
            {recipients.map((recipient) => (
              <RecipientRow
                key={recipient.id}
                airdrop={airdrop}
                recipient={recipient}
                symbol={symbol}
              />
            ))}
          </div>
        )}
      </div>

      {airdrop.failure_code && (
        <div className="app-airdrop-error">
          <AlertCircle aria-hidden="true" size={16} />
          <span>{airdrop.failure_code}</span>
        </div>
      )}
    </>
  );
}

function RecipientRow({
  airdrop,
  recipient,
  symbol,
}: {
  airdrop: HolderAirdropRow;
  recipient: HolderAirdropRecipientRow;
  symbol: string;
}) {
  const allocation = formatTokenRaw(recipient.allocation_raw, airdrop.token_decimals, symbol);
  const held = formatTokenRaw(recipient.holder_balance_raw, airdrop.token_decimals, symbol);
  const percent = allocationPercent(recipient.allocation_raw, airdrop.allocated_raw);

  return (
    <article className="app-airdrop-recipient-row" role="listitem">
      <span className="app-airdrop-recipient-rank">#{recipient.ordinal}</span>
      <div className="app-airdrop-recipient-wallet">
        <a
          href={`https://solscan.io/account/${recipient.owner_address}`}
          target="_blank"
          rel="noreferrer"
        >
          {shortAddress(recipient.owner_address, 6, 6)}
        </a>
        <small>{held} held</small>
      </div>
      <div className="app-airdrop-recipient-allocation">
        <strong>{allocation}</strong>
        <small>{percent}</small>
      </div>
      <span className={statusClass(recipient.status)}>{recipient.status}</span>
      {recipient.transaction_signature ? (
        <a
          className="app-airdrop-signature-link"
          href={`https://solscan.io/tx/${recipient.transaction_signature}`}
          target="_blank"
          rel="noreferrer"
          aria-label="View recipient transaction"
        >
          <ExternalLink aria-hidden="true" size={15} />
        </a>
      ) : (
        <span className="app-airdrop-signature-empty">--</span>
      )}
    </article>
  );
}

function AirdropMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="app-airdrop-metric">
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function Fact({ label, mono, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="app-airdrop-fact">
      <span>{label}</span>
      <strong className={mono ? "sm-mono" : undefined}>{value}</strong>
    </div>
  );
}

function TokenMark({ launch, symbol }: { launch?: LaunchLite; symbol: string }) {
  const image = launch?.stable_logo_url ?? launch?.image_url;
  const fallback = symbol.replace(/^\$/, "").slice(0, 2).toUpperCase() || "AD";

  return (
    <span className="app-airdrop-token-mark" aria-hidden="true">
      {image ? <img src={image} alt="" /> : fallback}
    </span>
  );
}

async function fetchAirdropDashboardData(userId: string): Promise<AirdropDashboardData> {
  const db = supabase as unknown as UntypedSupabase;
  const airdropsResult = await db
    .from<HolderAirdropRow>("linkr_holder_airdrops")
    .select(
      "id,user_id,launch_id,pending_action_id,work_item_id,source_tweet_id,mint,wallet_address,source_token_account,token_decimals,source_balance_raw,requested_raw,allocated_raw,dust_raw,recipient_count,holder_account_count,snapshot_slot,snapshot_provider,snapshot_fetched_at,snapshot_checksum,excluded_dev_wallet,excluded_largest_owner,status,confirmed_at,completed_at,notification_sent_at,failure_code,created_at,updated_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (airdropsResult.error) throw new Error(airdropsResult.error.message);
  const airdrops = airdropsResult.data ?? [];
  const airdropIds = airdrops.map((airdrop) => airdrop.id);
  const launchIds = uniqueStrings(airdrops.map((airdrop) => airdrop.launch_id));
  const tweetIds = uniqueStrings(airdrops.map((airdrop) => airdrop.source_tweet_id));

  const [batchesResult, launchesResult, tweetsResult] = await Promise.all([
    airdropIds.length
      ? db
          .from<HolderAirdropBatchRow>("linkr_holder_airdrop_batches")
          .select(
            "id,airdrop_id,batch_index,first_ordinal,last_ordinal,recipient_count,allocated_raw,status,signature,broadcast_at,confirmed_at,last_error_code",
          )
          .in("airdrop_id", airdropIds)
          .order("batch_index", { ascending: true })
          .limit(5000)
      : Promise.resolve({ data: [], error: null } satisfies QueryResult<HolderAirdropBatchRow>),
    launchIds.length
      ? db
          .from<LaunchLite>("coin_launches")
          .select("id,name,symbol,image_url,stable_logo_url,mint,token_address")
          .in("id", launchIds)
          .limit(50)
      : Promise.resolve({ data: [], error: null } satisfies QueryResult<LaunchLite>),
    tweetIds.length
      ? db
          .from<TweetLite>("tweets_inbox")
          .select("tweet_id,text,tweet_url,author_username,created_at")
          .in("tweet_id", tweetIds)
          .limit(50)
      : Promise.resolve({ data: [], error: null } satisfies QueryResult<TweetLite>),
  ]);

  if (batchesResult.error) throw new Error(batchesResult.error.message);
  if (launchesResult.error) throw new Error(launchesResult.error.message);
  if (tweetsResult.error) throw new Error(tweetsResult.error.message);

  return {
    airdrops,
    batches: batchesResult.data ?? [],
    launchesById: new Map((launchesResult.data ?? []).map((launch) => [launch.id, launch])),
    tweetsById: new Map((tweetsResult.data ?? []).map((tweet) => [tweet.tweet_id, tweet])),
  };
}

async function fetchAirdropRecipients(airdropId: string): Promise<HolderAirdropRecipientRow[]> {
  const db = supabase as unknown as UntypedSupabase;
  const result = await db
    .from<HolderAirdropRecipientRow>("linkr_holder_airdrop_recipients")
    .select(
      "id,airdrop_id,ordinal,owner_address,holder_balance_raw,allocation_raw,status,batch_id,transaction_signature",
    )
    .eq("airdrop_id", airdropId)
    .order("ordinal", { ascending: true })
    .limit(1000);

  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

function summarizeAirdrops(airdrops: HolderAirdropRow[], batches: HolderAirdropBatchRow[]) {
  return {
    activeAirdrops: airdrops.filter((airdrop) => !isTerminalStatus(airdrop.status)).length,
    completedAirdrops: airdrops.filter((airdrop) => airdrop.status === "completed").length,
    completedBatches: batches.filter((batch) => batch.status === "confirmed").length,
    totalAirdrops: airdrops.length,
    totalBatches: batches.length,
    totalRecipients: airdrops.reduce(
      (sum, airdrop) => sum + Number(airdrop.recipient_count || 0),
      0,
    ),
  };
}

function batchProgress(batches: HolderAirdropBatchRow[]) {
  const total = batches.length;
  const confirmed = batches.filter((batch) => batch.status === "confirmed").length;
  const failed = batches.filter((batch) => batch.status === "failed").length;
  const running = batches.filter((batch) =>
    ["claimed", "signed", "broadcasting", "broadcast", "reconciling"].includes(batch.status),
  ).length;
  return {
    confirmed,
    failed,
    percent: total ? Math.round((confirmed / total) * 100) : 0,
    running,
    total,
  };
}

function tokenSymbol(launch: LaunchLite | null | undefined, airdrop: HolderAirdropRow) {
  return launch?.symbol ? "$" + launch.symbol : "$" + shortAddress(airdrop.mint, 4, 4);
}

function statusClass(status: string | null) {
  const normalized = (status ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return "app-status app-status-" + normalized;
}

function isTerminalStatus(status: string | null) {
  return ["completed", "failed", "cancelled", "expired"].includes(String(status ?? ""));
}

function formatTokenRaw(value: NumericValue, decimals: number, symbol?: string) {
  const raw = rawBigInt(value);
  if (raw === null) return "--";
  const safeDecimals = Math.max(0, Math.min(18, Math.floor(Number(decimals) || 0)));
  const scale = 10n ** BigInt(safeDecimals);
  const whole = raw / scale;
  const fraction = safeDecimals > 0 ? raw % scale : 0n;
  const wholeText = addCommas(whole.toString());
  const fractionText =
    safeDecimals > 0
      ? fraction.toString().padStart(safeDecimals, "0").replace(/0+$/, "").slice(0, 6)
      : "";
  return `${wholeText}${fractionText ? "." + fractionText : ""}${symbol ? " " + symbol : ""}`;
}

function allocationPercent(allocation: NumericValue, total: NumericValue) {
  const allocationValue = Number(numericText(allocation));
  const totalValue = Number(numericText(total));
  if (!Number.isFinite(allocationValue) || !Number.isFinite(totalValue) || totalValue <= 0) {
    return "--";
  }
  return `${((allocationValue / totalValue) * 100).toLocaleString(undefined, {
    maximumFractionDigits: 3,
  })}%`;
}

function rawBigInt(value: NumericValue) {
  try {
    return BigInt(numericText(value));
  } catch {
    return null;
  }
}

function numericText(value: NumericValue) {
  if (value === null || value === undefined) return "0";
  return (
    String(value)
      .split(".")[0]
      .replace(/[^\d-]/g, "") || "0"
  );
}

function addCommas(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => !!value))];
}

function xStatusUrl(tweetUrl: string | null | undefined, tweetId: string) {
  return tweetUrl || `https://x.com/i/web/status/${encodeURIComponent(tweetId)}`;
}
