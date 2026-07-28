import { createFileRoute } from "@tanstack/react-router";

import { LinkrDocsPage } from "@/components/linkr/docs/LinkrDocsPage";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Linkr Docs - X, Telegram, Terminal, Wallets, and Launches" },
      {
        name: "description",
        content:
          "Complete Linkr documentation for X, Telegram, private terminal, wallets, swaps, burns, launches, rewards, liquidity, scheduling, research, and receipts.",
      },
      { property: "og:title", content: "Linkr Bot Docs" },
      {
        property: "og:description",
        content:
          "Everything Linkr can do from X, Telegram, the private terminal, and the app: commands, confirmations, wallets, launches, rewards, research, history, and safety.",
      },
    ],
  }),
  component: LinkrDocsPage,
});
