import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ExternalLink,
  Images,
  Share2,
  Copy,
  Check,
  Sparkles,
  Twitter,
  X as XIcon,
  ShieldCheck,
} from "lucide-react";
import { MarketingHeader } from "@/components/linkr/MarketingHeader";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime, shortAddress } from "@/lib/linkr/format";
import { NftCollectionComments } from "@/components/linkr/nft/NftCollectionComments";
import "@/components/linkr/home/terminal/terminal-home.css";

interface CollectionRow {
  id: string;
  name: string;
  symbol: string;
  description: string | null;
  image_url: string;
  mint_address: string | null;
  explorer_url: string | null;
  website_url: string | null;
  twitter_url: string | null;
  telegram_url: string | null;
  created_at: string;
}

interface MintRow {
  id: string;
  name: string;
  image_url: string;
  mint_address: string | null;
  explorer_url: string | null;
  created_at: string;
  source_tweet_id?: string | null;
}

function normalizeExternalUrl(url?: string | null): string | null {
  if (!url) return null;
  const value = String(url).trim();
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function solscanUrlForMint(mintAddress: string | null): string | null {
  if (!mintAddress) return null;
  return `https://solscan.io/token/${mintAddress}`;
}

function magicEdenUrlForMint(mintAddress: string | null): string | null {
  if (!mintAddress) return null;
  return `https://magiceden.io/marketplace/${mintAddress}`;
}

function tensorUrlForMint(mintAddress: string | null): string | null {
  if (!mintAddress) return null;
  return `https://www.tensor.trade/trade/${mintAddress}`;
}

export const Route = createFileRoute("/nfts/$collectionId")({
  head: () => ({
    meta: [
      { title: "NFT Collection Details - Linkr" },
      {
        name: "description",
        content:
          "Browse NFT collection metadata and minted NFTs for a specific Solana collection on Linkr.",
      },
      { property: "og:title", content: "NFT Collection Details - Linkr" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NftCollectionDetailPage,
});

function NftCollectionDetailPage() {
  const { collectionId } = Route.useParams();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const collectionQuery = useQuery({
    queryKey: ["public-nft-collection", collectionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nft_collections")
        .select(
          "id,name,symbol,description,image_url,mint_address,explorer_url,website_url,twitter_url,telegram_url,created_at",
        )
        .eq("id", collectionId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as CollectionRow | null;
    },
  });

  const mintsQuery = useQuery({
    queryKey: ["public-nft-collection-mints", collectionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nft_mints")
        .select("id,name,image_url,mint_address,explorer_url,created_at,source_tweet_id")
        .eq("collection_id", collectionId)
        .not("mint_address", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as MintRow[];
    },
  });

  const collection = collectionQuery.data;
  const mints = mintsQuery.data ?? [];
  const isLoading = collectionQuery.isLoading;
  const [selectedMintId, setSelectedMintId] = useState<string | null>(null);
  const selectedMint = mints.find((mint) => mint.id === selectedMintId) ?? null;

  const mintedLabel = mints.length === 1 ? "NFT" : "NFTs";
  const composeUrl = collection
    ? `https://x.com/intent/tweet?text=${encodeURIComponent(
        `@linkrcash mint this nft to my collection ${collection.name}`,
      )}`
    : "";

  const collectionExplorer = collection
    ? (normalizeExternalUrl(collection.explorer_url) ??
      solscanUrlForMint(collection.mint_address ?? null))
    : null;
  const collectionWebsite = normalizeExternalUrl(collection?.website_url);
  const collectionTwitter = normalizeExternalUrl(collection?.twitter_url);
  const collectionTelegram = normalizeExternalUrl(collection?.telegram_url);
  const magicEdenCollection = magicEdenUrlForMint(collection?.mint_address ?? null);
  const tensorCollection = tensorUrlForMint(collection?.mint_address ?? null);

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((currentKey) => (currentKey === key ? null : currentKey));
      }, 1600);
    } catch {
      setCopiedKey(null);
    }
  };

  const shareCollection = async () => {
    const url = window.location.href;
    const title = `${collection?.name ?? "NFT Collection"} - Linkr`;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        return;
      }
    }

    await copyText(url, "page");
  };

  return (
    <div className="sm-coin-page lkt-nft-detail-page">
      <MarketingHeader />
      <main className="sm-coin-shell">
        {isLoading && (
          <div className="sm-public-board-shell">
            <div className="sm-coin-loading">Loading collection...</div>
          </div>
        )}

        {!isLoading && !collection && (
          <div className="sm-public-board-shell">
            <div className="sm-coin-empty">
              <h1>Collection not found</h1>
              <p>This collection may not be confirmed on-chain yet. Check back shortly.</p>
              <Link to="/nfts" className="btn btn-anim btn-line-small btn-muted">
                <ArrowLeft aria-hidden="true" size={16} strokeWidth={2.4} />
                <span className="btn-caption">Back to gallery</span>
              </Link>
            </div>
          </div>
        )}

        {collection && (
          <div className="sm-coin-layout">
            <div className="sm-coin-main">
              {/* Hero Identity Section */}
              <section className="sm-coin-identity" aria-label="Collection summary">
                <div className="sm-coin-token-art">
                  <img alt={collection.name} loading="lazy" src={collection.image_url} />
                </div>

                <div className="sm-coin-title-block">
                  <div className="sm-coin-title-line">
                    <h1>{collection.name}</h1>
                    <span>${collection.symbol}</span>
                  </div>
                  <div className="sm-coin-subline">
                    <span>Solana NFT</span>
                    <span>
                      {mints.length} {mintedLabel}
                    </span>
                    {collection.created_at && <span>{relativeTime(collection.created_at)}</span>}
                  </div>
                  <p>
                    {collection.description ??
                      `${collection.name} is a Solana NFT collection minted through @linkrcash on X.`}
                  </p>
                </div>

                <div className="sm-coin-identity-actions">
                  <button type="button" onClick={shareCollection}>
                    <Share2 aria-hidden="true" size={17} />
                    Share
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(collection.mint_address ?? "", "mint")}
                  >
                    {copiedKey === "mint" ? (
                      <Check aria-hidden="true" className="sm-coin-copy-confirmed" size={17} />
                    ) : (
                      <Copy aria-hidden="true" size={17} />
                    )}
                    {collection.mint_address ? shortAddress(collection.mint_address, 5, 5) : "TBD"}
                  </button>
                </div>

                <div className="sm-coin-links">
                  {collectionTwitter && (
                    <a href={collectionTwitter} target="_blank" rel="noreferrer">
                      <Twitter aria-hidden="true" size={15} />X / Twitter
                    </a>
                  )}
                  {collectionWebsite && (
                    <a href={collectionWebsite} target="_blank" rel="noreferrer">
                      <ExternalLink aria-hidden="true" size={15} />
                      Website
                    </a>
                  )}
                  {collectionExplorer && (
                    <a href={collectionExplorer} target="_blank" rel="noreferrer">
                      <ExternalLink aria-hidden="true" size={15} />
                      Explorer
                    </a>
                  )}
                </div>
              </section>

              {/* NFT Grid */}
              {mints.length > 0 && (
                <section className="lkt-nft-mints-section" aria-label="Minted NFTs">
                  <div className="lkt-nft-mints-header">
                    <Images aria-hidden="true" size={18} strokeWidth={2} />
                    <span>Minted so far · {mints.length}</span>
                  </div>
                  <div className="lkt-nft-mints-grid" aria-busy={mintsQuery.isLoading || undefined}>
                    {mintsQuery.isLoading ? (
                      <div className="sm-coin-empty">Loading NFTs...</div>
                    ) : (
                      mints.map((mint) => (
                        <NftMintCard
                          key={mint.id}
                          mint={mint}
                          collection={collection}
                          onSelect={() => setSelectedMintId(mint.id)}
                        />
                      ))
                    )}
                  </div>
                </section>
              )}

              <NftCollectionComments
                collectionId={collection.id}
                collectionName={collection.name}
              />
            </div>

            {/* Sidebar */}
            <aside className="sm-coin-side" aria-label="Collection actions and related data">
              <MintCommandCard collection={collection} composeUrl={composeUrl} />
              <CollectionLinksCard
                collectionExplorer={collectionExplorer}
                collectionWebsite={collectionWebsite}
                collectionTwitter={collectionTwitter}
                collectionTelegram={collectionTelegram}
                magicEdenCollection={magicEdenCollection}
                tensorCollection={tensorCollection}
              />
              <CollectionStatsCard collection={collection} mintsCount={mints.length} />
            </aside>
          </div>
        )}
      </main>

      {collection && selectedMint && (
        <NftDetailModal
          collection={collection}
          mint={selectedMint}
          onClose={() => setSelectedMintId(null)}
        />
      )}
    </div>
  );
}

