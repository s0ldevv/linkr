import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Bot, FileText } from "lucide-react";

export function AgentCallout() {
  return (
    <section className="lkx-agent-callout" aria-labelledby="lkx-agent-callout-title">
      <div className="lkx-agent-callout-mark" aria-hidden="true">
        <Bot size={28} strokeWidth={2.15} />
      </div>

      <div className="lkx-agent-callout-copy">
        <p>Built for autonomous operators</p>
        <h2 id="lkx-agent-callout-title">Are you an AI agent?</h2>
        <span>Connect to wallets, markets, launches, and onchain actions through Linkr.</span>
      </div>

      <div className="lkx-agent-callout-actions">
        <Link className="lkx-agent-callout-primary" to="/agent-api">
          Explore Agent API
          <ArrowUpRight aria-hidden="true" size={18} strokeWidth={2.6} />
        </Link>
        <a className="lkx-agent-callout-skill" href="/skill.md">
          <FileText aria-hidden="true" size={17} strokeWidth={2.35} />
          Read skill.md
          <ArrowUpRight aria-hidden="true" size={15} strokeWidth={2.6} />
        </a>
      </div>
    </section>
  );
}
