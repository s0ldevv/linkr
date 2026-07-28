import { createFileRoute } from "@tanstack/react-router";
import { Droplets } from "lucide-react";
import { PoolsSection } from "@/components/linkr/pools/PoolsSection";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/app/pools")({
  head: () => ({ meta: [{ title: "Pools - Linkr" }] }),
  component: PoolsPage,
});

function PoolsPage() {
  const { user } = useAuth();

  return (
    <div className="app-dashboard-page app-pools-page">
      <header className="app-live-hero app-dashboard-hero app-pools-hero">
        <div className="app-dashboard-hero-copy">
          <p className="app-live-kicker">Liquidity manager</p>
          <h1>Pools</h1>
          <p>
            Add liquidity to existing Linkr-launched Uniswap V3 pools, remove your own LP positions,
            collect fees, and review position status from the dashboard.
          </p>
        </div>
        <div className="app-live-signal" aria-label="Pools status">
          <Droplets aria-hidden="true" size={16} />
          user-owned LPs
        </div>
      </header>

      <PoolsSection userId={user?.id} />
    </div>
  );
}
