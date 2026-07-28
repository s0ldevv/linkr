import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/linkr/Logo";
import {
  Check,
  Loader2,
  Wallet,
  Twitter,
  ShieldCheck,
  Settings as SettingsIcon,
} from "lucide-react";
import { toast } from "sonner";
import { shortAddress } from "@/lib/linkr/format";

export const Route = createFileRoute("/_authenticated/app/onboarding")({
  head: () => ({ meta: [{ title: "Setup - Linkr" }] }),
  component: Onboarding,
});

function Onboarding() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const pkQuery = useQuery({
    queryKey: ["wallet-pk", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_wallet_public_key");
      if (error) throw error;
      return data as string | null;
    },
  });

  async function bootstrapAccount() {
    setCreating(true);
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ensure-user-bootstrap`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to prepare account");
      qc.invalidateQueries({ queryKey: ["wallet-pk", user!.id] });
      qc.invalidateQueries({ queryKey: ["profile", user!.id] });
      toast.success("Account ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const hasWallet = !!pkQuery.data;

  const steps = [
    {
      done: true,
      icon: Twitter,
      title: "X account connected",
      body: `Signed in as @${user?.user_metadata?.user_name ?? "you"}.`,
    },
    {
      done: hasWallet,
      icon: Wallet,
      title: "Bot wallet ready",
      body: hasWallet
        ? `Address: ${shortAddress(pkQuery.data!, 8, 8)}`
        : "Linkr creates an encrypted wallet automatically.",
    },
    {
      done: hasWallet,
      icon: ShieldCheck,
      title: "Starter limits active",
      body: "Default limits are 25% slippage, separate ETH/SOL buy caps, 100% sells, and separate ETH/SOL launch dev-buy caps.",
    },
    {
      done: hasWallet,
      icon: SettingsIcon,
      title: "Adjust anytime",
      body: "Tighten limits, disable actions, or require confirmations from Rules.",
    },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="text-center">
        <div className="mx-auto">
          <Logo to="/app" />
        </div>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">Linkr account ready</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your wallet and starter rules are prepared automatically.
        </p>
      </div>

      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="sm-card flex items-start gap-4 p-5">
            <div
              className={[
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                s.done ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
              ].join(" ")}
            >
              {s.done ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{`${i + 1}. ${s.title}`}</div>
              <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap justify-end gap-2">
        {!hasWallet ? (
          <Button onClick={bootstrapAccount} disabled={creating} className="gap-2">
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wallet className="h-4 w-4" />
            )}
            Retry account setup
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => navigate({ to: "/app" })}>
              Dashboard
            </Button>
            <Button onClick={() => navigate({ to: "/app/settings" })}>Adjust rules</Button>
          </>
        )}
      </div>
    </div>
  );
}
