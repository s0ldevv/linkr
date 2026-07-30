import { Activity, ArrowUpRight, ShieldCheck } from "lucide-react";
import type { PublicHomeData, PublicTokenRank, PublicTraderRank } from "@/lib/linkr/home-data";
import { formatCompactNumber, formatCompactUsd } from "@/lib/linkr/home-data";
import { shortAddress } from "@/lib/linkr/format";
import { ProfileHandleLink } from "@/components/linkr/ProfileHandleLink";

const ROUTER_STEPS = ["tweet", "rules", "sign", "receipt"] as const;
const MARQUEE_ITEMS = ["reply", "route", "sign", "settle"] as const;
const PREVIEW_TOKENS: PublicTokenRank[] = [
  {
    createdAt: "preview",
    description: "Preview row",
    devBuyEth: 1.4,
    devBuyUsd: 210,
    id: "preview-token-nova",
    imageUrl: null,
    liquidityUsd: 12400,
    marketCapUsd: 84200,
    mint: null,
    name: "Preview launch",
    pairUrl: null,
    priceChange24h: null,
    status: "preview",
    symbol: "NOVA",
    txSignature: null,
  },
  {
    createdAt: "preview",
    description: "Preview row",
    devBuyEth: 0.8,
    devBuyUsd: 120,
    id: "preview-token-rush",
    imageUrl: null,
    liquidityUsd: 8800,
    marketCapUsd: 41600,
    mint: null,
    name: "Reply sample",
    pairUrl: null,
    priceChange24h: null,
    status: "preview",
    symbol: "RUSH",
    txSignature: null,
  },
  {
    createdAt: "preview",
    description: "Preview row",
    devBuyEth: 2.1,
    devBuyUsd: 315,
    id: "preview-token-pixel",
    imageUrl: null,
    liquidityUsd: 22100,
    marketCapUsd: 128400,
    mint: null,
    name: "Demo market",
    pairUrl: null,
    priceChange24h: null,
    status: "preview",
    symbol: "PIXEL",
    txSignature: null,
  },
];
const PREVIEW_TRADERS: PublicTraderRank[] = [
  { amount_eth: 18.4, handle: "previewdesk", rank: 1, trades: 24, volume_usd: 12840 },
  { amount_eth: 11.9, handle: "replypilot", rank: 2, trades: 18, volume_usd: 8930 },
  { amount_eth: 7.2, handle: "limitmode", rank: 3, trades: 11, volume_usd: 5120 },
];

export function HeroProductPanel({ data, loading }: { data?: PublicHomeData; loading?: boolean }) {
  const tokens = data?.topLaunchedTokens.slice(0, 3) ?? [];
  const traders = data?.topTraders30d.slice(0, 3) ?? [];
  const hasTokenData = tokens.length > 0;
  const hasTraderData = traders.length > 0;
  const displayTokens = hasTokenData ? tokens : PREVIEW_TOKENS;
  const displayTraders = hasTraderData ? traders : PREVIEW_TRADERS;

  return (
    <section
      className="sm-hero-product-panel sm-rayo-router-panel"
      aria-label="Live Linkr product preview"
    >
      <div className="sm-router-art" aria-hidden="true">
        <img
          className="sm-router-art-primary"
          src="/rayo/img/icons/300x300_obj-cta-01.webp"
          alt=""
        />
        <img
          className="sm-router-art-button"
          src="/rayo/img/icons/300x300_obj-btn-01.webp"
          alt=""
        />
      </div>

      <div className="sm-router-layout">
        <div className="sm-router-copy">
          <ol className="sm-router-path" aria-label="Reply routing path">
            <li>
              <span style={{ background: "#ffffffad !important" }}>1</span>
              <strong>TWEET</strong>
            </li>
            <li>
              <span>2</span>
              <strong>RULES</strong>
            </li>
            <li>
              <span style={{ background: "#ffffffad !important" }}>3</span>
              <strong>SIGN</strong>
            </li>
            <li>
              <span>4</span>
              <strong>RECEIPT</strong>
            </li>
          </ol>

          <div className="sm-router-command-card">
            <div className="sm-router-command-head">
              <span>@linkrbot</span>
              <b>queued from X</b>
            </div>
            <p>buy $100 of this</p>
            <div className="sm-router-command-status">
              <span>rules matched</span>
              <span>signature ready</span>
            </div>
          </div>
        </div>

        <div className="sm-router-metrics">
          <div className="sm-product-market-grid">
            <article>
              <div className="sm-product-mini-head">
                <span>Launched markets</span>
                <ArrowUpRight aria-hidden="true" size={15} />
              </div>
              <div className="sm-product-list">
                {displayTokens.map((token) => (
                  <a
                    key={token.id}
                    href={token.mint ? `/coin/${token.mint}` : "/explore"}
                    data-disabled={!token.mint || undefined}
                    data-preview={!hasTokenData || undefined}
                  >
                    <span className="sm-product-token-avatar">
                      {token.imageUrl ? (
                        <img src={token.imageUrl} alt="" />
                      ) : (
                        token.symbol.slice(0, 2)
                      )}
                    </span>
                    <span>
                      <strong>${token.symbol}</strong>
                      <small>{hasTokenData ? token.name : `${token.name} preview`}</small>
                    </span>
                    <b>
                      {token.marketCapUsd != null
                        ? formatCompactUsd(token.marketCapUsd)
                        : shortAddress(token.mint)}
                    </b>
                  </a>
                ))}
              </div>
            </article>

            <article>
              <div className="sm-product-mini-head">
                <span>Top wallets</span>
                <Activity aria-hidden="true" size={15} />
              </div>
              <div className="sm-product-list sm-product-trader-list">
                {displayTraders.map((trader) => (
                  <div key={trader.handle} data-preview={!hasTraderData || undefined}>
                    <span>{trader.rank}</span>
                    <span>
                      <strong>
                        <ProfileHandleLink handle={trader.handle}>
                          @{trader.handle.replace(/^@/, "")}
                        </ProfileHandleLink>
                      </strong>
                      <small>
                        {hasTraderData
                          ? `${formatCompactNumber(trader.trades)} trades`
                          : `${formatCompactNumber(trader.trades)} preview routes`}
                      </small>
                    </span>
                    <b>{formatCompactUsd(trader.volume_usd)}</b>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </div>
      </div>

      <div className="sm-product-safe-row">
        <ShieldCheck aria-hidden="true" size={18} />
        <span>Saved wallet rules run before any signature leaves Linkr.</span>
      </div>
    </section>
  );
}
