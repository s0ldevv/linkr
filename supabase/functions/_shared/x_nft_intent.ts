import {
  classifyNftCommandWithAi,
  parseXNftCommand,
  type XNftCommand,
} from "./x_nft_command.ts";

export type XNftChain = "solana" | "robinhood";
export type XNftIntentKind =
  | "nft_guidance"
  | "create_collection"
  | "mint_nft"
  | "none";
export type XNftIntentConfidence = "low" | "medium" | "high";
export type XNftMissingField =
  | "chain"
  | "collection"
  | "name"
  | "symbol"
  | "image";

export interface XNftIntent {
  intent: XNftIntentKind;
  executionIntent: boolean;
  chain: XNftChain | null;
  missingFields: XNftMissingField[];
  collectionQuery: string | null;
  collectionId: string | null;
  collectionName: string | null;
  nftName: string | null;
  name: string | null;
  symbol: string | null;
  description: string | null;
  websiteUrl: string | null;
  twitterUrl: string | null;
  telegramUrl: string | null;
  confidence: XNftIntentConfidence;
  reason: string | null;
}

export type XNftDraftFields = {
  kind?: "create_collection" | "mint_nft";
  chain?: XNftChain;
  collection_query?: string;
  collection_id?: string;
  collection_name?: string;
  nft_name?: string;
  name?: string;
  symbol?: string;
  description?: string;
  website_url?: string;
  twitter_url?: string;
  telegram_url?: string;
  tweet_id?: string;
  media_tweet_id?: string;
};

export interface NftCollectionChoice {
  id: string;
  name: string;
  symbol: string | null;
  mint_address: string | null;
  created_at?: string | null;
  match_kind?: string | null;
}

export function emptyNftIntent(
  reason = "no_nft_intent",
): XNftIntent {
  return {
    intent: "none",
    executionIntent: false,
    chain: null,
    missingFields: [],
    collectionQuery: null,
    collectionId: null,
    collectionName: null,
    nftName: null,
    name: null,
    symbol: null,
    description: null,
    websiteUrl: null,
    twitterUrl: null,
    telegramUrl: null,
    confidence: "low",
    reason,
  };
}

export function parseXNftIntent(rawText: string): XNftIntent {
  const original = String(rawText ?? "");
  const text = stripNoise(original);
  if (!text) return emptyNftIntent("empty");
  const chain = detectNftChain(text);

  if (isNftGuidanceQuestion(text)) {
    return {
      ...emptyNftIntent("nft_guidance_question"),
      intent: "nft_guidance",
      chain,
      confidence: "high",
    };
  }

  const parsed = parseXNftCommand(text);
  if (parsed) return intentFromCommand(parsed, chain, "high", "command_parser");

  if (!mentionsNftOrCollection(text) || !hasNftActionVerb(text)) {
    return emptyNftIntent("no_executable_nft_signal");
  }

  if (/\bcollection\b/i.test(text)) {
    const name = extractCollectionName(text);
    const symbol = extractSymbol(text) ?? deriveSymbol(name ?? "");
    return {
      ...emptyNftIntent("collection_launch_intent"),
      intent: "create_collection",
      executionIntent: true,
      chain,
      missingFields: [
        ...(chain ? [] : ["chain" as const]),
        ...(name ? [] : ["name" as const]),
      ],
      name,
      symbol: symbol || null,
      description: extractDescription(text),
      websiteUrl: extractUrl(text, "website") ?? extractUrl(text, "site"),
      twitterUrl: extractTwitter(text),
      telegramUrl: extractUrl(text, "telegram") ?? extractUrl(text, "tg"),
      confidence: name ? "high" : "medium",
    };
  }

  const collectionQuery = extractMintCollectionQuery(text);
  return {
    ...emptyNftIntent("single_nft_launch_intent"),
    intent: "mint_nft",
    executionIntent: true,
    chain,
    missingFields: [
      ...(chain ? [] : ["chain" as const]),
      ...(collectionQuery ? [] : ["collection" as const]),
    ],
    collectionQuery,
    nftName: extractNftName(text),
    confidence: collectionQuery ? "high" : "medium",
  };
}

