export function readMarketBoolean(name: string, fallback: boolean): boolean {
  let raw: string | undefined;
  try {
    raw = Deno.env.get(name);
  } catch (_) {
    return fallback;
  }
  if (raw == null || raw.trim() === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return fallback;
}

export function readMarketPositiveInt(name: string, fallback: number): number {
  let raw: string | undefined;
  try {
    raw = Deno.env.get(name);
  } catch (_) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function marketDataEnabled(): boolean {
  return readMarketBoolean("LINKR_MARKET_DATA_ENABLED", true);
}

export function blockscoutEnabled(): boolean {
  return marketDataEnabled() && readMarketBoolean("LINKR_BLOCKSCOUT_ENABLED", true);
}

export function dexscreenerEnabled(): boolean {
  return (
    marketDataEnabled() &&
    readMarketBoolean("LINKR_DEXSCREENER_ENABLED", true) &&
    !!dexscreenerChainSlug("robinhood")
  );
}

export function moralisEnabled(): boolean {
  return (
    marketDataEnabled() &&
    readMarketBoolean("LINKR_MORALIS_ENABLED", false) &&
    !!robinhoodMoralisChainId()
  );
}

const DEFAULT_DEXSCREENER_CHAIN_SLUG = "robinhood";

export function dexscreenerChainSlug(chain: "robinhood" | "solana" = "robinhood"): string | null {
  if (chain === "solana") {
    const raw = Deno.env.get("SOLANA_DEXSCREENER_CHAIN_SLUG")?.trim();
    return raw || "solana";
  }
  const raw = Deno.env.get("ROBINHOOD_DEXSCREENER_CHAIN_SLUG")?.trim();
  return raw || DEFAULT_DEXSCREENER_CHAIN_SLUG;
}

export function robinhoodMoralisChainId(): string | null {
  const raw = Deno.env.get("ROBINHOOD_MORALIS_CHAIN_ID")?.trim();
  return raw || null;
}

export function tokenDataTtlSeconds(): number {
  return readMarketPositiveInt("LINKR_MARKET_DATA_CACHE_TTL_SECONDS", 90);
}

export function discoveryTtlSeconds(): number {
  return readMarketPositiveInt("LINKR_MARKET_DATA_DISCOVERY_TTL_SECONDS", 180);
}

export function metadataTtlSeconds(): number {
  return readMarketPositiveInt("LINKR_MARKET_DATA_METADATA_TTL_SECONDS", 86_400);
}

export function maxPromptBytes(): number {
  return readMarketPositiveInt("LINKR_MARKET_DATA_MAX_PROMPT_BYTES", 6000);
}
