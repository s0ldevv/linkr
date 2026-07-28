import { extractMarketAddresses, normalizeMarketAddress } from "../market_data/chains.ts";
import type { BatchTarget } from "./types.ts";

type TargetSource = BatchTarget["source"];

export function collectMarketTargets(args: {
  text: string;
  thread?: any;
  extraction?: any;
  maxTargets?: number;
}): {
  targets: BatchTarget[];
  overflow_count: number;
} {
  const maxTargets = Math.max(1, Math.min(25, Math.floor(Number(args.maxTargets ?? 5) || 5)));
  const seen = new Set<string>();
  const targets: BatchTarget[] = [];

  const push = (value: unknown, source: TargetSource, confidence: number) => {
    const normalized = normalizeMarketAddress(value);
    if (!normalized) return;
    const key = `${normalized.chain}:${normalized.address.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({
      id: key,
      chain: normalized.chain,
      address: normalized.address,
      source,
      confidence,
    });
  };

  for (const item of extractMarketAddresses(args.text ?? "")) {
    push(item.address, "tweet", 0.99);
  }

  const extraction = args.extraction ?? {};
  push(extraction.token_address, "extraction", 0.84);
  push(extraction.token_mint, "extraction", 0.84);
  if (Array.isArray(extraction.token_candidates)) {
    for (const candidate of extraction.token_candidates) push(candidate, "extraction", 0.78);
  }

  const thread = args.thread ?? {};
  const threadText = [
    thread.flattened_context,
    ...(Array.isArray(thread.detected_urls) ? thread.detected_urls : []),
  ]
    .filter(Boolean)
    .join("\n");
  for (const item of extractMarketAddresses(threadText)) {
    push(item.address, "thread", 0.72);
  }
  if (Array.isArray(thread.detected_mints)) {
    for (const mint of thread.detected_mints) push(mint, "thread", 0.7);
  }

  return {
    targets: targets.slice(0, maxTargets),
    overflow_count: Math.max(0, targets.length - maxTargets),
  };
}
