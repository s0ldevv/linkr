import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { MarketingHeader } from "@/components/linkr/MarketingHeader";
import { useHomeDashboardData } from "@/hooks/use-home-dashboard-data";
import { AgentCallout } from "./AgentCallout";
import { TerminalBar } from "./TerminalBar";
import { TerminalFeeds } from "./TerminalFeeds";
import { TerminalHero } from "./TerminalHero";
import { TerminalLaunches } from "./TerminalLaunches";
import { TerminalRanks } from "./TerminalRanks";
import { TerminalWorkflow } from "./TerminalWorkflow";
import "./terminal-home.css";

const APP_VERSION = "1.0.0";

export function TerminalHomePage() {
  const { data, isLoading } = useHomeDashboardData();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="lkt-home min-h-screen">
      <MarketingHeader onMobileMenuOpenChange={setMobileMenuOpen} />
      <main className="lkt-shell">
        <TerminalHero />
        <AgentCallout />
        <TerminalBar mobileMenuOpen={mobileMenuOpen} />
        <TerminalLaunches tokens={data?.public.topLaunchedTokens} isLoading={isLoading} />
        <TerminalFeeds data={data} />
        <TerminalRanks data={data} />
        <TerminalWorkflow status={data?.public.systemStatus} />
      </main>
      <footer className="sm-rayo-footer" aria-label="Footer">
        <div>linkr</div>
        <p>Reply on X. Check the rules. Sign only what should move.</p>
        <nav className="lkt-footer-links" aria-label="Legal">
          <span>Linkr Terminal v{APP_VERSION}</span>
          <Link to="/terms-of-service">Terms</Link>
          <Link to="/privacy-policy">Privacy</Link>
          <a href="#system">Status</a>
          <Link to="/docs">Docs</Link>
          <span>Robinhood Chain + Solana</span>
        </nav>
      </footer>
    </div>
  );
}