export async function classifyXNftIntentWithAi(
  rawText: string,
): Promise<XNftIntent> {
  const deterministic = parseXNftIntent(rawText);
  if (
    deterministic.intent !== "none" ||
    deterministic.reason === "nft_guidance_question"
  ) {
    return deterministic;
  }
  if (!looksLikePotentialNftIntent(rawText)) return deterministic;

  const command = await classifyNftCommandWithAi(rawText);
  if (!command) return deterministic;
  return intentFromCommand(
    command,
    detectNftChain(rawText),
    "medium",
    "ai_command_classifier",
  );
}

export function mergeNftIntentIntoFields(
  existing: XNftDraftFields,
  intent: XNftIntent,
  tweetId: string,
): XNftDraftFields {
  const next: XNftDraftFields = { ...existing };
  if (intent.intent === "create_collection" || intent.intent === "mint_nft") {
    next.kind = intent.intent;
  }
  if (intent.chain) next.chain = intent.chain;
  if (intent.collectionQuery) next.collection_query = intent.collectionQuery;
  if (intent.collectionId) next.collection_id = intent.collectionId;
  if (intent.collectionName) next.collection_name = intent.collectionName;
  if (intent.nftName) next.nft_name = intent.nftName;
  if (intent.name) next.name = intent.name;
  if (intent.symbol) next.symbol = intent.symbol;
  if (intent.description) next.description = intent.description;
  if (intent.websiteUrl) next.website_url = intent.websiteUrl;
  if (intent.twitterUrl) next.twitter_url = intent.twitterUrl;
  if (intent.telegramUrl) next.telegram_url = intent.telegramUrl;
  if (tweetId) next.tweet_id = tweetId;
  return normalizeNftFields(next);
}

export function mergeNftFollowupIntoFields(
  existing: XNftDraftFields,
  rawText: string,
  requiredFields: string[] = [],
  tweetId?: string,
): XNftDraftFields {
  const text = stripNoise(rawText);
  const next: XNftDraftFields = { ...existing };
  const chain = detectNftChain(text);
  if (chain) next.chain = chain;

  const command = parseXNftCommand(text);
  if (command) {
    return mergeNftIntentIntoFields(
      next,
      intentFromCommand(
        command,
        chain ?? next.chain ?? null,
        "high",
        "followup_command",
      ),
      tweetId ?? next.tweet_id ?? "",
    );
  }

  const required = new Set(requiredFields);
  if (required.has("collection")) {
    const collection = extractMintCollectionQuery(text) ??
      cleanFreeformSelection(text);
    if (collection) next.collection_query = collection;
  }
  if (required.has("name")) {
    const name = extractCollectionName(text) ?? cleanFreeformSelection(text);
    if (name) {
      next.name = name;
      next.symbol = next.symbol ?? deriveSymbol(name);
    }
  }
  if (tweetId) next.tweet_id = tweetId;
  return normalizeNftFields(next);
}

