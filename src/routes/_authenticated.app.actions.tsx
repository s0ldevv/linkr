import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChainPill } from "@/components/linkr/ChainPill";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime } from "@/lib/linkr/format";
import { formatTransactionAmount } from "@/lib/linkr/transaction-format";

export const Route = createFileRoute("/_authenticated/app/actions")({
  head: () => ({ meta: [{ title: "Confirm - Linkr" }] }),
  component: ActionsPage,
});

function ActionsPage() {
  const { user } = useAuth();

  const pendingQuery = useQuery({
    queryKey: ["pending-actions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_actions")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const txQuery = useQuery({
    queryKey: ["all-tx", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const pending = pendingQuery.data ?? [];
  const transactions = txQuery.data ?? [];

  return (
    <div className="app-dashboard-page app-actions-page">
      <header className="app-live-hero app-dashboard-hero app-actions-hero">
        <div className="app-dashboard-hero-copy">
          <p className="app-live-kicker">Confirmations</p>
          <h1>To confirm</h1>
          <p>Wallet actions waiting for your reply, plus what already ran.</p>
        </div>
        <div className="app-live-signal" aria-label="Pending confirmation status">
          <span />
          {pending.length > 0 ? `${pending.length} pending` : "clear"}
        </div>
      </header>

      <section className="sm-card app-dashboard-card app-actions-card">
        <div className="app-dashboard-card-head app-dashboard-section-head">
          <div>
            <h2>Waiting for you</h2>
            <p className="app-dashboard-section-copy">
              Actions that need a confirmation reply before Linkr can continue.
            </p>
          </div>
        </div>
        <div className="app-dashboard-activity-list">
          {pending.length === 0 && <div className="app-dashboard-empty">Nothing pending.</div>}
          {pending.map((p) => (
            <div key={p.id} className="app-dashboard-activity-row">
              <div>
                <strong>{p.intent}</strong>
                <p className="app-dashboard-section-copy">
                  Reply <code>{p.confirmation_phrase}</code> within {relativeTime(p.expires_at)}
                </p>
              </div>
              <span className={statusClass(p.status)}>{p.status}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="sm-card app-dashboard-card app-actions-card">
        <div className="app-dashboard-card-head app-dashboard-section-head">
          <div>
            <h2>Already handled</h2>
            <p className="app-dashboard-section-copy">
              Recent wallet actions that have already been recorded.
            </p>
          </div>
        </div>
        <div className="app-dashboard-activity-list">
          {transactions.length === 0 && <div className="app-dashboard-empty">No actions yet.</div>}
          {transactions.map((tx) => (
            <div key={tx.id} className="app-dashboard-activity-row">
              <div>
                <strong>{tx.action}</strong>
                <p className="app-dashboard-section-copy">{relativeTime(tx.created_at)}</p>
              </div>
              <div className="app-actions-row-meta">
                <strong className="sm-mono">{formatTransactionAmount(tx)}</strong>
                <ChainPill chain={tx.chain === "solana" ? "solana" : "robinhood"} iconOnly />
                <span className={statusClass(tx.status)}>{tx.status}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function statusClass(status: string | null) {
  const normalized = (status ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return "app-status app-status-" + normalized;
}
