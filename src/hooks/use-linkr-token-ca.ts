import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export const LINKR_CA_CONFIG_KEY = "linkr_token_ca";
export const FALLBACK_LINKR_CA = "soon";

type LinkrAppConfigRow = {
  config_key: string;
  config_value: string;
};

type LinkrAppConfigClient = {
  from: (table: "linkr_app_config_info") => {
    select: (columns: string) => {
      eq: (
        column: "config_key",
        value: string,
      ) => {
        maybeSingle: () => Promise<{
          data: LinkrAppConfigRow | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

export function useLinkrTokenCa() {
  return useQuery({
    queryKey: ["linkr-app-config-info", LINKR_CA_CONFIG_KEY],
    staleTime: 60_000,
    queryFn: async () => {
      const client = supabase as unknown as LinkrAppConfigClient;
      const { data, error } = await client
        .from("linkr_app_config_info")
        .select("config_key,config_value")
        .eq("config_key", LINKR_CA_CONFIG_KEY)
        .maybeSingle();

      if (error) return FALLBACK_LINKR_CA;

      const value = data?.config_value?.trim();
      return value || FALLBACK_LINKR_CA;
    },
  });
}
