// deno-lint-ignore-file no-explicit-any
// Deterministic reference resolution for channel-neutral Linkr turns.

import { normalizeMarketAddress } from "./market_data/chains.ts";

export interface ResolvedReference {
  entity_type: string;
  entity_id: string;
  label: string;
  value: Record<string, unknown>;
  surface_source: string;
  source_ref_id?: string | null;
  confidence: number;
  reason: string;
  privacy_label: string;
  freshness: "current" | "recent" | "stale" | "unknown";
}

export interface ReferenceResolutionInput {
  text: string;
  active_entities?: any[];
  source_refs?: any[];
  recent_messages?: any[];
  pending_actions?: any[];
  drafts?: any[];
}

const SOLANA_ADDRESS_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const EVM_ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/g;
const X_STATUS_RE = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/\s]+\/status\/(\d+)/gi;

export function extractImmediateReferences(text: string): ResolvedReference[] {
  const refs: ResolvedReference[] = [];
  for (const match of text.matchAll(EVM_ADDRESS_RE)) {
    const normalized = normalizeMarketAddress(match[0]);
    if (!normalized) continue;
    refs.push({
      entity_type: "token",
      entity_id: normalized.address,
      label: shortAddress(normalized.address),
      value: { address: normalized.address, chain: normalized.chain },
      surface_source: "current_message",
      confidence: 0.98,
      reason: "explicit EVM address in current message",
      privacy_label: "external_untrusted",
      freshness: "current",
    });
  }
  for (const match of text.matchAll(SOLANA_ADDRESS_RE)) {
    const normalized = normalizeMarketAddress(match[0]);
    if (!normalized || normalized.chain !== "solana") continue;
    refs.push({
      entity_type: "token",
      entity_id: normalized.address,
      label: shortAddress(normalized.address),
      value: { address: normalized.address, chain: normalized.chain },
      surface_source: "current_message",
      confidence: 0.92,
      reason: "explicit Solana address in current message",
      privacy_label: "external_untrusted",
      freshness: "current",
    });
  }
  for (const match of text.matchAll(X_STATUS_RE)) {
    refs.push({
      entity_type: "x_post",
      entity_id: match[1],
      label: "X post " + match[1],
      value: { tweet_id: match[1], url: match[0] },
      surface_source: "current_message",
      confidence: 0.98,
      reason: "explicit X status URL in current message",
      privacy_label: "external_untrusted",
      freshness: "current",
    });
  }
  return uniqueRefs(refs);
}

export function resolveReferences(input: ReferenceResolutionInput): {
  refs: ResolvedReference[];
  ambiguity: string | null;
} {
  const text = input.text.toLowerCase();
  const refs = extractImmediateReferences(input.text);

  const activeToken = latestEntity(input.active_entities, "token") ?? latestSourceRef(input.source_refs, "token");
  const activePost = latestEntity(input.active_entities, "x_post") ?? latestSourceRef(input.source_refs, "x_post");
  const pending = (input.pending_actions ?? []).filter((row) => row?.status === "pending");

  if (/\b(that token|this token|same token|it)\b/.test(text) && activeToken) {
    refs.push(entityToResolved(activeToken, "token", "referenced active token"));
  }
  if (/\b(that post|this post|same post)\b/.test(text) && activePost) {
    refs.push(entityToResolved(activePost, "x_post", "referenced active X post"));
  }
  if (/\b(confirm it|confirm that|confirm)\b/.test(text)) {
    if (pending.length === 1) refs.push(entityToResolved(pending[0], "pending_action", "exactly one pending action in scope"));
    if (pending.length > 1) {
      return {
        refs: uniqueRefs(refs),
        ambiguity: "You have multiple pending actions. Which one should I confirm?",
      };
    }
  }
  if (/\b(cancel it|cancel that|cancel)\b/.test(text)) {
    if (pending.length === 1) refs.push(entityToResolved(pending[0], "pending_action", "exactly one pending action in scope"));
    if (pending.length > 1) {
      return {
        refs: uniqueRefs(refs),
        ambiguity: "You have multiple pending actions. Which one should I cancel?",
      };
    }
  }
  if (/\b(the second one|second one)\b/.test(text)) {
    const ordered = latestOrderedResult(input.recent_messages);
    if (ordered?.[1]) refs.push(entityToResolved(ordered[1], "ordered_result", "second item from the previous assistant result"));
    else {
      return {
        refs: uniqueRefs(refs),
        ambiguity: "I do not have a clear second item in this conversation yet.",
      };
    }
  }
  if (/\b(use the same image|same image)\b/.test(text)) {
    const media = latestEntity(input.active_entities, "media") ?? latestSourceRef(input.source_refs, "media");
    if (media) refs.push(entityToResolved(media, "media", "referenced active image/media"));
    else {
      return {
        refs: uniqueRefs(refs),
        ambiguity: "I do not have an image in this conversation yet. Send an image or X post URL first.",
      };
    }
  }

  return { refs: uniqueRefs(refs), ambiguity: null };
}

function latestEntity(items: any[] | undefined, kind: string) {
  const list = Array.isArray(items) ? items : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];
    if (String(item?.kind ?? item?.entity_type ?? item?.ref_type ?? "") === kind) return item;
  }
  return null;
}

function latestSourceRef(items: any[] | undefined, kind: string) {
  const list = Array.isArray(items) ? items : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];
    if (String(item?.ref_type ?? item?.entity_type ?? item?.kind ?? "") === kind) return item;
  }
  return null;
}

function latestOrderedResult(messages: any[] | undefined): any[] | null {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const parts = Array.isArray(list[i]?.parts) ? list[i].parts : [];
    for (const part of parts) {
      const items = (part as any)?.items;
      if (Array.isArray(items) && items.length > 0) return items;
    }
  }
  return null;
}

function entityToResolved(value: any, fallbackType: string, reason: string): ResolvedReference {
  const entityType = String(value?.entity_type ?? value?.kind ?? value?.ref_type ?? fallbackType);
  const entityId = String(
    value?.entity_id ??
      value?.id ??
      value?.ref_key ??
      value?.token_address ??
      value?.mint ??
      value?.address ??
      entityType,
  );
  return {
    entity_type: entityType,
    entity_id: entityId,
    label: String(value?.label ?? value?.summary ?? value?.symbol ?? entityId),
    value: typeof value === "object" && value ? value : { value },
    surface_source: String(value?.surface_source ?? "conversation_state"),
    source_ref_id: value?.source_ref_id ?? value?.id ?? null,
    confidence: Number(value?.confidence ?? 0.78),
    reason,
    privacy_label: String(value?.privacy_label ?? value?.privacy ?? "user_private"),
    freshness: (value?.freshness as ResolvedReference["freshness"]) ?? "recent",
  };
}

function uniqueRefs(refs: ResolvedReference[]): ResolvedReference[] {
  const seen = new Set<string>();
  const out: ResolvedReference[] = [];
  for (const ref of refs) {
    const key = `${ref.entity_type}:${ref.entity_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}
