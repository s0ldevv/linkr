import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const bootstrappedUsers = new Set<string>();

export function useEnsureUserBootstrap(user: User | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user?.id || bootstrappedUsers.has(user.id)) return;

    let cancelled = false;
    bootstrappedUsers.add(user.id);

    (async () => {
      const supabaseUrl =
        import.meta.env.VITE_SUPABASE_URL ||
        (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined);
      if (!supabaseUrl) throw new Error("Supabase URL is not configured.");

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch(
        `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/ensure-user-bootstrap`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403 && body.error === "banned_x_user") {
          await supabase.auth.signOut();
          if (!cancelled && typeof window !== "undefined") {
            window.location.href = "/auth/banned";
          }
          return;
        }
        throw new Error(body.error ?? "Could not prepare Linkr account.");
      }

      if (!cancelled) {
        queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
        queryClient.invalidateQueries({ queryKey: ["wallet-pk", user.id] });
        queryClient.invalidateQueries({ queryKey: ["wallets", user.id] });
        queryClient.invalidateQueries({ queryKey: ["home-dashboard-data"] });
      }
    })().catch((error) => {
      bootstrappedUsers.delete(user.id);
      console.warn("[Linkr] account bootstrap failed", error);
    });

    return () => {
      cancelled = true;
    };
  }, [queryClient, user?.id]);
}
