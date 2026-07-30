// deno-lint-ignore-file no-explicit-any

import type { LinkrToolResult } from "./linkr_types.ts";

export interface TerminalXSearchRequest {
  query: string;
  topic: string;
  reason: string;
}

const X_SEARCH_ACTION_RE =
  /\b(search|check|look up|look for|scan|find|read|research)\b/;
const X_CONTEXT_RE = /\b(x|twitter|ct|crypto twitter)\b/;
const PEOPLE_SAYING_RE =
  /\b(what are people saying|what people are saying|people saying about|what are they saying|what are folks saying|ct saying|social sentiment|socials saying)\b/;

export function isTerminalXSearchCapabilityQuestion(text: string): boolean {
  const normalized = normalizeForXSearch(text);
  if (!normalized) return false;
  const asksCapability =
    /\b(can|could|do|does|are you able to|able to|support|supports|possible)\b/
      .test(
        normalized,
      ) &&
    X_SEARCH_ACTION_RE.test(normalized) &&
    X_CONTEXT_RE.test(normalized);
  return asksCapability && !hasConcreteSearchTopic(text, normalized);
}

export function isTerminalXSearchRequest(text: string): boolean {
  const normalized = normalizeForXSearch(text);
  if (!normalized || isTerminalXSearchCapabilityQuestion(text)) return false;
  return (
    PEOPLE_SAYING_RE.test(normalized) ||
    /\b(what are people on (x|twitter) saying|what people on (x|twitter) are saying)\b/
      .test(normalized) ||
    /\b(what is (x|twitter) saying|what (is|are) (x|twitter) people saying)\b/
      .test(normalized) ||
    /\b((x|twitter|ct) sentiment|search (x|twitter|ct)|look on (x|twitter|ct)|check (x|twitter|ct))\b/
      .test(normalized) ||
    /\b(check|search|look up|look for|scan|find|research)\b.*\b(x|twitter|ct|posts?|mentions?|chatter)\b/
      .test(normalized) ||
    /\b(x|twitter|ct)\b.*\b(saying|sentiment|posts?|chatter|talking about|mentions?|narrative|takes?)\b/
      .test(normalized)
  );
}

export function buildTerminalXSearchRequest(
  text: string,
): TerminalXSearchRequest {
  const original = String(text ?? "").trim();
  const cashtag = firstCashtag(original);
  if (cashtag) {
    const clean = cashtag.toUpperCase();
    return {
      topic: `$${clean}`,
      query: truncateQuery(`$${clean} OR ${clean} -is:retweet`),
      reason: "cashtag",
    };
  }

  const address = firstAddress(original);
  if (address) {
    return {
      topic: shortTopic(address),
      query: truncateQuery(`${address} -is:retweet`),
      reason: "contract_or_mint",
    };
  }

  const handle = firstHandle(original);
  if (
    handle &&
    /\b(from|profile|account|posts?|posted|timeline|by)\b/i.test(original)
  ) {
    return {
      topic: `@${handle}`,
      query: truncateQuery(`from:${handle} -is:retweet`),
      reason: "profile_handle",
    };
  }
  if (handle) {
    return {
      topic: `@${handle}`,
      query: truncateQuery(`@${handle} -is:retweet`),
      reason: "handle_mention",
    };
  }

  const topic = extractPlainTopic(original);
  return {
    topic: topic ? truncate(topic, 48) : "that topic",
    query: topic ? truncateQuery(`${topic} -is:retweet`) : "",
    reason: topic ? "plain_topic" : "missing_topic",
  };
}

export function buildTerminalXSearchReply(args: {
  topic: string;
  query: string;
  recent: LinkrToolResult<{ posts: Array<Record<string, unknown>> }>;
  relevant: LinkrToolResult<{ posts: Array<Record<string, unknown>> }>;
}): {
  text: string;
  posts: Array<Record<string, unknown>>;
  sentiment: string;
} {
  const error = args.recent.error ?? args.relevant.error ?? null;
  if (!args.recent.ok && !args.relevant.ok) {
    return {
      posts: [],
      sentiment: "unknown",
      text: error === "missing_query_or_bearer"
        ? "I can search public X, but live X search is not configured in this terminal environment right now. Send a CA, mint, cashtag, handle, or X post URL and I can still help with the context I can access."
        : `I tried to search public X for ${args.topic}, but X did not return a clean result right now. Try a narrower cashtag, CA, mint, or profile handle and I will rerun it.`,
    };
  }

  const posts = dedupePosts([
    ...(args.relevant.facts.posts ?? []),
    ...(args.recent.facts.posts ?? []),
  ]);
  if (posts.length === 0) {
    return {
      posts,
      sentiment: "quiet",
      text:
        `I searched public X for ${args.topic} and did not find much recent/top chatter. That usually means the visible conversation is thin right now, so I would lean more on chart, liquidity, holders, and volume than social signal.`,
    };
  }

  const score = scorePosts(posts);
  const keywords = extractKeywords(posts).slice(0, 5);
  const sentiment = score.total >= 2
    ? "bullish"
    : score.total <= -2
    ? "cautious"
    : score.positive > 0 && score.negative > 0
    ? "mixed"
    : "neutral/mixed";
  const theme = score.negative > score.positive
    ? "risk and skepticism are showing up more than hype"
    : score.positive > score.negative
    ? "hype and interest are showing up more than skepticism"
    : "there is not a strong consensus in the visible posts";
  const keywordLine = keywords.length
    ? ` Recurring terms: ${keywords.join(", ")}.`
    : "";
  return {
    posts,
    sentiment,
    text:
      `${args.topic} X read: ${sentiment}. I checked ${posts.length} public post${
        posts.length === 1 ? "" : "s"
      } across recent/top search; ${theme}.${keywordLine} Treat this as noisy public social context, not a buy/sell signal.`,
  };
}

