import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpen,
  Bot,
  ChartCandlestick,
  Copy,
  Cpu,
  ExternalLink,
  Home,
  MessageCircle,
  Package,
  Send,
  Terminal,
  UsersRound,
} from "lucide-react";
import { useState, type ComponentType, type SVGProps } from "react";

import { XLogo } from "@/components/linkr/XLogo";
import { FALLBACK_LINKR_CA, useLinkrTokenCa } from "@/hooks/use-linkr-token-ca";
import { copyTextToClipboard } from "@/lib/clipboard";
import "@/components/linkr/links-page.css";

type LinkItem = {
  accent?: "primary";
  external?: boolean;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  subtitle: string;
};

const LINKS: LinkItem[] = [
  {
    accent: "primary",
    href: "/",
    icon: Home,
    label: "App",
    subtitle: "Open Linkr",
  },
  {
    external: true,
    href: "https://x.com/linkrbot",
    icon: XLogo,
    label: "X",
    subtitle: "Follow @linkrbot",
  },
  {
    external: true,
    href: "https://t.me/linkrcash",
    icon: Send,
    label: "Telegram",
    subtitle: "Join the Linkr group",
  },
  {
    external: true,
    href: "https://t.me/LinkrCashBot",
    icon: Bot,
    label: "Telegram Bot",
    subtitle: "@LinkrCashBot",
  },
  {
    href: "/app/terminal",
    icon: Terminal,
    label: "Terminal",
    subtitle: "Private Linkr command center",
  },
  {
    href: "/docs",
    icon: BookOpen,
    label: "Docs",
    subtitle: "Read the field manual",
  },
  {
    href: "/agent-api",
    icon: Cpu,
    label: "Agent API",
    subtitle: "Build with Linkr",
  },
  {
    external: true,
    href: "https://www.npmjs.com/package/@linkrcash/cli",
    icon: Package,
    label: "Linkr CLI",
    subtitle: "npm package",
  },
  {
    external: true,
    href: "https://discord.gg/Hz7yPpYBr",
    icon: MessageCircle,
    label: "Discord",
    subtitle: "Join the server",
  },
];

export const Route = createFileRoute("/links")({
  head: () => ({
    meta: [
      { title: "Linkr Links" },
      {
        name: "description",
        content:
          "Official Linkr links for X, Telegram, Telegram bot, Dexscreener, docs, Agent API, CLI, Discord, terminal, and the LINKR token CA.",
      },
      { property: "og:title", content: "Linkr Links" },
      {
        property: "og:description",
        content: "All official Linkr destinations in one clean page.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: LinksPage,
});

function LinksPage() {
  const [copied, setCopied] = useState(false);
  const linkrCaQuery = useLinkrTokenCa();

  const linkrCa = linkrCaQuery.data ?? FALLBACK_LINKR_CA;
  const dexscreenerUrl = `https://dexscreener.com/solana/${encodeURIComponent(linkrCa)}`;
  const links: LinkItem[] = [
    ...LINKS.slice(0, 1),
    {
      external: true,
      href: dexscreenerUrl,
      icon: ChartCandlestick,
      label: "Dexscreener",
      subtitle: "View $LINKR chart",
    },
    ...LINKS.slice(1),
  ];

  async function copyTokenCa() {
    const copiedTokenCa = await copyTextToClipboard(linkrCa);
    if (!copiedTokenCa) return;

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  }

  return (
    <main className="linkr-links-page" aria-labelledby="linkr-links-title">
      <section className="linkr-links-card">
        <header className="linkr-links-topline">
          <span className="linkr-links-badge">
            <UsersRound aria-hidden="true" size={15} strokeWidth={2.45} />
            Official Links
          </span>
          <span className="linkr-links-network">Mainnet</span>
        </header>

        <div className="linkr-links-brand">
          <div className="linkr-links-logo-shell" aria-hidden="true">
            <img src="/linkr-favi.png" alt="" className="linkr-links-logo" />
          </div>
          <span>linkr</span>
        </div>

        <div className="linkr-links-heading">
          <h1 id="linkr-links-title">LINKR</h1>
        </div>

        <section className="linkr-links-token" aria-labelledby="linkr-token-ca-title">
          <div className="linkr-links-token-head">
            <h2 id="linkr-token-ca-title">Official $LINKR CA</h2>
            {linkrCaQuery.isFetching && <span>Syncing</span>}
          </div>
          <div className="linkr-links-token-row">
            <code>{linkrCa}</code>
            <button
              type="button"
              onClick={copyTokenCa}
              className="linkr-links-copy"
              aria-label="Copy LINKR token CA"
            >
              <Copy aria-hidden="true" size={18} strokeWidth={2.3} />
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
        </section>

        <div className="linkr-links-list" aria-label="Official Linkr destinations">
          {links.map((item) => (
            <a
              className="linkr-links-item"
              data-accent={item.accent ?? "default"}
              href={item.href}
              key={item.label}
              rel={item.external ? "noreferrer" : undefined}
              target={item.external ? "_blank" : undefined}
            >
              <span className="linkr-links-item-icon" aria-hidden="true">
                <item.icon />
              </span>
              <span className="linkr-links-item-copy">
                <strong>{item.label}</strong>
                <small>{item.subtitle}</small>
              </span>
              <ExternalLink aria-hidden="true" size={18} strokeWidth={2.35} />
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