export function normalizeNftFields(
  fields: XNftDraftFields,
): XNftDraftFields {
  const next: XNftDraftFields = {};
  if (fields.kind === "create_collection" || fields.kind === "mint_nft") {
    next.kind = fields.kind;
  }
  if (fields.chain === "solana" || fields.chain === "robinhood") {
    next.chain = fields.chain;
  }
  const collectionQuery = cleanText(fields.collection_query, 80);
  if (collectionQuery) next.collection_query = collectionQuery;
  const collectionId = cleanText(fields.collection_id, 80);
  if (collectionId) next.collection_id = collectionId;
  const collectionName = cleanText(fields.collection_name, 80);
  if (collectionName) next.collection_name = collectionName;
  const nftName = cleanText(fields.nft_name, 32);
  if (nftName) next.nft_name = nftName;
  const name = cleanText(fields.name, 32);
  if (name) next.name = name;
  const symbol = cleanText(fields.symbol, 10).replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  if (symbol) next.symbol = symbol;
  const description = cleanText(fields.description, 512);
  if (description) next.description = description;
  const website = cleanUrl(fields.website_url);
  if (website) next.website_url = website;
  const twitter = cleanUrl(fields.twitter_url);
  if (twitter) next.twitter_url = twitter;
  const telegram = cleanUrl(fields.telegram_url);
  if (telegram) next.telegram_url = telegram;
  const tweetId = cleanText(fields.tweet_id, 64);
  if (tweetId) next.tweet_id = tweetId;
  const mediaTweetId = cleanText(fields.media_tweet_id, 64);
  if (mediaTweetId) next.media_tweet_id = mediaTweetId;
  if (next.kind === "create_collection" && next.name && !next.symbol) {
    next.symbol = deriveSymbol(next.name);
  }
  return next;
}

export function nftFieldsToCommand(
  fields: XNftDraftFields,
): XNftCommand | null {
  const normalized = normalizeNftFields(fields);
  if (normalized.kind === "create_collection") {
    if (!normalized.name) return null;
    const symbol = normalized.symbol ?? deriveSymbol(normalized.name);
    if (!symbol) return null;
    return {
      kind: "create_collection",
      name: normalized.name,
      symbol,
      description: normalized.description ?? null,
      websiteUrl: normalized.website_url ?? null,
      twitterUrl: normalized.twitter_url ?? null,
      telegramUrl: normalized.telegram_url ?? null,
    };
  }
  if (normalized.kind === "mint_nft") {
    const collectionQuery = normalized.collection_id ??
      normalized.collection_query ??
      normalized.collection_name;
    if (!collectionQuery) return null;
    return {
      kind: "mint_nft",
      collectionQuery,
      collectionId: normalized.collection_id ?? null,
      name: normalized.nft_name ?? null,
    };
  }
  return null;
}

export function requiredNftFields(fields: XNftDraftFields): XNftMissingField[] {
  const normalized = normalizeNftFields(fields);
  const missing: XNftMissingField[] = [];
  if (!normalized.chain) missing.push("chain");
  if (normalized.chain === "robinhood") return missing;
  if (normalized.kind === "create_collection") {
    if (!normalized.name) missing.push("name");
    return missing;
  }
  if (normalized.kind === "mint_nft") {
    if (!normalized.collection_id) missing.push("collection");
    return missing;
  }
  missing.push("name");
  return missing;
}

export function isExplicitNftConfirmation(text: string): boolean {
  return /^\s*(?:@\w+\s+)*(?:yes[,]?\s*)?(?:confirm|approve)\s+(?:the\s+)?(?:nft|mint|collection)[.!\s]*$/i
    .test(text);
}

export function isExplicitNftCancellation(text: string): boolean {
  return /^\s*(?:@\w+\s+)*(?:cancel|reject|stop)\s+(?:the\s+)?(?:nft|mint|collection)[.!\s]*$/i
    .test(text);
}

export function isBareConfirmation(text: string): boolean {
  return /^\s*(?:@\w+\s+)*(?:yes[,]?\s*)?(?:confirm|approve)[.!\s]*$/i
    .test(text);
}

export function isBareCancellation(text: string): boolean {
  return /^\s*(?:@\w+\s+)*(?:cancel|reject|stop)[.!\s]*$/i.test(text);
}

export function isNftActionType(value: unknown): value is
  | "nft_mint"
  | "nft_create_collection" {
  return value === "nft_mint" || value === "nft_create_collection";
}

export function nftConfirmationPhrase(actionType: string): string {
  return actionType === "nft_create_collection"
    ? "confirm collection"
    : "confirm nft";
}

