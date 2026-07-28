import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type LiquidityPosition = Tables<"liquidity_positions">;

export type LiquidityPositionsResponse = {
  positions: LiquidityPosition[];
  summary: {
    activeCount: number;
    robinhoodActiveCount?: number;
    solanaActiveCount?: number;
    totalValueUsd: number | null;
    uncollectedFeesUsd: number | null;
    inRangeCount: number;
  };
};

export function useLiquidityPositions(userId?: string) {
  return useQuery({
    queryKey: ["liquidity-positions", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<LiquidityPositionsResponse>(
        "liquidity-positions",
        { body: {} },
      );
      if (error) throw error;
      return (
        data ?? {
          positions: [],
          summary: {
            activeCount: 0,
            totalValueUsd: null,
            uncollectedFeesUsd: null,
            inRangeCount: 0,
          },
        }
      );
    },
  });
}