function MintCommandCard({
  collection,
  composeUrl,
}: {
  collection: CollectionRow;
  composeUrl: string;
}) {
  const tradeCommand = `@linkrcash mint this nft to my collection ${collection.name}`;

  return (
    <section className="sm-coin-trade-card" aria-label="NFT mint command card">
      <div className="sm-coin-trade-tabs">
        <button aria-pressed={true} type="button">
          Mint NFT
        </button>
      </div>

      <div className="sm-coin-trade-balance">
        <span>Collection</span>
        <strong>{collection.name}</strong>
      </div>

      <div className="sm-coin-trade-command">
        <span>Command</span>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(tradeCommand);
          }}
          type="button"
        >
          {tradeCommand}
        </button>
      </div>

      <a className="sm-coin-trade-submit" href={composeUrl} target="_blank" rel="noreferrer">
        Post mint request on X
        <ArrowLeft aria-hidden="true" size={18} style={{ transform: "rotate(180deg)" }} />
      </a>
    </section>
  );
}

function CollectionLinksCard({
  collectionExplorer,
  collectionWebsite,
  collectionTwitter,
  collectionTelegram,
  magicEdenCollection,
  tensorCollection,
}: {
  collectionExplorer: string | null;
  collectionWebsite: string | null;
  collectionTwitter: string | null;
  collectionTelegram: string | null;
  magicEdenCollection: string | null;
  tensorCollection: string | null;
}) {
  const links = [
    collectionTwitter ? { label: "X / Twitter", url: collectionTwitter } : null,
    collectionWebsite ? { label: "Website", url: collectionWebsite } : null,
    collectionExplorer ? { label: "Explorer", url: collectionExplorer } : null,
    collectionTelegram ? { label: "Telegram", url: collectionTelegram } : null,
    magicEdenCollection ? { label: "Magic Eden", url: magicEdenCollection } : null,
    tensorCollection ? { label: "Tensor", url: tensorCollection } : null,
  ].filter((item): item is { label: string; url: string } => Boolean(item));

  return (
    <section className="sm-coin-side-card">
      <div className="sm-coin-side-title">
        <span>
          <ExternalLink aria-hidden="true" size={16} />
          Collection links
        </span>
      </div>
      <div className="sm-coin-link-list">
        {links.length === 0 && <p>No links added yet.</p>}
        {links.map((link) => (
          <a key={link.label + link.url} href={link.url} target="_blank" rel="noreferrer">
            {link.label}
            <ExternalLink aria-hidden="true" size={14} />
          </a>
        ))}
      </div>
    </section>
  );
}