export function xSearchPostsToItems(posts: Array<Record<string, unknown>>) {
  return posts.slice(0, 8).map((post) => {
    const id = String(post.id ?? "");
    return {
      id,
      entity_type: "x_post",
      label: id ? `X post ${id}` : "X post",
      url: id ? `https://x.com/i/web/status/${id}` : null,
      text: String(post.text ?? "").slice(0, 280),
      created_at: post.created_at ?? null,
      public_metrics: post.public_metrics ?? null,
    };
  });
}

function normalizeForXSearch(text: string): string {
  return String(text ?? "")
    .replace(/https?:\/\/\S+/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9_$@' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasConcreteSearchTopic(original: string, normalized: string): boolean {
  if (
    firstCashtag(original) || firstAddress(original) || firstHandle(original)
  ) return true;
  return /\b(for|about|around|on)\s+[$@]?[a-z0-9][a-z0-9_ -]{1,60}$/i.test(
    normalized,
  );
}

function firstCashtag(text: string): string | null {
  const match = String(text ?? "").match(/\$([A-Za-z][A-Za-z0-9_]{1,15})/);
  return match?.[1]?.toUpperCase() ?? null;
}

function firstHandle(text: string): string | null {
  const handles = [...String(text ?? "").matchAll(/@([A-Za-z0-9_]{1,15})/g)]
    .map((match) => match[1])
    .filter((handle) => !/^linkrbot$/i.test(handle));
  return handles[0] ?? null;
}

function firstAddress(text: string): string | null {
  const evm = String(text ?? "").match(/\b0x[a-fA-F0-9]{40}\b/);
  if (evm) return evm[0];
  const sol = String(text ?? "").match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
  return sol?.[0] ?? null;
}

function extractPlainTopic(text: string): string {
  const afterTopicMarker = String(text ?? "").match(
    /\b(?:about|for|around|on)\s+(.+?)\s*$/i,
  )?.[1];
  const candidate = afterTopicMarker ?? text;
  return candidate
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@\w+/g, " ")
    .replace(
      /\b(please|pls|can you|could you|check|search|look up|look for|scan|find|research|public|live|recent|top|posts?|mentions?|x|twitter|ct|people|saying|say|about|what|are|is|the|and|let me know|tell me|sentiment|chatter|narrative|takes?)\b/gi,
      " ",
    )
    .replace(/[^a-zA-Z0-9_$@.' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateQuery(query: string): string {
  return truncate(query.replace(/\s+/g, " ").trim(), 240);
}

function truncate(value: string, limit: number): string {
  const text = String(value ?? "").trim();
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + "…" : text;
}

function shortTopic(value: string): string {
  return value.length > 16
    ? `${value.slice(0, 8)}...${value.slice(-6)}`
    : value;
}

function dedupePosts(posts: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const post of posts) {
    const key = String(post.id ?? post.text ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(post);
  }
  return out;
}

function scorePosts(posts: Array<Record<string, unknown>>) {
  const positive =
    /\b(bull|bullish|send|sent|moon|based|gem|ape|buying|accumulate|strong|breakout|pump|cooking|green)\b/i;
  const negative =
    /\b(bear|bearish|scam|rug|dump|dead|avoid|warning|red flag|down|rekt|sell|sold|exit|caution)\b/i;
  let pos = 0;
  let neg = 0;
  for (const post of posts) {
    const text = String(post.text ?? "");
    if (positive.test(text)) pos++;
    if (negative.test(text)) neg++;
  }
  return { positive: pos, negative: neg, total: pos - neg };
}

function extractKeywords(posts: Array<Record<string, unknown>>): string[] {
  const blocked = new Set([
    "about",
    "after",
    "again",
    "also",
    "ansem",
    "because",
    "being",
    "check",
    "crypto",
    "from",
    "have",
    "just",
    "like",
    "linkr",
    "people",
    "posts",
    "saying",
    "search",
    "that",
    "their",
    "there",
    "this",
    "twitter",
    "what",
    "with",
  ]);
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (
      const raw of String(post.text ?? "").toLowerCase().match(
        /\b[a-z][a-z0-9_]{3,18}\b/g,
      ) ?? []
    ) {
      if (blocked.has(raw)) continue;
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word);
}
