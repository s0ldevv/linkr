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
    <div className="app-dashboard-page lkt-home">
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

      <section
        className="sm-public-board-shell"
        style={{ marginTop: 24, padding: "clamp(26px, 3vw, 48px) 0" }}
      >
        <div className="sm-public-section-head" style={{ marginBottom: 0 }}>
          <div>
            <span>Solana NFTs</span>
            <h2>Collections</h2>
          </div>
          <span className="lkt-badge--demo">{collections.length}</span>
        </div>
        {collectionsQuery.isLoading ? (
          <p className="lkt-muted" style={{ padding: "1rem" }}>
            Loading…
          </p>
        ) : collections.length === 0 ? (
          <p className="lkt-muted" style={{ padding: "1rem" }}>
            No collections yet. Tag @linkrcash on X and ask it to mint one.
          </p>
        ) : (
          <div className="lkt-coin-grid">
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

      <section
        className="sm-public-board-shell"
        style={{ marginTop: 0, padding: "clamp(26px, 3vw, 48px) 0" }}
      >
        <div className="sm-public-section-head" style={{ marginBottom: 0 }}>
          <div>
            <span>Your NFTs</span>
            <h2>Minted NFTs</h2>
          </div>
          <span className="lkt-badge--demo">{mints.length}</span>
        </div>
        {mintsQuery.isLoading ? (
          <p className="lkt-muted" style={{ padding: "1rem" }}>
            Loading…
          </p>
        ) : mints.length === 0 ? (
          <p className="lkt-muted" style={{ padding: "1rem" }}>
            No NFTs minted yet.
          </p>
        ) : (
          <div className="lkt-coin-grid">
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
    <article className="lkt-coin-card lkt-nft-card">
      <div className="lkt-nft-cover">
        <img src={image} alt={name} loading="lazy" />
        <span
          className={`app-nft-status app-nft-status-${status}`}
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            padding: "4px 10px",
            background: "rgb(0 0 0 / 62%)",
            borderRadius: "999px",
            fontSize: "0.66rem",
            fontWeight: "900",
            textTransform: "uppercase",
            border: "0",
          }}
        >
          {status}
        </span>
      </div>
      <div className="lkt-coin-top">
        <div className="lkt-coin-id">
          <span className="lkt-coin-symbol">{name}</span>
          <span className="lkt-coin-name">{subtitle}</span>
        </div>
      </div>
      {mintAddress ? (
        <div className="lkt-coin-market">
          <div>
            <span className="lkt-coin-mcap-label">Mint</span>
            <span className="lkt-coin-mcap" style={{ fontSize: "0.9rem" }}>
              {mintAddress.slice(0, 6)}…{mintAddress.slice(-4)}
            </span>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="lkt-muted" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
          {error}
        </p>
      ) : null}
      {explorerUrl ? (
        <div className="lkt-coin-actions" style={{ marginTop: "0.5rem" }}>
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
            View <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      ) : null}
    </article>
  );
}
