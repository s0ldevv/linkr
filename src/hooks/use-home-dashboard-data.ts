import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { HomeDashboardData } from "@/lib/linkr/home-data";

export function useHomeDashboardData() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["home-dashboard-data", user?.id ?? "anon"],
    refetchInterval: 120_000,
    retry: 1,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;

      if (!supabaseUrl) {
        throw new Error("Missing Supabase URL");
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/home-dashboard-data`, {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Could not load home dashboard data");
      }

      return body as HomeDashboardData;
    },
  });
}
