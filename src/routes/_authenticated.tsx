import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/linkr/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/auth", search: { returnTo: location.href } });
    }
    const supabaseUrl =
      import.meta.env.VITE_SUPABASE_URL ||
      (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined);
    if (supabaseUrl) {
      const res = await fetch(
        `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/ensure-user-bootstrap`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        },
      );
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "banned_x_user") {
          await supabase.auth.signOut();
          throw redirect({ to: "/auth/banned" });
        }
      }
    }
    return { userId: data.session.user.id };
  },
  component: AppShell,
});
