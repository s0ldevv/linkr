export type LaunchMetadataOverrides = {
  websiteUrl: string | null;
  twitterUrl: string | null;
  telegramUrl: string | null;
};

export function defaultCoinWebsiteUrl(tokenMint: unknown): string {
  const token = String(tokenMint ?? "").trim();
  if (!token) return "https://linkr.cash/coin";
  return `https://linkr.cash/coin/${encodeURIComponent(token)}`;
}

export type ResolvedLaunchMetadataUrls = {
  websiteUrl: string;
  twitterUrl: string | null;
  telegramUrl: string | null;
  testingMode: boolean;
};

export type LaunchMetadataSource = {
  metadata_website_url?: string | null;
  metadata_twitter_url?: string | null;
  metadata_telegram_url?: string | null;
  source_tweet_url?: string | null;
  mint_address?: string | null;
};

export type LaunchMetadataTestingOptions = {
  testingMode: boolean;
  mintAddress?: string | null;
  testingWebsiteUrl?: string | null;
  testingTwitterUrl?: string | null;
  testingTelegramUrl?: string | null;
};

/**
 * Resolve the website/twitter/telegram URLs sent to pump.fun's metadata
 * uploader.
 *
 * While database testing mode is true, each configured testing value overrides
 * the launch request for every launch. Blank testing values ignore user
 * metadata and fall back to the normal default for that field. When disabled:
 *   - website: user-provided override, else https://linkr.cash/coin/<mint>
 *   - twitter: user-provided override, else the original X post URL
 *   - telegram: user-provided override only (never auto-filled)
 */
export function resolvePumpFunLaunchMetadata(
  launch: LaunchMetadataSource,
  options: LaunchMetadataTestingOptions,
): ResolvedLaunchMetadataUrls {
  const mint = String(options.mintAddress ?? launch.mint_address ?? "").trim();
  if (options.testingMode) {
    return {
      websiteUrl: normalizeMetadataWebsiteUrl(options.testingWebsiteUrl) ??
        defaultCoinWebsiteUrl(mint),
      twitterUrl: normalizeMetadataTwitterUrl(options.testingTwitterUrl) ??
        normalizeMetadataTwitterUrl(launch.source_tweet_url),
      telegramUrl: normalizeMetadataTelegramUrl(options.testingTelegramUrl),
      testingMode: true,
    };
  }
  const website = normalizeMetadataWebsiteUrl(launch.metadata_website_url) ??
    defaultCoinWebsiteUrl(mint);
  const twitter = normalizeMetadataTwitterUrl(launch.metadata_twitter_url) ??
    normalizeMetadataTwitterUrl(launch.source_tweet_url);
  const telegram = normalizeMetadataTelegramUrl(launch.metadata_telegram_url);
  return {
    websiteUrl: website,
    twitterUrl: twitter,
    telegramUrl: telegram,
    testingMode: false,
  };
}

export function normalizeLaunchMetadataOverrides(input: {
  website?: unknown;
  twitter?: unknown;
  telegram?: unknown;
}): LaunchMetadataOverrides {
  return {
    websiteUrl: normalizeMetadataWebsiteUrl(input.website),
    twitterUrl: normalizeMetadataTwitterUrl(input.twitter),
    telegramUrl: normalizeMetadataTelegramUrl(input.telegram),
  };
}

export function normalizeMetadataWebsiteUrl(value: unknown): string | null {
  const text = cleanUrlText(value);
  if (!text) return null;
  const url = parseHttpUrl(text, { allowBareHost: true });
  if (!url) return null;
  return url.toString();
}

export function normalizeMetadataTwitterUrl(value: unknown): string | null {
  const text = cleanUrlText(value);
  if (!text) return null;
  const url = parseHttpUrl(text, { allowBareHost: true });
  if (!url) return null;
  const host = stripWww(url.hostname.toLowerCase());
  if (host !== "x.com" && host !== "twitter.com") return null;
  url.protocol = "https:";
  url.hostname = host;
  return url.toString();
}

export function normalizeMetadataTelegramUrl(value: unknown): string | null {
  const text = cleanUrlText(value);
  if (!text) return null;

  const url = parseHttpUrl(text, { allowBareHost: true });
  if (url) {
    const host = stripWww(url.hostname.toLowerCase());
    if (host !== "t.me" && host !== "telegram.me") return null;
    const path = normalizeTelegramPath(url.pathname);
    if (!path) return null;
    return `https://t.me/${path}`;
  }

  const handle = text.replace(/^@+/, "").trim();
  if (!/^[a-zA-Z0-9_]{3,64}$/.test(handle)) return null;
  return `https://t.me/${handle}`;
}

function parseHttpUrl(
  value: string,
  options: { allowBareHost: boolean },
): URL | null {
  const candidate = /^https?:\/\//i.test(value)
    ? value
    : options.allowBareHost && looksLikeBareHost(value)
    ? `https://${value}`
    : "";
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url;
  } catch (_) {
    return null;
  }
}

function looksLikeBareHost(value: string): boolean {
  return /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/:?#].*)?$/i.test(value);
}

function normalizeTelegramPath(pathname: string): string | null {
  const path = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!path) return null;
  if (path.startsWith("+")) return encodeTelegramPath(path);
  const [first] = path.split("/");
  if (!first || !/^[a-zA-Z0-9_]{3,64}$/.test(first)) return null;
  return first;
}

function encodeTelegramPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part).replace(/%2B/i, "+"))
    .join("/");
}

function cleanUrlText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^["'(<\[]+/, "")
    .replace(/[>"')\]]+$/, "")
    .replace(/[.,;:!?]+$/, "")
    .trim();
}

function stripWww(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}
