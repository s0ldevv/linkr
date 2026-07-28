import { LINKR_ROUTE_NAMES } from "./linkr_route_decision.ts";
import { getRouteResourceBundle } from "./linkr_route_resources.ts";
import { resolveEntitiesFromText, resolvePronounReference } from "./linkr_entities.ts";
import { createFact } from "./linkr_fact_ledger.ts";
import type { LinkrWorkingFrame, LinkrWorldState } from "./linkr_types.ts";

export function buildLinkrWorkingFrame(world: LinkrWorldState): LinkrWorkingFrame {
  const tweetText = String(world.tweet.text ?? "");
  const tweetId = String(world.tweet.tweet_id ?? "");
  const current = resolveEntitiesFromText({
    text: tweetText,
    source: "current_tweet",
    privacy: "public",
  });
  const threadText = String(world.thread_context?.flattened_context ?? "");
  const thread = resolveEntitiesFromText({
    text: threadText,
    source: "thread_context",
    privacy: "public",
  });
  const priorEntities = readPriorEntities(world.active_state);
  const pronoun = resolvePronounReference(tweetText, [...current.entities, ...thread.entities, ...priorEntities]);
  const factLedger = [
    createFact({
      source: "current_tweet",
      privacy: "public",
      summary: `User asked: ${tweetText.slice(0, 220)}`,
      value: tweetText,
      confidence: 1,
    }),
    ...current.facts,
    ...thread.facts,
  ];

  return {
    frame_id: `frame:${tweetId}`,
    tweet_id: tweetId,
    user_ask: tweetText,
    resolved_references: pronoun ? [pronoun] : [],
    entity_ledger: dedupeEntities([...current.entities, ...thread.entities, ...priorEntities]),
    fact_ledger: dedupeFacts(factLedger),
    route_resources: LINKR_ROUTE_NAMES.map(getRouteResourceBundle),
    selected_route: null,
    constraints: {
      public_reply: true,
      value_moving_requires_confirmation: true,
      no_private_cross_user_data: true,
      max_reply_chars: 260,
    },
  };
}

function readPriorEntities(activeState: Record<string, unknown> | null): LinkrWorkingFrame["entity_ledger"] {
  const raw = activeState?.active_entities;
  return Array.isArray(raw) ? raw.filter((item) => item && typeof item === "object") as never : [];
}

function dedupeEntities<T extends { id: string }>(entities: T[]): T[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    if (seen.has(entity.id)) return false;
    seen.add(entity.id);
    return true;
  });
}

function dedupeFacts<T extends { id: string }>(facts: T[]): T[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    if (seen.has(fact.id)) return false;
    seen.add(fact.id);
    return true;
  });
}