export function nftSummary(fields: XNftDraftFields): string {
  const normalized = normalizeNftFields(fields);
  if (normalized.kind === "create_collection") {
    return `Create Solana NFT collection ${normalized.name ?? "collection"}`;
  }
  return `Mint NFT into ${
    normalized.collection_name ?? normalized.collection_query ?? "collection"
  }`;
}

function intentFromCommand(
  command: XNftCommand,
  chain: XNftChain | null,
  confidence: XNftIntentConfidence,
  reason: string,
): XNftIntent {
  if (command.kind === "create_collection") {
    return {
      ...emptyNftIntent(reason),
      intent: "create_collection",
      executionIntent: true,
      chain,
      missingFields: chain ? [] : ["chain"],
      name: command.name,
      symbol: command.symbol,
      description: command.description ?? null,
      websiteUrl: command.websiteUrl ?? null,
      twitterUrl: command.twitterUrl ?? null,
      telegramUrl: command.telegramUrl ?? null,
      confidence,
    };
  }
  return {
    ...emptyNftIntent(reason),
    intent: "mint_nft",
    executionIntent: true,
    chain,
    missingFields: [
      ...(chain ? [] : ["chain" as const]),
      ...(command.collectionQuery || command.collectionId
        ? []
        : ["collection" as const]),
    ],
    collectionQuery: command.collectionQuery,
    collectionId: command.collectionId ?? null,
    nftName: command.name ?? null,
    confidence,
  };
}

function detectNftChain(rawText: string): XNftChain | null {
  const text = String(rawText ?? "").toLowerCase();
  const hasSolana = /\b(?:solana|sol)\b/.test(text);
  const hasRobinhood = /\brobinhood(?:\s+chain)?\b/.test(text);
  if (hasSolana && !hasRobinhood) return "solana";
  if (hasRobinhood && !hasSolana) return "robinhood";
  return null;
}

function isNftGuidanceQuestion(text: string): boolean {
  const cleaned = stripNoise(text).toLowerCase();
  if (!mentionsNftOrCollection(cleaned)) return false;
  if (
    /\bhow\b/.test(cleaned) ||
    /\bwhat\b[\s\S]{0,80}\b(?:need|required|require|steps?)\b/.test(
      cleaned,
    ) ||
    /\b(?:steps|guide|explain|walk\s+me\s+through)\b/.test(cleaned)
  ) {
    return true;
  }
  if (
    /\b(?:can|could|would)\s+you\s+(?:launch|mint|create|deploy|drop)\b/.test(
      cleaned,
    )
  ) {
    return false;
  }
  if (
    /\b(?:please\s+)?(?:launch|mint|create|deploy|drop)\s+(?:this\s+|an?\s+)?(?:nft|collection)\b/
      .test(cleaned)
  ) {
    return false;
  }
  return /\b(?:where|when|why)\b/.test(cleaned) ||
    /\b(?:can|could|do)\s+i\b/.test(cleaned) ||
    /\b(?:tell|show)\s+me\b/.test(cleaned) ||
    /\b(?:need\s+to|works?)\b/.test(cleaned);
}

function looksLikePotentialNftIntent(text: string): boolean {
  const cleaned = stripNoise(text);
  return mentionsNftOrCollection(cleaned) && hasNftActionVerb(cleaned);
}

function mentionsNftOrCollection(text: string): boolean {
  return /\b(?:nft|non[- ]?fungible|collection)\b/i.test(text);
}

function hasNftActionVerb(text: string): boolean {
  return /\b(?:mint|create|launch|deploy|drop|make)\b/i.test(text);
}

function extractCollectionName(text: string): string | null {
  return firstMatch(text, [
    /\bcollection\s+(?:called|named|titled)\s+["']([^"']{1,80})["']/i,
    /\b(?:called|named|titled)\s+["']([^"']{1,80})["']/i,
    /\bcollection\s+(?:called|named|titled)\s+([^,.!?]{1,80}?)(?=\s+(?:with|symbol|ticker|description|desc|on|for)\b|[,.!?]|$)/i,
    /\b(?:called|named|titled)\s+([^,.!?]{1,80}?)(?=\s+(?:with|symbol|ticker|description|desc|on|for)\b|[,.!?]|$)/i,
  ])?.slice(0, 32) ?? null;
}

