import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Images, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/app/nfts")({
  head: () => ({
    meta: [
      { title: "NFTs — SOLMate" },
      {
        name: "description",
        content: "Mint Solana NFT collections and NFTs directly from X by tagging @linkrcash.",
      },
    ],
  }),
  component: NftsPage,
});

interface Collection {
  id: string;
  name: string;
  symbol: string;
  image_url: string;
  mint_address: string | null;
  explorer_url: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

interface Mint {
  id: string;
  name: string;
  image_url: string;
  mint_address: string | null;
  explorer_url: string | null;
  status: string;
  error: string | null;
  created_at: string;
  collection_id: string;
}

function NftsPage() {
  const { user } = useAuth();

  const collectionsQuery = useQuery({
    queryKey: ["nft-collections", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nft_collections")
        .select("id,name,symbol,image_url,mint_address,explorer_url,status,error,created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Collection[];
    },
  });

  const mintsQuery = useQuery({
    queryKey: ["nft-mints", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nft_mints")
        .select("id,name,image_url,mint_address,explorer_url,status,error,created_at,collection_id")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Mint[];
    },
  });

  const collections = collectionsQuery.data ?? [];
  const mints = mintsQuery.data ?? [];

  return (
    <div className="app-dashboard-page app-nfts-page">
      <header className="app-live-hero app-dashboard-hero">
        <div className="app-dashboard-hero-copy">
          <p className="app-live-kicker">Solana NFTs</p>
          <h1>Collections & mints</h1>
          <p>
            Mint by replying to @linkrcash on X. Try{" "}
            <code>"mint nft collection called My Punks symbol PUNK"</code> or{" "}
            <code>"mint this nft to my collection My Punks"</code>.
          </p>
        </div>
        <div className="app-live-signal" aria-label="NFT status">
          <Images aria-hidden="true" size={16} />
          Metaplex on Solana
        </div>
      </header>

      <section className="app-nfts-section" aria-labelledby="app-nfts-collections-title">
        <div className="app-nfts-section-head">
          <div>
            <span>Solana NFTs</span>
            <h2 id="app-nfts-collections-title">Collections</h2>
          </div>
          <span className="app-nfts-count">{collections.length}</span>
        </div>
        {collectionsQuery.isLoading ? (
          <p className="app-nfts-empty">Loading…</p>
        ) : collections.length === 0 ? (
          <p className="app-nfts-empty">
            No collections yet. Tag @linkrcash on X and ask it to mint one.
          </p>
        ) : (
          <div className="app-nfts-grid">
            {collections.map((c) => (
              <NftTile
                key={c.id}
                name={c.name}
                subtitle={`Collection • ${c.symbol}`}
                image={c.image_url}
                mintAddress={c.mint_address}
                explorerUrl={c.explorer_url}
                status={c.status}
                error={c.error}
              />
            ))}
          </div>
        )}
      </section>

      <section className="app-nfts-section" aria-labelledby="app-nfts-mints-title">
        <div className="app-nfts-section-head">
          <div>
            <span>Your NFTs</span>
            <h2 id="app-nfts-mints-title">Minted NFTs</h2>
          </div>
          <span className="app-nfts-count">{mints.length}</span>
        </div>
        {mintsQuery.isLoading ? (
          <p className="app-nfts-empty">Loading…</p>
        ) : mints.length === 0 ? (
          <p className="app-nfts-empty">No NFTs minted yet.</p>
        ) : (
          <div className="app-nfts-grid">
            {mints.map((m) => {
              const parent = collections.find((c) => c.id === m.collection_id);
              return (
                <NftTile
                  key={m.id}
                  name={m.name}
                  subtitle={parent ? `In ${parent.name}` : "NFT"}
                  image={m.image_url}
                  mintAddress={m.mint_address}
                  explorerUrl={m.explorer_url}
                  status={m.status}
                  error={m.error}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function NftTile({
  name,
  subtitle,
  image,
  mintAddress,
  explorerUrl,
  status,
  error,
}: {
  name: string;
  subtitle: string;
  image: string;
  mintAddress: string | null;
  explorerUrl: string | null;
  status: string;
  error: string | null;
}) {
  return (
    <article className="app-nft-card" data-status={status} data-has-error={Boolean(error)}>
      <div className="app-nft-card-media">
        <img src={image} alt={name} loading="lazy" />
        <span className="app-nft-status">{status}</span>
      </div>
      <div className="app-nft-card-head">
        <div className="app-nft-card-title">
          <span className="app-nft-card-name">{name}</span>
          <span className="app-nft-card-subtitle">{subtitle}</span>
        </div>
      </div>
      {mintAddress ? (
        <div className="app-nft-card-meta">
          <div>
            <span className="app-nft-card-meta-label">Mint</span>
            <span className="app-nft-card-meta-value">
              {mintAddress.slice(0, 6)}…{mintAddress.slice(-4)}
            </span>
          </div>
        </div>
      ) : null}
      {error ? <p className="app-nft-card-error">{error}</p> : null}
      {explorerUrl ? (
        <div className="app-nft-card-actions">
          <a
            className="app-nft-card-link"
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      ) : null}
    </article>
  );
}
