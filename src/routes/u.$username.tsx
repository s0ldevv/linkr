import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  Globe2,
  Heart,
  MapPin,
  MessageCircle,
  MessageSquare,
  Shield,
  Twitter,
  Wallet,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { MarketingHeader } from "@/components/linkr/MarketingHeader";
import "@/components/linkr/home/terminal/terminal-home.css";
import { formatEth, formatUsd, relativeTime, shortAddress } from "@/lib/linkr/format";
import {
  fetchUserProfileData,
  type ProfileInquiry,
  type ProfileLaunch,
  type ProfilePost,
  type ProfileComment,
  type ProfileTrade,
  type UserProfileData,
} from "@/lib/linkr/profile-data";

export const Route = createFileRoute("/u/$username")({
  head: ({ params }) => ({
    meta: [
      { title: `@${params.username.replace(/^@/, "")} - Linkr` },
      { name: "description", content: `Public Linkr profile for @${params.username}.` },
    ],
  }),
  component: UserProfilePage,
});

function UserProfilePage() {
  const { username } = Route.useParams();
  const normalizedUsername = username.replace(/^@/, "");

  const profileQuery = useQuery({
    queryKey: ["user-profile", normalizedUsername.toLowerCase()],
    retry: 1,
    queryFn: () => fetchUserProfileData(normalizedUsername),
  });

  const profile = profileQuery.data ?? null;
  const display = buildDisplayProfile(profile, normalizedUsername);
  const stats = useMemo(() => buildMetricCards(profile), [profile]);
  const isNotFound =
    profileQuery.isError && /not_found|404/i.test(String(profileQuery.error?.message ?? ""));

  return (
    <div className="lkt-home min-h-screen sm-profile-page">
      <MarketingHeader />
      <main className="lkt-shell sm-profile-shell">
        {profileQuery.isLoading && (
          <div className="sm-profile-loading">Loading public profile...</div>
        )}

        {profileQuery.isError && !profileQuery.isLoading && (
          <section className="sm-profile-empty">
            <h1>{isNotFound ? "Profile not found" : "Profile unavailable"}</h1>
            <p>
              {isNotFound
                ? "No Linkr or X profile matched this username."
                : profileQuery.error instanceof Error
                  ? profileQuery.error.message
                  : "The profile endpoint did not return data."}
            </p>
            <Link to="/">Back to Linkr</Link>
          </section>
        )}

        {profile && (
          <div className="sm-profile-layout">
            <div className="sm-profile-main">
              <ProfileHero profile={profile} display={display} />

              <section className="sm-profile-metrics" aria-label="Profile stats">
                {stats.map((stat) => (
                  <MetricCard key={stat.label} {...stat} />
                ))}
              </section>

              <div className="sm-profile-section-grid" aria-label="Profile activity">
                <ProfileSection
                  count={profile.posts.length}
                  eyebrow="Timeline"
                  title="Recent posts"
                  detail="Public posts Linkr has seen from this X account."
                  empty="No posts have been captured for this user yet."
                  variant="posts"
                >
                  <div className="sm-profile-post-list">
                    {profile.posts.map((post) => (
                      <PostCard key={post.id} post={post} display={display} />
                    ))}
                  </div>
                </ProfileSection>

                <ProfileSection
                  count={profile.launches.length}
                  eyebrow="Launches"
                  title="Coins launched"
                  detail="Tokens this user created through Linkr."
                  empty="No launches have been recorded for this user yet."
                  variant="launches"
                >
                  <div className="sm-profile-launch-grid">
                    {profile.launches.map((launch) => (
                      <LaunchCard key={launch.id} launch={launch} />
                    ))}
                  </div>
                </ProfileSection>

                <ProfileSection
                  count={profile.trades.length}
                  eyebrow="Trades"
                  title="Recent trades"
                  detail="Settled and in-flight wallet actions linked to this profile."
                  empty="No trades have been recorded for this user yet."
                  variant="trades"
                >
                  <div className="sm-profile-trade-list">
                    {profile.trades.map((trade) => (
                      <TradeRow key={trade.id} trade={trade} />
                    ))}
                  </div>
                </ProfileSection>

                <ProfileSection
                  count={profile.inquiries.length}
                  eyebrow="Questions"
                  title="Questions & inquiries"
                  detail="Recent public requests that asked Linkr for help, wallet info, history, or market context."
                  empty="No inquiry-style requests have been recorded yet."
                  variant="questions"
                >
                  <div className="sm-profile-inquiry-list">
                    {profile.inquiries.map((inquiry) => (
                      <InquiryCard key={inquiry.id} inquiry={inquiry} />
                    ))}
                  </div>
                </ProfileSection>

                <ProfileSection
                  count={profile.comments?.length ?? 0}
                  eyebrow="Comments"
                  title="Recent comments"
                  detail="Latest replies this user left on coin pages."
                  empty="No comments yet."
                  variant="comments"
                >
                  <div className="sm-profile-comment-list">
                    {(profile.comments ?? []).map((comment) => (
                      <CommentCard key={comment.id} comment={comment} />
                    ))}
                  </div>
                </ProfileSection>
              </div>
            </div>

            <aside className="sm-profile-side" aria-label="Profile details">
              <WalletCard profile={profile} />
              <SolWalletCard profile={profile} />
              <StatsCard profile={profile} />
              <TwitterInfoCard profile={profile} />
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function ProfileHero({ display, profile }: { display: DisplayProfile; profile: UserProfileData }) {
  const [copied, setCopied] = useState(false);
  const twitter = profile.twitter;

  const copyProfileUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="sm-profile-hero" aria-label="Profile summary">
      <div className="sm-profile-banner">
        {twitter?.bannerUrl ? <img src={twitter.bannerUrl} alt="" /> : null}
      </div>

      <div className="sm-profile-identity">
        <div className="sm-profile-avatar">
          {display.avatarUrl ? (
            <img src={display.avatarUrl} alt="" />
          ) : (
            <span>{display.initials}</span>
          )}
        </div>

        <div className="sm-profile-copy">
          <div className="sm-profile-name-line">
            <h1>{display.name}</h1>
            {twitter?.verified && (
              <span title="Verified on X">
                <BadgeCheck aria-hidden="true" size={18} />
                Verified
              </span>
            )}
            {twitter?.protected && (
              <span title="Protected X account">
                <Shield aria-hidden="true" size={17} />
                Protected
              </span>
            )}
          </div>
          <div className="sm-profile-handle-row">
            <a href={xProfileUrl(display.username)} target="_blank" rel="noreferrer">
              <Twitter aria-hidden="true" size={16} />@{display.username}
            </a>
          </div>
          <p className="sm-profile-bio">{twitter?.bio || "No public bio available yet."}</p>
          <div className="sm-profile-meta-row">
            {twitter?.location && (
              <span>
                <MapPin aria-hidden="true" size={15} />
                {twitter.location}
              </span>
            )}
            {twitter?.url && (
              <a href={twitter.url} target="_blank" rel="noreferrer">
                <Globe2 aria-hidden="true" size={15} />
                {stripProtocol(twitter.url)}
              </a>
            )}
            {twitter?.createdAt && (
              <span>
                <CalendarDays aria-hidden="true" size={15} />
                Joined X {formatMonthYear(twitter.createdAt)}
              </span>
            )}
            {profile.profile?.joinedLinkrAt && (
              <span>
                <Wallet aria-hidden="true" size={15} />
                Joined Linkr {formatMonthYear(profile.profile.joinedLinkrAt)}
              </span>
            )}
          </div>
        </div>

        <div className="sm-profile-actions">
          <a href={xProfileUrl(display.username)} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden="true" size={17} />X profile
          </a>
          <button type="button" onClick={copyProfileUrl}>
            {copied ? (
              <Check aria-hidden="true" size={17} />
            ) : (
              <Copy aria-hidden="true" size={17} />
            )}
            Share
          </button>
        </div>
      </div>
    </section>
  );
}

function ProfileSection({
  children,
  count,
  detail,
  empty,
  eyebrow,
  title,
  variant,
}: {
  children: ReactNode;
  count: number;
  detail: string;
  empty: string;
  eyebrow: string;
  title: string;
  variant: "launches" | "posts" | "questions" | "trades" | "comments";
}) {
  return (
    <section className="sm-profile-section" data-variant={variant}>
      <div className="sm-profile-section-head">
        <div>
          <span>{eyebrow}</span>
          <strong>{formatCompactNumber(count)}</strong>
        </div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      {count > 0 ? children : <p className="sm-profile-section-empty">{empty}</p>}
    </section>
  );
}

function PostCard({ display, post }: { display: DisplayProfile; post: ProfilePost }) {
  return (
    <article className="sm-profile-post-card">
      <div className="sm-profile-post-head">
        <div className="sm-profile-mini-avatar">
          {display.avatarUrl ? (
            <img src={display.avatarUrl} alt="" />
          ) : (
            <span>{display.initials}</span>
          )}
        </div>
        <div>
          <strong>{display.name}</strong>
          <small>
            @{display.username} · {relativeTime(post.createdAt)}
          </small>
        </div>
        {post.url && (
          <a href={post.url} target="_blank" rel="noreferrer" aria-label="Open post on X">
            <ArrowUpRight aria-hidden="true" size={18} />
          </a>
        )}
      </div>
      <p>{post.text}</p>
      {post.mediaUrl && (
        <div className="sm-profile-post-media">
          <img src={post.mediaUrl} alt="" />
        </div>
      )}
      <div className="sm-profile-chip-row">
        <span>{post.status}</span>
        {post.intent && <span>{titleCase(post.intent)}</span>}
        <span>{post.hasMedia ? "Media" : "Text"}</span>
      </div>
    </article>
  );
}

function LaunchCard({ launch }: { launch: ProfileLaunch }) {
  const isSolana = launch.chain === "solana" || launch.launchPlatform === "pump_fun";
  const body = (
    <>
      <div className="sm-profile-launch-art">
        {launch.imageUrl ? (
          <img src={launch.imageUrl} alt="" />
        ) : (
          <span>{launch.symbol.slice(0, 2)}</span>
        )}
      </div>
      <div className="sm-profile-launch-main">
        <div>
          <strong>${launch.symbol}</strong>
          <span className={"sm-public-status sm-public-status-" + launch.status}>
            {launch.status}
          </span>
        </div>
        <p>{launch.description || launch.name}</p>
      </div>
      <div className="sm-profile-chip-row">
        <span>{relativeTime(launch.createdAt)}</span>
        <span>
          {launch.devBuyUsd != null
            ? formatUsd(launch.devBuyUsd)
            : isSolana
              ? Number(launch.devBuySol ?? 0).toFixed(3) + " SOL"
              : formatEth(launch.devBuyEth, 3) + " ETH"}
        </span>
        <span>{isSolana ? "Solana / Pump.fun" : "Robinhood Chain"}</span>
        {launch.mint && <code>{shortAddress(launch.mint, 5, 5)}</code>}
      </div>
    </>
  );

  if (!launch.mint) {
    return <article className="sm-profile-launch-card">{body}</article>;
  }

  return (
    <Link to="/coin/$mint" params={{ mint: launch.mint }} className="sm-profile-launch-card">
      {body}
    </Link>
  );
}

function TradeRow({ trade }: { trade: ProfileTrade }) {
  const mint = trade.outputMint || trade.inputMint;

  return (
    <article className="sm-profile-trade-row">
      <div>
        <span className="sm-profile-kind">{trade.action || "trade"}</span>
        <strong>
          {trade.amountUsd != null
            ? formatUsd(trade.amountUsd)
            : formatEth(trade.amountEth, 4) + " ETH"}
        </strong>
        <small>{relativeTime(trade.createdAt)}</small>
      </div>
      <div className="sm-profile-trade-meta">
        {trade.amountOriginal != null && (
          <span>
            {formatCompactNumber(trade.amountOriginal)} {trade.amountOriginalUnit || ""}
          </span>
        )}
        {mint && <code>{shortAddress(mint, 6, 6)}</code>}
        <span className={"sm-public-status sm-public-status-" + (trade.status ?? "unknown")}>
          {trade.status ?? "unknown"}
        </span>
        {trade.txHash && (
          <a
            href={trade.explorerUrl ?? `https://robinhoodchain.blockscout.com/tx/${trade.txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            Explorer
            <ArrowUpRight aria-hidden="true" size={15} />
          </a>
        )}
      </div>
    </article>
  );
}

function InquiryCard({ inquiry }: { inquiry: ProfileInquiry }) {
  return (
    <article className="sm-profile-inquiry-card">
      <div>
        <span className="sm-profile-kind">
          <MessageCircle aria-hidden="true" size={15} />
          {titleCase(inquiry.intent || "inquiry")}
        </span>
        <small>{relativeTime(inquiry.createdAt)}</small>
      </div>
      <p>{inquiry.text || "Inquiry text unavailable."}</p>
      <div className="sm-profile-chip-row">
        <span>{inquiry.status ?? "unknown"}</span>
        {inquiry.tweetId && (
          <a href={xStatusUrl(inquiry.tweetId)} target="_blank" rel="noreferrer">
            Open post
            <ArrowUpRight aria-hidden="true" size={15} />
          </a>
        )}
      </div>
    </article>
  );
}

function CommentCard({ comment }: { comment: ProfileComment }) {
  const isNftCollection = comment.target === "nft_collection";
  const name =
    comment.subjectName ?? comment.coinName ?? (isNftCollection ? "NFT collection" : null);
  const symbol = comment.subjectSymbol ?? comment.coinSymbol ?? null;
  const image = comment.subjectImageUrl ?? comment.coinImageUrl ?? null;
  const fallbackId = comment.subjectId ?? comment.mint ?? "";
  const primary = isNftCollection
    ? name || "NFT collection"
    : symbol
      ? `$${symbol}`
      : name || (fallbackId ? shortAddress(fallbackId, 4, 4) : "Coin");
  const secondary = isNftCollection ? (symbol ? `$${symbol}` : null) : name && symbol ? name : null;
  const initials = ((symbol ?? name ?? fallbackId) || "??").slice(0, 2).toUpperCase();

  const coinArt = (
    <>
      <span className="sm-profile-comment-coin-art">
        {image ? <img src={image} alt="" /> : <span>{initials}</span>}
      </span>
      <span className="sm-profile-comment-coin-meta">
        <strong>{primary}</strong>
        {secondary && <small>{secondary}</small>}
      </span>
      <ArrowUpRight aria-hidden="true" size={16} />
    </>
  );

  return (
    <article className="sm-profile-comment-card">
      {isNftCollection && comment.subjectId ? (
        <Link
          to="/nfts/$collectionId"
          params={{ collectionId: comment.subjectId }}
          className="sm-profile-comment-coin"
        >
          {coinArt}
        </Link>
      ) : comment.mint ? (
        <Link to="/coin/$mint" params={{ mint: comment.mint }} className="sm-profile-comment-coin">
          {coinArt}
        </Link>
      ) : (
        <div className="sm-profile-comment-coin">{coinArt}</div>
      )}
      <p>
        {comment.isReply && <span className="sm-profile-comment-tag">Reply</span>}
        {comment.body}
      </p>
      <div className="sm-profile-chip-row">
        <span>{relativeTime(comment.createdAt)}</span>
        <span>
          <Heart aria-hidden="true" size={13} /> {comment.likeCount}
        </span>
        <span>
          <MessageSquare aria-hidden="true" size={13} /> {comment.replyCount}
        </span>
      </div>
    </article>
  );
}

function SolWalletCard({ profile }: { profile: UserProfileData }) {
  const wallet = profile.solWallet;

  return (
    <section className="sm-profile-side-card sm-profile-wallet-card">
      <div className="sm-profile-side-title">
        <span>
          <Wallet aria-hidden="true" size={18} />
          Solana wallet
        </span>
      </div>
      {wallet ? (
        <>
          <strong>{wallet.solBalance != null ? wallet.solBalance.toFixed(4) : "--"} SOL</strong>
          <p>{wallet.usdValue != null ? formatUsd(wallet.usdValue) : "USD value unavailable"}</p>
          <a
            href={
              wallet.explorerUrl ??
              `https://solscan.io/account/${encodeURIComponent(wallet.address ?? wallet.publicKey)}`
            }
            target="_blank"
            rel="noreferrer"
          >
            <code>{shortAddress(wallet.address ?? wallet.publicKey, 6, 6)}</code>
            <ArrowUpRight aria-hidden="true" size={16} />
          </a>
        </>
      ) : (
        <p>This profile does not have a public Solana wallet yet.</p>
      )}
    </section>
  );
}

function WalletCard({ profile }: { profile: UserProfileData }) {
  const wallet = profile.wallet;

  return (
    <section className="sm-profile-side-card sm-profile-wallet-card">
      <div className="sm-profile-side-title">
        <span>
          <Wallet aria-hidden="true" size={18} />
          Primary wallet
        </span>
      </div>
      {wallet ? (
        <>
          <strong>{formatEth(wallet.ethBalance, 4)} ETH</strong>
          <p>{wallet.usdValue != null ? formatUsd(wallet.usdValue) : "USD value unavailable"}</p>
          <a
            href={
              wallet.explorerUrl ??
              `https://robinhoodchain.blockscout.com/address/${wallet.address ?? wallet.publicKey}`
            }
            target="_blank"
            rel="noreferrer"
          >
            <code>{shortAddress(wallet.address ?? wallet.publicKey, 6, 6)}</code>
            <ArrowUpRight aria-hidden="true" size={16} />
          </a>
        </>
      ) : (
        <p>This profile does not have a public primary wallet yet.</p>
      )}
    </section>
  );
}

function StatsCard({ profile }: { profile: UserProfileData }) {
  const stats = profile.stats;

  return (
    <section className="sm-profile-side-card">
      <div className="sm-profile-side-title">
        <span>Linkr stats</span>
        <small>{stats?.lastActivityAt ? relativeTime(stats.lastActivityAt) : "activity"}</small>
      </div>
      <div className="sm-profile-info-list">
        <InfoRow label="Total volume" value={formatUsd(stats?.volumeUsdTotal)} />
        <InfoRow label="30d volume" value={formatUsd(stats?.volumeUsd30d)} />
        <InfoRow label="Total trades" value={formatCompactNumber(stats?.tradesTotal)} />
        <InfoRow label="30d trades" value={formatCompactNumber(stats?.trades30d)} />
        <InfoRow label="Agent runs" value={formatCompactNumber(stats?.agentRunsTotal)} />
        <InfoRow label="Pending actions" value={formatCompactNumber(stats?.pendingActions)} />
      </div>
    </section>
  );
}

function TwitterInfoCard({ profile }: { profile: UserProfileData }) {
  const twitter = profile.twitter;

  return (
    <section className="sm-profile-side-card">
      <div className="sm-profile-side-title">
        <span>X profile</span>
        <small>{twitter?.source ?? "stored"}</small>
      </div>
      <div className="sm-profile-info-list">
        <InfoRow label="X user id" value={twitter?.id ?? "--"} />
        <InfoRow label="Followers" value={formatCompactNumber(twitter?.followers)} />
        <InfoRow label="Following" value={formatCompactNumber(twitter?.following)} />
        <InfoRow label="Tweets" value={formatCompactNumber(twitter?.tweetCount)} />
        <InfoRow label="Listed" value={formatCompactNumber(twitter?.listedCount)} />
        <InfoRow
          label="Created"
          value={twitter?.createdAt ? formatDate(twitter.createdAt) : "--"}
        />
      </div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function MetricCard({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="sm-profile-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}

type DisplayProfile = {
  avatarUrl: string | null;
  initials: string;
  name: string;
  username: string;
};

function buildDisplayProfile(
  profile: UserProfileData | null,
  fallbackUsername: string,
): DisplayProfile {
  const username = profile?.twitter?.username || profile?.profile?.username || fallbackUsername;
  const name = profile?.twitter?.name || profile?.profile?.name || "@" + username;
  return {
    avatarUrl: profile?.twitter?.avatarUrl || profile?.profile?.avatarUrl || null,
    initials: initialsFor(name || username),
    name,
    username,
  };
}

function buildMetricCards(profile: UserProfileData | null) {
  const twitter = profile?.twitter;
  const stats = profile?.stats;

  return [
    {
      label: "followers",
      value: formatCompactNumber(twitter?.followers),
      detail: formatCompactNumber(twitter?.following) + " following",
    },
    {
      label: "posts",
      value: formatCompactNumber(stats?.postsTotal ?? twitter?.tweetCount),
      detail: `${profile?.posts.length ?? 0} recent captured`,
    },
    {
      label: "launches",
      value: formatCompactNumber(stats?.launchesTotal),
      detail: `${profile?.launches.length ?? 0} shown on profile`,
    },
    {
      label: "trades",
      value: formatCompactNumber(stats?.tradesTotal),
      detail: `${formatCompactNumber(stats?.trades30d)} in 30d`,
    },
    {
      label: "volume",
      value: formatUsd(stats?.volumeUsdTotal),
      detail: `${formatUsd(stats?.volumeUsd30d)} in 30d`,
    },
    {
      label: "questions",
      value: formatCompactNumber(stats?.inquiriesTotal),
      detail: `${profile?.inquiries.length ?? 0} recent inquiries`,
    },
  ];
}

function initialsFor(value: string) {
  const parts = value.replace(/^@/, "").split(/\s+/).filter(Boolean).slice(0, 2);
  return (parts.map((part) => part[0]).join("") || "U").toUpperCase();
}

function formatCompactNumber(value: number | string | null | undefined): string {
  if (value == null) return "--";
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(number)) return "--";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: number >= 10_000 ? 1 : 2,
    notation: number >= 10_000 ? "compact" : "standard",
  }).format(number);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatMonthYear(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

function stripProtocol(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function titleCase(value: string) {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\w\S*/g, (word) => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase());
}

function xProfileUrl(username: string) {
  return `https://x.com/${encodeURIComponent(username.replace(/^@/, ""))}`;
}

function xStatusUrl(tweetId: string) {
  return "https://x.com/i/web/status/" + encodeURIComponent(tweetId);
}
