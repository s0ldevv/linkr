import { createFileRoute } from "@tanstack/react-router";
import { TerminalHomePage } from "@/components/linkr/home/terminal/TerminalHomePage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Linkr - Trade Across Chains from X" },
      {
        name: "description",
        content:
          "Linkr is a Robinhood Chain and Solana wallet agent you control from X. Reply with @linkrbot to buy, sell, send, launch, or ask what is in a thread.",
      },
      { property: "og:title", content: "Linkr - Trade Across Chains from X" },
      {
        property: "og:description",
        content:
          "Reply on X. Linkr reads the thread, checks your limits, and signs on supported chains only when your rules allow it.",
      },
    ],
  }),
  component: TerminalHomePage,
});
