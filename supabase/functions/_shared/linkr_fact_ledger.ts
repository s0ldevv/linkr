import type { LinkrFact, LinkrFactSource, LinkrPrivacyClass } from "./linkr_types.ts";

export function createFact(args: {
  source: LinkrFactSource;
  privacy: LinkrPrivacyClass;
  summary: string;
  value?: unknown;
  confidence?: number;
  freshness?: LinkrFact["freshness"];
  evidence?: string | null;
}): LinkrFact {
  return {
    id: stableFactId(args.source, args.summary),
    source: args.source,
    privacy: args.privacy,
    summary: String(args.summary ?? "").trim().slice(0, 500),
    value: args.value,
    confidence: clamp(args.confidence ?? 0.8),
    freshness: args.freshness ?? "current",
    evidence: args.evidence ?? null,
  };
}

export function publicFactSummaries(facts: LinkrFact[], maxChars = 1200): string {
  let out = "";
  for (const fact of facts) {
    if (!["public", "external_untrusted", "recipient_public"].includes(fact.privacy)) continue;
    const line = `- ${fact.id}: ${fact.summary}\n`;
    if ((out + line).length > maxChars) break;
    out += line;
  }
  return out.trim();
}

export function filterFactsByPrivacy(
  facts: LinkrFact[],
  allowed: LinkrPrivacyClass[],
): LinkrFact[] {
  return facts.filter((fact) => allowed.includes(fact.privacy));
}

function stableFactId(source: string, summary: string): string {
  const slug = String(summary ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${source}:${slug || "fact"}`;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