function CollectionStatsCard({
  collection,
  mintsCount,
}: {
  collection: CollectionRow;
  mintsCount: number;
}) {
  const collectionExplorer = collection
    ? (normalizeExternalUrl(collection.explorer_url) ??
      solscanUrlForMint(collection.mint_address ?? null))
    : null;

  return (
    <section className="sm-coin-side-card">
      <div className="sm-coin-side-title">
        <span>
          <ShieldCheck aria-hidden="true" size={16} />
          Collection details
        </span>
      </div>
      <div className="sm-coin-info-list">
        <span>
          <small>Name</small>
          <strong>{collection.name}</strong>
        </span>
        <span>
          <small>Symbol</small>
          <strong>${collection.symbol}</strong>
        </span>
        <span>
          <small>Total NFTs</small>
          <strong>{mintsCount.toLocaleString()}</strong>
        </span>
        <span>
          <small>Created</small>
          <strong>{relativeTime(collection.created_at)}</strong>
        </span>
        <span>
          <small>Contract</small>
          <strong>
            {collection.mint_address ? shortAddress(collection.mint_address, 6, 6) : "TBD"}
          </strong>
        </span>
        {collectionExplorer && (
          <a href={collectionExplorer} target="_blank" rel="noreferrer">
            View collection on explorer
          </a>
        )}
      </div>
    </section>
  );
}

