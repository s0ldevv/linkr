import { createFileRoute } from "@tanstack/react-router";
import { AgentApiDocsPage } from "@/components/linkr/agent-api/AgentApiDocsPage";

export const Route = createFileRoute("/agent-api")({
  head: () => ({
    meta: [
      { title: "Linkr Agent API - Authenticated endpoints for AI agents" },
      {
        name: "description",
        content:
          "Authenticated Linkr Agent API docs for registration, signed requests, Robinhood and Solana wallets, launches, swaps, transfers, schedules, burns, liquidity, creator rewards, history, and coin data.",
      },
    ],
  }),
  component: AgentApiDocsPage,
});
