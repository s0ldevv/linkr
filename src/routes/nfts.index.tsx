import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Images, Rocket, Sparkles, Twitter, X as XIcon } from "lucide-react";
import { MarketingHeader } from "@/components/linkr/MarketingHeader";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime, shortAddress } from "@/lib/linkr/format";
import "@/components/linkr/home/terminal/terminal-home.css";

interface CollectionRow {
  id: string;
  name: string;
  symbol: string;
  image_url: string;
  mint_address: string | null;
  explorer_url: string | null;
  created_at: string;
}

interface MintRow {
  id: string;
  name: string;
  image_url: string;
  mint_address: string | null;
  explorer_url: string | null;
  created_at: string;
  collection_id: string;
  source_tweet_id?: string | null;
}

function placeholderCover(symbol: string, index: number): string {
  const accents = ["#ccff00", "#9f8be7", "#70e0b0"];
  const accent = accents[index % accents.length];
  const initials = symbol.slice(0, 3).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#242424"/><stop offset="1" stop-color="#141414"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="308" cy="86" r="150" fill="${accent}" fill-opacity="0.16"/><circle cx="86" cy="332" r="112" fill="${accent}" fill-opacity="0.1"/><text x="50%" y="53%" font-family="Funnel Display, Inter, sans-serif" font-size="122" font-weight="800" fill="${accent}" fill-opacity="0.92" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const PLACEHOLDER_COLLECTIONS: CollectionRow[] = [
  { symbol: "NOVA", name: "Nova Punks" },
  { symbol: "GLYPH", name: "Glyph Society" },
  { symbol: "AURA", name: "Aura Frames" },
  { symbol: "PIXL", name: "Pixel Relics" },
  { symbol: "ORBIT", name: "Orbit Wanderers" },
  { symbol: "MONO", name: "Mono Editions" },
].map((c, index) => ({
  id: `placeholder-${c.symbol.toLowerCase()}`,
  name: c.name,
  symbol: c.symbol,
  image_url: placeholderCover(c.symbol, index),
  mint_address: null,
  explorer_url: null,
  created_at: "",
}));