function NftMintCard({
  mint,
  collection,
  onSelect,
}: {
  mint: MintRow;
  collection: CollectionRow;
  onSelect: () => void;
}) {
  return (
    <button
      className="lkt-coin-card lkt-nft-card lkt-nft-card-button"
      onClick={onSelect}
      type="button"
    >
      <div className="lkt-nft-cover">
        <img alt={mint.name} loading="lazy" src={mint.image_url} />
      </div>

      <div className="lkt-coin-top">
        <div className="lkt-coin-id">
          <span className="lkt-coin-symbol">{mint.name}</span>
          <span className="lkt-coin-name">in {collection.name}</span>
        </div>
      </div>

      <div className="lkt-coin-market">
        <div>
          <span className="lkt-coin-mcap-label">Mint</span>
          <span className="lkt-coin-mcap lkt-nft-meta-value">
            {mint.mint_address ? shortAddress(mint.mint_address, 4, 4) : "—"}
          </span>
        </div>
        <div className="lkt-nft-meta-right">
          <span className="lkt-coin-mcap-label">Age</span>
          <span className="lkt-coin-mcap lkt-nft-meta-value">{relativeTime(mint.created_at)}</span>
        </div>
      </div>
    </button>
  );
}

function NftDetailModal({
  collection,
  mint,
  onClose,
}: {
  collection: CollectionRow;
  mint: MintRow;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const explorer = mint.explorer_url ?? solscanUrlForMint(mint.mint_address ?? null);
  const tweetUrl = mint.source_tweet_id
    ? `https://twitter.com/i/status/${mint.source_tweet_id}`
    : null;
  const magicEden = magicEdenUrlForMint(mint.mint_address ?? null);
  const tensorTrade = tensorUrlForMint(mint.mint_address ?? null);
  const collectionExplorer =
    normalizeExternalUrl(collection.explorer_url) ??
    solscanUrlForMint(collection.mint_address ?? null);

  return (
    <div aria-modal="true" className="lkt-nft-modal-overlay" role="dialog" onClick={onClose}>
      <div className="lkt-nft-modal" onClick={(event) => event.stopPropagation()}>
        <button aria-label="Close" className="lkt-nft-modal-close" onClick={onClose} type="button">
          <XIcon aria-hidden="true" size={16} strokeWidth={2.6} />
        </button>

        <div className="lkt-nft-modal-media">
          <img alt={mint.name} src={mint.image_url} />
        </div>

        <div className="lkt-nft-modal-body">
          <div className="lkt-nft-modal-head">
            <span className="lkt-nft-modal-eyebrow">
              <Sparkles aria-hidden="true" size={11} />
              in {collection.name} · ${collection.symbol}
            </span>
            <h2>{mint.name}</h2>
            <p>Minted {relativeTime(mint.created_at)} on Solana</p>
          </div>

          <div className="lkt-nft-modal-meta">
            <div>
              <span>Mint address</span>
              <strong>{mint.mint_address ? shortAddress(mint.mint_address, 6, 6) : "—"}</strong>
            </div>
            <div>
              <span>Collection</span>
              <strong>{collection.name}</strong>
            </div>
            <div>
              <span>Minted</span>
              <strong>{relativeTime(mint.created_at)}</strong>
            </div>
            <div>
              <span>Chain</span>
              <strong>Solana</strong>
            </div>
          </div>

          {tweetUrl && (
            <div className="lkt-nft-modal-tweet">
              <span className="lkt-nft-modal-section-label">Source post</span>
              <a href={tweetUrl} rel="noreferrer" target="_blank">
                <Twitter aria-hidden="true" size={14} />
                <span>View the tweet that minted this NFT</span>
                <ExternalLink aria-hidden="true" size={13} />
              </a>
            </div>
          )}

          <div className="lkt-nft-modal-actions">
            {explorer && (
              <a className="lkt-nft-modal-action" href={explorer} rel="noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" size={15} />
                <span>View on Solscan</span>
              </a>
            )}
            {magicEden && (
              <a className="lkt-nft-modal-action" href={magicEden} rel="noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" size={14} />
                <span>Magic Eden</span>
              </a>
            )}
            {tensorTrade && (
              <a
                className="lkt-nft-modal-action"
                href={tensorTrade}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink aria-hidden="true" size={14} />
                <span>Tensor</span>
              </a>
            )}
            {collectionExplorer && (
              <a
                className="lkt-nft-modal-action"
                href={collectionExplorer}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink aria-hidden="true" size={14} />
                <span>Open collection</span>
              </a>
            )}
            <Link
              className="lkt-nft-modal-action"
              onClick={onClose}
              params={{ collectionId: collection.id }}
              to="/nfts/$collectionId"
            >
              <Images aria-hidden="true" size={15} />
              <span>Back to {collection.name}</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
