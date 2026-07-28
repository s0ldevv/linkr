// deno-lint-ignore-file no-explicit-any
// Fetch nested X thread context from a leaf tweet up to its root (max depth 10).

import { extractFromText } from "./extract.ts";

const X_TWEETS = "https://api.twitter.com/2/tweets";
const MAX_DEPTH = 10;

export interface ThreadContext {
  root_tweet: any | null;
  parent_chain: any[];
  bot_mention_tweet: any;
  flattened_context: string;
  detected_mints: string[];
  detected_symbols: string[];
  detected_urls: string[];
  detected_media_urls: string[];
}

async function fetchTweet(id: string, bearer: string): Promise<any | null> {
  const params = new URLSearchParams({
    ids: id,
    "tweet.fields": "id,text,author_id,created_at,conversation_id,attachments,referenced_tweets",
    "user.fields": "id,username,name",
    "media.fields": "media_key,type,url,preview_image_url",
    expansions: "author_id,attachments.media_keys,referenced_tweets.id",
  });
  const res = await fetch(`${X_TWEETS}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (!res.ok) return null;
  const body = await res.json();
  const tw = body.data?.[0];
  if (!tw) return null;
  const users: any[] = body.includes?.users ?? [];
  const media: any[] = body.includes?.media ?? [];
  tw._user = users.find((u) => u.id === tw.author_id) ?? null;
  tw._media = (tw.attachments?.media_keys ?? [])
    .map((k: string) => media.find((m) => m.media_key === k))
    .filter(Boolean);
  return tw;
}

export async function fetchThreadContext(rootTweet: any): Promise<ThreadContext> {
  const bearer = Deno.env.get("X_BEARER_TOKEN");
  const out: ThreadContext = {
    root_tweet: null,
    parent_chain: [],
    bot_mention_tweet: rootTweet,
    flattened_context: rootTweet?.text ?? "",
    detected_mints: [],
    detected_symbols: [],
    detected_urls: [],
    detected_media_urls: [],
  };
  if (!bearer) return finalize(out);

  let current = rootTweet;
  let depth = 0;
  while (depth < MAX_DEPTH) {
    const ref: any[] = current.referenced_tweets ?? [];
    const parentRef =
      ref.find((r) => r.type === "replied_to") ?? ref.find((r) => r.type === "quoted");
    if (!parentRef?.id) break;
    const parent = await fetchTweet(parentRef.id, bearer);
    if (!parent) break;
    out.parent_chain.push(parent);
    current = parent;
    depth++;
  }
  out.root_tweet = out.parent_chain[out.parent_chain.length - 1] ?? null;

  return finalize(out);
}

function finalize(ctx: ThreadContext): ThreadContext {
  const allTweets = [...ctx.parent_chain, ctx.bot_mention_tweet];
  const mints = new Set<string>();
  const symbols = new Set<string>();
  const urls = new Set<string>();
  const mediaUrls = new Set<string>();
  const parts: string[] = [];
  for (const t of allTweets) {
    if (!t) continue;
    const e = extractFromText(t.text ?? "");
    e.mints.forEach((m) => mints.add(m));
    e.symbols.forEach((s) => symbols.add(s));
    e.urls.forEach((u) => urls.add(u));
    for (const m of t._media ?? []) {
      const url = m.url ?? m.preview_image_url;
      if (url) mediaUrls.add(url);
    }
    const author = t._user?.username ? `@${t._user.username}` : t.author_id;
    parts.push(`[${author}]: ${t.text ?? ""}`);
  }
  ctx.detected_mints = [...mints];
  ctx.detected_symbols = [...symbols];
  ctx.detected_urls = [...urls];
  ctx.detected_media_urls = [...mediaUrls];
  ctx.flattened_context = parts.join("\n");
  return ctx;
}