function normalizeExternalUrl(url?: string | null): string | null {
  if (!url) return null;
  const value = String(url).trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function magicEdenUrlForMint(mintAddress: string | null): string | null {
  if (!mintAddress) return null;
  return `https://magiceden.io/marketplace/${mintAddress}`;
}

function tensorUrlForMint(mintAddress: string | null): string | null {
  if (!mintAddress) return null;
  return `https://www.tensor.trade/trade/${mintAddress}`;
}

export const Route = createFileRoute("/nfts/")({
  head: () => ({
    meta: [
      { title: "NFT Gallery — Linkr" },
      {
        name: "description",
        content:
          "Browse Solana NFT collections and fresh mints created from X by tagging @linkrcash.",
      },
      { property: "og:title", content: "NFT Gallery — Linkr" },
      {
        property: "og:description",
        content:
          "Browse Solana NFT collections and fresh mints created from X by tagging @linkrcash.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NftsGalleryPage,
});

function NftsGalleryPage() {
  const collectionsQuery = useQuery({
    queryKey: ["public-nft-collections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nft_collections")
        .select("id,name,symbol,image_url,mint_address,explorer_url,created_at")
        .not("mint_address", "is", null)
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as CollectionRow[];
    },
  });

  const mintsQuery = useQuery({
    queryKey: ["public-nft-mints"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nft_mints")
        .select(
          "id,name,image_url,mint_address,explorer_url,created_at,collection_id,source_tweet_id",
        )
        .not("mint_address", "is", null)
        .order("created_at", { ascending: false })
        .limit(24);
      if (error) throw error;
      return (data ?? []) as MintRow[];
    },
  });

  const collections = collectionsQuery.data ?? [];
  const mints = mintsQuery.data ?? [];

  const countsById = useMemo(() => {
    const map = new Map<string, number>();
    mints.forEach((m) => map.set(m.collection_id, (map.get(m.collection_id) ?? 0) + 1));
    return map;
  }, [mints]);

  const collectionsById = useMemo(() => {
    const map = new Map<string, CollectionRow>();
    collections.forEach((c) => map.set(c.id, c));
    return map;
  }, [collections]);

  const isLoading = collectionsQuery.isLoading || mintsQuery.isLoading;
  const showPlaceholders = !isLoading && collections.length === 0;
  const displayCollections = showPlaceholders ? PLACEHOLDER_COLLECTIONS : collections;
  const [selectedMintId, setSelectedMintId] = useState<string | null>(null);
  const selectedMint = mints.find((m) => m.id === selectedMintId) ?? null;
  const selectedParent = selectedMint ? collectionsById.get(selectedMint.collection_id) : null;

  return (
    <div className="lkt-home min-h-screen sm-public-board-page sm-public-launches-page lkt-nft-gallery-page">
      <MarketingHeader />
      <main className="sm-public-launches-main">
        <div className="sm-public-board-shell sm-public-launches-summary">
          <section className="sm-public-section-head" aria-labelledby="nfts-collections-title">
            <div>
              <span>Solana NFTs</span>
              <h2 id="nfts-collections-title">Collections</h2>
              <p>Tap a collection to browse its NFTs.</p>
            </div>
            <div className="sm-public-filter-toolbar">
              <a
                className="sm-public-launch-action"
                href="https://x.com/linkrcash"
                target="_blank"
                rel="noreferrer"
              >
                <Rocket aria-hidden="true" size={16} strokeWidth={2.4} />
                <span>Launch</span>
              </a>
            </div>
          </section>
        </div>

        <section
          className="sm-public-board-shell sm-public-launch-card-section lkt-section-narrow"
          aria-busy={isLoading || undefined}
          aria-label="NFT collections grid"
        >
          <div className="lkt-coin-grid">
            {displayCollections.map((c) => (
              <CollectionCard
                collection={c}
                demo={showPlaceholders}
                key={c.id}
                mintCount={countsById.get(c.id) ?? 0}
              />
            ))}
          </div>
        </section>

        {mints.length > 0 && (
          <div className="sm-public-board-shell lkt-nft-recent-wrap">
            <section className="sm-public-section-head" aria-labelledby="nfts-recent-title">
              <div>
                <span>Live drops</span>
                <h2 id="nfts-recent-title">New submissions</h2>
                <p>Freshest NFTs minted across every collection.</p>
              </div>
            </section>
            <section
              className="sm-public-launch-card-section lkt-section-narrow"
              aria-label="Recent NFT mints"
            >
              <div className="lkt-coin-grid">
                {mints.map((m) => (
                  <MintCard
                    key={m.id}
                    mint={m}
                    onSelect={() => setSelectedMintId(m.id)}
                    parent={collectionsById.get(m.collection_id)}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
      {selectedMint && selectedParent && (
        <NftDetailModal
          collection={selectedParent}
          mint={selectedMint}
          onClose={() => setSelectedMintId(null)}
        />
      )}
    </div>
  );
}

function CollectionCard({
  collection,
  mintCount,
  demo,
}: {
  collection: CollectionRow;
  mintCount: number;
  demo?: boolean;
}) {
  const inner = (
    <>
      <div className="lkt-nft-cover">
        <img alt={collection.name} loading="lazy" src={collection.image_url} />
      </div>
      <div className="lkt-coin-top">
        <div className="lkt-coin-id">
          <span className="lkt-coin-symbol">${collection.symbol}</span>
          <span className="lkt-coin-name">{collection.name}</span>
        </div>
        <span className="lkt-badge lkt-badge--nft-count">
          {demo ? "Preview" : `${mintCount} NFT${mintCount === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="lkt-coin-market">
        <div>
          <span className="lkt-coin-mcap-label">Contract</span>
          <span className="lkt-coin-mcap lkt-nft-meta-value">
            {collection.mint_address ? shortAddress(collection.mint_address, 4, 4) : "—"}
          </span>
        </div>
        <div className="lkt-nft-meta-right">
          <span className="lkt-coin-mcap-label">Age</span>
          <span className="lkt-coin-mcap lkt-nft-meta-value">
            {demo ? "Soon" : relativeTime(collection.created_at)}
          </span>
        </div>
      </div>
    </>
  );

  if (demo) {
    return (
      <div aria-hidden="true" className="lkt-coin-card lkt-nft-card lkt-nft-card--demo">
        {inner}
      </div>
    );
  }

  return (
    <Link
      className="lkt-coin-card lkt-nft-card"
      params={{ collectionId: collection.id }}
      to="/nfts/$collectionId"
    >
      {inner}
    </Link>
  );
}

function MintCard({
  mint,
  parent,
  onSelect,
}: {
  mint: MintRow;
  parent?: CollectionRow;
  onSelect: () => void;
}) {
  const clickable = Boolean(parent);
  return (
    <button
      className="lkt-coin-card lkt-nft-card lkt-nft-card-button"
      disabled={!clickable}
      onClick={onSelect}
      type="button"
    >
      <div className="lkt-nft-cover">
        <img alt={mint.name} loading="lazy" src={mint.image_url} />
      </div>
      <div className="lkt-coin-top">
        <div className="lkt-coin-id">
          <span className="lkt-coin-symbol">{mint.name}</span>
          <span className="lkt-coin-name">{parent ? `in ${parent.name}` : "NFT"}</span>
        </div>
      </div>
      <div className="lkt-coin-actions" aria-hidden="true" />
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const explorer =
    mint.explorer_url ??
    (mint.mint_address ? `https://solscan.io/token/${mint.mint_address}` : null);
  const normalizedCollectionExplorer = normalizeExternalUrl(collection.explorer_url);
  const collectionExplorer =
    normalizedCollectionExplorer ??
    (collection.mint_address ? `https://solscan.io/token/${collection.mint_address}` : null);
  const magicEden = magicEdenUrlForMint(mint.mint_address);
  const tensorUrl = tensorUrlForMint(mint.mint_address);
  const tweetUrl = mint.source_tweet_id
    ? `https://twitter.com/i/status/${mint.source_tweet_id}`
    : null;

  return (
    <div aria-modal="true" className="lkt-nft-modal-overlay" onClick={onClose} role="dialog">
      <div className="lkt-nft-modal" onClick={(e) => e.stopPropagation()}>
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
            {tensorUrl && (
              <a className="lkt-nft-modal-action" href={tensorUrl} rel="noreferrer" target="_blank">
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
              <span>Open {collection.name}</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
