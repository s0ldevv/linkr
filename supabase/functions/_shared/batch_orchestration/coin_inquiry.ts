import { buildPublicMarketFacts, getMarketDataBundle } from "../market_data/index.ts";
import type { BatchTarget, MultiCoinInquiryData, MultiCoinInquiryItem } from "./types.ts";

export async function buildMultiCoinInquiryData(
  admin: any,
  args: {
    targets: BatchTarget[];
    queryType?: string | null;
    overflowCount?: number;
  },
): Promise<MultiCoinInquiryData> {
  const settled = await Promise.allSettled(
    args.targets.map(async (target): Promise<MultiCoinInquiryItem> => {
      const bundle = await getMarketDataBundle(admin, {
        mint: target.address,
        chain: target.chain,
        includeDexscreener: true,
        includeBlockscout: target.chain === "robinhood",
        includeMoralis: target.chain === "robinhood",
        includeAnalytics:
          args.queryType === "token_analytics" ||
          args.queryType === "token_lookup" ||
          args.queryType == null,
      });
      const facts = buildPublicMarketFacts(bundle);
      delete facts.sources;
      delete facts.freshness;
      return { target, facts, error: null };
    }),
  );

  const items = settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    return {
      target: args.targets[index],
      facts: null,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });

  return {
    batch: true,
    kind: "multi_coin_inquiry",
    items,
    overflow_count: Math.max(0, Math.floor(Number(args.overflowCount ?? 0) || 0)),
    warnings: items.some((item) => item.error) ? ["partial_market_data"] : [],
  };
}
