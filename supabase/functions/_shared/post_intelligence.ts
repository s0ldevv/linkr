import { createFact } from "./linkr_fact_ledger.ts";
import { resolveEntitiesFromText } from "./linkr_entities.ts";
import type { LinkrToolResult } from "./linkr_types.ts";

export function summarizePostIntelligence(args: {
  tweet_id: string;
  text?: string | null;
  flattened_context?: string | null;
  media_urls?: string[];
}): LinkrToolResult<{
  summary: string;
  entities: unknown[];
  facts: unknown[];
  media_summaries: string[];
}> {
  const text = [args.flattened_context, args.text].filter(Boolean).join("\n").trim();
  const resolved = resolveEntitiesFromText({ text, source: "post_intelligence", privacy: "public" });
  const media = (args.media_urls ?? []).slice(0, 4).map((url, index) => `Image ${index + 1}: ${url}`);
  const summary = text
    ? text.replace(/\s+/g, " ").slice(0, 600)
    : media.length
      ? "Post contains media but no text context was available."
      : "No post text or media context was available.";
  const facts = [
    createFact({
      source: "post_intelligence",
      privacy: "public",
      summary,
      value: { tweet_id: args.tweet_id },
      confidence: text ? 0.75 : 0.35,
    }),
    ...resolved.facts,
  ];
  return {
    tool: "post.explain",
    ok: true,
    facts: { summary, entities: resolved.entities, facts, media_summaries: media },
    summary,
    freshness: "live",
    confidence: text ? 0.75 : 0.35,
    privacy: "public",
    redactions: [],
    answerable: Boolean(text || media.length),
  };
}