function extractNftName(text: string): string | null {
  return firstMatch(text, [
    /\b(?:nft\s+)?(?:called|named|titled)\s+["']([^"']{1,80})["']/i,
    /\b(?:nft\s+)?(?:called|named|titled)\s+([^,.!?]{1,80}?)(?=\s+(?:in|into|to|on|for)\b|[,.!?]|$)/i,
  ])?.slice(0, 32) ?? null;
}

function extractMintCollectionQuery(text: string): string | null {
  const match = text.match(
    /\b(?:in|into|to)\s+(?:my\s+)?(?:existing\s+)?(?:nft\s+)?(?:collection\s+)?["']?([^"',.!?]{1,100})/i,
  );
  if (!match?.[1]) return null;
  const stripped = stripTrailingClauses(match[1]);
  if (!stripped || /^(?:solana|robinhood|it|that|this)$/i.test(stripped)) {
    return null;
  }
  return stripped.slice(0, 80);
}

function extractSymbol(text: string): string | null {
  return firstMatch(text, [
    /\b(?:symbol|ticker)\s*(?:is|=|:)?\s*\$?([A-Za-z0-9]{1,10})\b/i,
    /\$([A-Za-z][A-Za-z0-9]{1,9})\b/i,
  ])?.replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toUpperCase() ?? null;
}

function extractDescription(text: string): string | null {
  return firstMatch(text, [
    /\bdescription\s*(?:is|=|:)?\s*["']([^"']{1,512})["']/i,
    /\bdesc\s*(?:is|=|:)?\s*["']([^"']{1,512})["']/i,
  ])?.slice(0, 512) ?? null;
}

function extractUrl(text: string, keyword: string): string | null {
  const rx = new RegExp(
    `${keyword}\\s*(?:=|:)?\\s*(https?:\\/\\/[^\\s<>"']+)`,
    "i",
  );
  const match = text.match(rx);
  return cleanUrl(match?.[1] ?? null);
}

function extractTwitter(text: string): string | null {
  const url = text.match(
    /(?:twitter|x)\s*(?:=|:)?\s*(https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s]+)/i,
  );
  if (url?.[1]) return cleanUrl(url[1]);
  const handle = text.match(
    /(?:twitter|x)\s*(?:=|:)?\s*@([A-Za-z0-9_]{1,15})/i,
  );
  return handle?.[1] ? `https://x.com/${handle[1]}` : null;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return cleanText(stripTrailingClauses(value), 120);
  }
  return null;
}

function cleanFreeformSelection(text: string): string | null {
  const cleaned = stripTrailingClauses(stripNoise(text))
    .replace(/^["']|["']$/g, "")
    .trim();
  if (!cleaned || cleaned.length > 80) return null;
  if (/^(?:yes|no|confirm|cancel|solana|robinhood)$/i.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function stripTrailingClauses(value: string): string {
  return cleanText(value, 120)
    .replace(/\s+on\s+(?:solana|sol|robinhood(?:\s+chain)?)\b.*$/i, "")
    .replace(/\s+(?:please|pls|now|thanks?|for\s+me)\b.*$/i, "")
    .replace(/\s+(?:with|using)\s+.*$/i, "")
    .trim();
}

function stripNoise(text: string): string {
  return String(text ?? "")
    .replace(/@[A-Za-z0-9_]{1,15}/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanUrl(value: unknown): string | null {
  const text = cleanText(value, 300);
  return /^https?:\/\//i.test(text) ? text : null;
}

function deriveSymbol(name: string): string {
  return String(name ?? "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 10)
    .toUpperCase();
}
