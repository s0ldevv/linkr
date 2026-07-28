import { extractFromText } from "./extract.ts";
import { createFact } from "./linkr_fact_ledger.ts";
import type { LinkrEntityRef, LinkrFact } from "./linkr_types.ts";

const HANDLE_RE = /@([A-Za-z0-9_]{1,15})\b/g;
const URL_RE = /https?:\/\/\S+/gi;

export function resolveEntitiesFromText(args: {
  text: string;
  source: LinkrEntityRef["source"];
  privacy?: LinkrEntityRef["privacy"];
}): { entities: LinkrEntityRef[]; facts: LinkrFact[] } {
  const text = String(args.text ?? "");
  const privacy = args.privacy ?? "public";
  const extracted = extractFromText(text);
  const facts: LinkrFact[] = [];
  const entities: LinkrEntityRef[] = [];

  for (const mint of [...new Set(extracted.mints)]) {
    const fact = createFact({
      source: args.source,
      privacy,
      summary: `Token address or mint mentioned: ${short(mint)}`,
      value: mint,
      evidence: mint,
    });
    facts.push(fact);
    entities.push(entity("token", short(mint), mint, args.source, privacy, [fact.id], 0.9));
  }

  for (const symbol of [...new Set(extracted.symbols)]) {
    const clean = symbol.replace(/^\$/, "").toUpperCase();
    const fact = createFact({
      source: args.source,
      privacy,
      summary: `Token ticker mentioned: $${clean}`,
      value: clean,
      evidence: "$" + clean,
      confidence: 0.65,
    });
    facts.push(fact);
    entities.push(entity("token", "$" + clean, clean, args.source, privacy, [fact.id], 0.65));
  }

  for (const match of text.matchAll(HANDLE_RE)) {
    const handle = "@" + match[1];
    if (/^@linkrcash$/i.test(handle)) continue;
    const fact = createFact({
      source: args.source,
      privacy,
      summary: `X handle mentioned: ${handle}`,
      value: handle,
      evidence: handle,
    });
    facts.push(fact);
    entities.push(entity("x_handle", handle, handle, args.source, privacy, [fact.id], 0.8));
  }

  for (const url of text.match(URL_RE) ?? []) {
    const fact = createFact({
      source: args.source,
      privacy,
      summary: `URL mentioned: ${url.slice(0, 80)}`,
      value: url,
      evidence: url,
      confidence: 0.85,
    });
    facts.push(fact);
    entities.push(entity("url", url.slice(0, 80), url, args.source, privacy, [fact.id], 0.85));
  }

  return { entities: dedupeEntities(entities), facts };
}

export function resolvePronounReference(
  text: string,
  candidates: LinkrEntityRef[],
): LinkrEntityRef | null {
  if (!/\b(it|this|that|same one|them)\b/i.test(text)) return null;
  const tokenCandidates = candidates.filter((entity) => entity.kind === "token");
  if (tokenCandidates.length === 1 && tokenCandidates[0].confidence >= 0.6) {
    return { ...tokenCandidates[0], confidence: Math.min(1, tokenCandidates[0].confidence + 0.05) };
  }
  return null;
}

function entity(
  kind: LinkrEntityRef["kind"],
  label: string,
  value: string,
  source: LinkrEntityRef["source"],
  privacy: LinkrEntityRef["privacy"],
  evidence_fact_ids: string[],
  confidence: number,
): LinkrEntityRef {
  return {
    id: `${kind}:${label.toLowerCase()}`,
    kind,
    label,
    value,
    source,
    confidence,
    freshness: "current",
    privacy,
    evidence_fact_ids,
  };
}

function dedupeEntities(entities: LinkrEntityRef[]): LinkrEntityRef[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    const key = `${entity.kind}:${String(entity.value).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function short(value: string): string {
  return value.length > 12 ? value.slice(0, 4) + "..." + value.slice(-4) : value;
}
