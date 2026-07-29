import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpRight,
  Bot,
  Braces,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Globe,
  ImageIcon,
  Rocket,
  Send,
  ShieldCheck,
  Smile,
  Terminal,
  TrendingUp,
  User,
  Wallet,
  WalletCards,
} from "lucide-react";
import { ChainPill } from "@/components/linkr/ChainPill";

function XLogo(props: ComponentProps<"svg">) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 451 409" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1 0 H142 L242 130 L356 0 H424 L273 173 L450 408 H313 L203 265 L79 407 L10 408 L171 222 Z M82 38 H121 L369 367 L329 365 Z"
      />
    </svg>
  );
}

function TerminalChainMark({
  chain,
  className,
}: {
  chain: "robinhood" | "solana";
  className?: string;
}) {
  return (
    <ChainPill
      chain={chain}
      className={className}
      iconOnly
      label={chain === "solana" ? "Solana" : "Robinhood Chain"}
    />
  );
}

const FEATURE_CHIPS = [
  { icon: Rocket, label: "Launch" },
  { icon: TrendingUp, label: "Trade" },
  { icon: Send, label: "Send" },
  { icon: Wallet, label: "Wallets" },
] as const;

const WALLET_ACTIONS = [
  { icon: Send, label: "Send" },
  { icon: ArrowDownToLine, label: "Receive" },
  { icon: ArrowLeftRight, label: "Swap" },
  { icon: WalletCards, label: "Wallets" },
] as const;

const HERO_SCREENS = [
  "CLI",
  "Command",
  "Actions",
  "Agent API",
  "Networks",
  "How it works",
] as const;
const SCREEN_DWELL_MS = 5600;
const SCREEN_TRANSITION_MS = 850;

type MotionStyle = CSSProperties & Record<`--${string}`, string | number>;

const COMMAND_PARTS = buildCommandParts();

function buildCommandParts() {
  const source: Array<{
    text: string;
    kind?: "asset" | "network" | "network-alt";
    breakBefore?: boolean;
    pauseAfter?: number;
  }> = [
    { text: "Launch ", pauseAfter: 110 },
    { text: "a " },
    { text: "coin ", pauseAfter: 75 },
    { text: "called ", pauseAfter: 90 },
    { text: "MOON", kind: "asset", pauseAfter: 260 },
    { text: " on", pauseAfter: 70 },
    { text: "Solana", kind: "network", breakBefore: true, pauseAfter: 210 },
    { text: " and ", pauseAfter: 85 },
    { text: "Robinhood Chain.", kind: "network-alt", pauseAfter: 120 },
  ];
  const cadence = [31, 44, 36, 51, 28, 39, 33];
  let at = 300;
  let glyphIndex = 0;

  const parts = source.map((part) => {
    const glyphs = Array.from(part.text).map((character) => {
      const glyph = { character, at, caretFor: 0 };
      at += cadence[glyphIndex % cadence.length] + (character === " " ? 16 : 0);
      glyphIndex += 1;
      return glyph;
    });
    at += part.pauseAfter ?? 0;
    return { ...part, glyphs, completedAt: at };
  });

  const glyphs = parts.flatMap((part) => part.glyphs);
  glyphs.forEach((glyph, index) => {
    glyph.caretFor = Math.max(42, (glyphs[index + 1]?.at ?? at) - glyph.at);
  });

  return parts;
}

function CliMovie({ active }: { active: boolean }) {
  return (
    <>
      <div className="lkx-cli-movie">
        <div className="lkx-cli-window" aria-hidden="true">
          <div className="lkx-cli-titlebar">
            <span className="lkx-cli-lights">
              <i />
              <i />
              <i />
            </span>
            <span className="lkx-cli-title">
              <Terminal aria-hidden="true" size={12} strokeWidth={2.4} />
              linkr — zsh
            </span>
            <span className="lkx-cli-registry">npm</span>
          </div>

          <div className="lkx-cli-body">
            <div className="lkx-cli-row">
              <span className="lkx-cli-prompt">$</span>
              <span className="lkx-cli-typed lkx-cli-typed--1">npm install -g @linkrcash/cli</span>
            </div>

            <div className="lkx-cli-install">
              <span className="lkx-cli-progress">
                <i />
              </span>
              <span className="lkx-cli-added">
                <span className="lkx-cli-ok">
                  <Check aria-hidden="true" size={11} strokeWidth={3} />
                </span>
                added <b>1 package</b> · linkr@1.4.0 in 1.2s
              </span>
            </div>

            <div className="lkx-cli-row">
              <span className="lkx-cli-prompt">$</span>
              <span className="lkx-cli-typed lkx-cli-typed--2">linkr login</span>
            </div>

            <div className="lkx-cli-out lkx-cli-out--login">
              <span className="lkx-cli-ok">
                <Check aria-hidden="true" size={11} strokeWidth={3} />
              </span>
              Authorized · <b>@linkrcash</b>
              <i className="lkx-cli-scope">read + write</i>
            </div>

            <div className="lkx-cli-row">
              <span className="lkx-cli-prompt">$</span>
              <span className="lkx-cli-typed lkx-cli-typed--3">
                linkr chat "Launch MOON on Solana"
              </span>
              <i className="lkx-cli-caret" />
            </div>
          </div>
        </div>

        <div className="lkx-cli-footer">
          <div className="lkx-cli-result" aria-hidden="true">
            <span className="lkx-cli-result-run">
              <i className="lkx-cli-spinner" />
              Deploying MOON on Solana
            </span>
            <span className="lkx-cli-result-live">
              <span className="lkx-cli-result-check">
                <Check aria-hidden="true" size={13} strokeWidth={3} />
              </span>
              <span className="lkx-cli-result-copy">
                <strong>MOON is live</strong>
                <small>linkr · Solana launch</small>
              </span>
              <span className="lkx-cli-result-tx">
                <TerminalChainMark chain="solana" className="lkx-cli-result-chain" />
                <code>7xQ4…9Pk2</code>
              </span>
            </span>
          </div>

          <a
            className="lkx-cli-npm"
            href="https://www.npmjs.com/package/@linkrcash/cli"
            target="_blank"
            rel="noreferrer"
            tabIndex={active ? 0 : -1}
            aria-label="View the @linkrcash/cli package on npm (opens in a new tab)"
          >
            View on npm
            <ArrowUpRight aria-hidden="true" size={15} strokeWidth={2.5} />
          </a>
        </div>
      </div>
      <span className="lkx-sr-only">
        Install the Linkr CLI with npm, sign in with one command, then launch a coin called MOON on
        Solana straight from your terminal. Linkr confirms the launch onchain. The package is
        available on npm as @linkrcash/cli.
      </span>
    </>
  );
}

function CommandMovie() {
  return (
    <>
      <div className="lkx-cmd-movie" aria-hidden="true">
        <div className="lkx-cmd-console">
          <div className="lkx-cmd-compose-head">
            <span className="lkx-cmd-avatar">
              <User aria-hidden="true" size={17} strokeWidth={2.2} />
            </span>
            <span className="lkx-cmd-compose-author">
              <strong>You</strong>
              <small>@you</small>
            </span>
            <span className="lkx-cmd-compose-badge">
              <XLogo />
            </span>
          </div>

          <div className="lkx-cmd-entry">
            <span className="lkx-cmd-copy">
              <span className="lkx-cmd-mention">@linkrcash</span>{" "}
              {COMMAND_PARTS.map((part, partIndex) => (
                <span key={`${part.text}-${partIndex}`}>
                  {"breakBefore" in part && part.breakBefore ? <br /> : null}
                  <span
                    className={part.kind ? `lkx-cmd-token lkx-cmd-token--${part.kind}` : undefined}
                    style={
                      part.kind
                        ? ({ "--token-at": `${part.completedAt}ms` } as MotionStyle)
                        : undefined
                    }
                  >
                    {part.glyphs.map((glyph, glyphIndex) => (
                      <span
                        className="lkx-cmd-char"
                        key={`${partIndex}-${glyphIndex}`}
                        style={
                          {
                            "--caret-for": `${glyph.caretFor}ms`,
                            "--char-at": `${glyph.at}ms`,
                          } as MotionStyle
                        }
                      >
                        {glyph.character === " " ? "\u00a0" : glyph.character}
                      </span>
                    ))}
                  </span>
                </span>
              ))}
              <i
                className="lkx-cmd-caret"
                style={
                  {
                    "--command-complete-at": `${COMMAND_PARTS.at(-1)?.completedAt ?? 3300}ms`,
                  } as MotionStyle
                }
              />
            </span>
          </div>

          <div className="lkx-cmd-intent-rail">
            <span className="lkx-cmd-intent lkx-cmd-intent--asset">
              <small>Asset</small> MOON
            </span>
            <span className="lkx-cmd-intent lkx-cmd-intent--network">
              <small>Network</small> Solana <em>+ Robinhood</em>
            </span>
          </div>

          <div className="lkx-cmd-compose-foot">
            <span className="lkx-cmd-compose-reply">
              <Globe aria-hidden="true" size={13} strokeWidth={2.3} />
              Everyone can reply
            </span>
            <span className="lkx-cmd-compose-tools">
              <ImageIcon aria-hidden="true" size={15} strokeWidth={2.2} />
              <Smile aria-hidden="true" size={15} strokeWidth={2.2} />
              <CalendarClock aria-hidden="true" size={15} strokeWidth={2.2} />
            </span>
            <span className="lkx-cmd-post">Post</span>
          </div>
          <i className="lkx-cmd-scan" />
        </div>

        <div className="lkx-cmd-resolve">
          <span className="lkx-cmd-parsing">
            Parsing intent <i /> <i /> <i />
          </span>
          <span className="lkx-cmd-ready">
            <span className="lkx-cmd-check">
              <Check aria-hidden="true" size={15} strokeWidth={2.6} />
            </span>
            <span>
              <strong>Launch plan ready</strong>
              <small>MOON · 2 networks · deployment configured</small>
            </span>
          </span>
        </div>
      </div>
      <span className="lkx-sr-only">
        Composing a post on X that tags @linkrcash: Launch a coin called MOON on Solana and
        Robinhood Chain. Linkr reads the post, identifies the asset and networks, then prepares the
        launch plan.
      </span>
    </>
  );
}

function ActionsMovie() {
  return (
    <>
      <div className="lkx-actions-demo" aria-hidden="true">
        <div className="lkx-actions-ui">
          <div className="lkx-actions-rail">
            {WALLET_ACTIONS.map(({ icon: Icon, label }, index) => (
              <div
                key={label}
                className="lkx-action-tile"
                data-action={label.toLowerCase()}
                style={{ "--action-index": index } as MotionStyle}
              >
                <span className="lkx-action-icon">
                  <Icon aria-hidden="true" size={18} strokeWidth={2.1} />
                </span>
                <span>{label}</span>
                {label === "Send" ? <i className="lkx-action-focus-ring" /> : null}
              </div>
            ))}
          </div>

          <div className="lkx-send-workspace">
            <div className="lkx-send-form">
              <div className="lkx-send-form-topline">
                <span>Send USDC</span>
                <span>Balance · 1,842.75 USDC</span>
              </div>
              <div className="lkx-send-amount">
                <span>$</span>
                <strong>125.00</strong>
                <small>USDC</small>
              </div>
              <div className="lkx-send-recipient">
                <span className="lkx-recipient-avatar">M</span>
                <span>
                  <small>Sending to</small>
                  <strong>@maya</strong>
                  <i>8xQ4…M4p</i>
                </span>
                <Check aria-hidden="true" size={14} strokeWidth={2.8} />
              </div>
            </div>

            <div className="lkx-send-route">
              <div className="lkx-send-route-node">
                <Wallet aria-hidden="true" size={15} strokeWidth={2.2} />
                <span>Wallet</span>
              </div>
              <div className="lkx-send-route-track">
                <i className="lkx-send-route-line" />
                <i className="lkx-send-route-packet" />
                <i className="lkx-send-route-packet lkx-send-route-packet--echo" />
              </div>
              <div className="lkx-send-route-node">
                <TerminalChainMark chain="solana" className="lkx-send-route-chain" />
                <span>Solana</span>
              </div>
            </div>

            <div className="lkx-send-status">
              <span className="lkx-send-status-label lkx-send-status-label--review">
                Review transfer
              </span>
              <span className="lkx-send-status-label lkx-send-status-label--executing">
                <i /> Executing securely
              </span>
              <span className="lkx-send-status-label lkx-send-status-label--success">
                <Check aria-hidden="true" size={14} strokeWidth={2.8} /> Sent in 0.8s
              </span>
              <i className="lkx-send-status-sheen" />
            </div>
          </div>
        </div>

        <div className="lkx-send-receipt">
          <div className="lkx-receipt-hero">
            <span className="lkx-receipt-check">
              <Check aria-hidden="true" size={22} strokeWidth={2.8} />
            </span>
            <span>
              <small>Transfer complete</small>
              <strong>$125.00</strong>
              <p>
                <b>125 USDC</b> delivered to <b>@maya</b>
              </p>
            </span>
          </div>

          <div className="lkx-receipt-route">
            <span className="lkx-receipt-party">
              <i className="lkx-recipient-avatar">M</i>
              <span>
                <small>Recipient</small>
                <strong>@maya</strong>
              </span>
            </span>
            <span className="lkx-receipt-route-line">
              <i />
              <Check aria-hidden="true" size={11} strokeWidth={3} />
            </span>
            <span className="lkx-receipt-party lkx-receipt-party--network">
              <TerminalChainMark chain="solana" className="lkx-receipt-network-mark" />
              <span>
                <small>Network</small>
                <strong>Solana</strong>
              </span>
            </span>
          </div>

          <div className="lkx-receipt-details">
            <span>
              <small>Transaction</small>
              <strong>5kQp…9L2</strong>
            </span>
            <span>
              <small>Network fee</small>
              <strong>$0.0008</strong>
            </span>
            <span>
              <small>Completed in</small>
              <strong>0.8 seconds</strong>
            </span>
          </div>

          <div className="lkx-receipt-footer">
            <span className="lkx-receipt-live">
              <i /> Confirmed onchain
            </span>
            <span>
              View transaction <ArrowUpRight aria-hidden="true" size={12} strokeWidth={2.5} />
            </span>
          </div>
        </div>
      </div>
      <span className="lkx-sr-only">
        A demonstration of sending 125 USDC to @maya through Solana, ending in a confirmed
        transaction.
      </span>
    </>
  );
}

function NetworkMovie() {
  return (
    <>
      <div className="lkx-network-story" aria-hidden="true">
        <div className="lkx-route-head">
          <span>
            <small>Cross-chain deployment</small>
            <strong>MOON · Multichain launch</strong>
          </span>
          <span className="lkx-route-phase">
            <i className="lkx-route-phase--discover">Discovering endpoints</i>
            <i className="lkx-route-phase--handshake">Negotiating route</i>
            <i className="lkx-route-phase--dispatch">Dispatching payload</i>
            <i className="lkx-route-phase--final">Route synchronized</i>
          </span>
        </div>

        <div className="lkx-route-canvas">
          <div className="lkx-route-canvas-head">
            <span>
              <i /> Live orchestration
            </span>
            <span>JOB / LK-2048</span>
          </div>

          <div className="lkx-route-map">
            <NetworkNode
              chain="sol"
              label="Solana"
              descriptor="Primary issuance"
              latency="38ms"
              finality="0.4s"
              height="302.18m"
            >
              <TerminalChainMark chain="solana" className="lkx-route-logo" />
            </NetworkNode>
            <RouteLane side="left" />
            <div className="lkx-route-router">
              <span className="lkx-router-orbit lkx-router-orbit--outer" />
              <span className="lkx-router-orbit lkx-router-orbit--inner" />
              <span className="lkx-router-pulse" />
              <span className="lkx-router-core">
                <i>Linkr</i>
                <b>
                  <span>Scan</span>
                  <span>Route</span>
                  <span>Live</span>
                </b>
              </span>
              <small>Orchestrator</small>
            </div>
            <RouteLane side="right" />
            <NetworkNode
              chain="rh"
              label="Robinhood Chain"
              descriptor="Distribution rail"
              latency="42ms"
              finality="0.8s"
              height="18.42m"
            >
              <TerminalChainMark chain="robinhood" className="lkx-route-logo lkx-route-logo--rh" />
            </NetworkNode>
          </div>
        </div>

        <div className="lkx-route-ledger">
          {["Endpoints resolved", "Payload signed", "Finality reached"].map((label, index) => (
            <span key={label}>
              <b>{index + 1}</b>
              <Check aria-hidden="true" size={12} strokeWidth={3} /> {label}
            </span>
          ))}
          <strong>
            <i /> Synchronized <span>2 / 2 networks</span>
          </strong>
        </div>
      </div>
      <span className="lkx-sr-only">
        Linkr synchronizes a launch across Solana and Robinhood Chain, confirming both network
        routes.
      </span>
    </>
  );
}

function NetworkNode({
  chain,
  children,
  descriptor,
  finality,
  height,
  label,
  latency,
}: {
  chain: "sol" | "rh";
  children: ReactNode;
  descriptor: string;
  finality: string;
  height: string;
  label: string;
  latency: string;
}) {
  return (
    <div className={`lkx-route-node lkx-route-node--${chain}`}>
      <span className="lkx-route-node-glow" />
      <div className="lkx-route-node-head">
        <span className="lkx-route-node-brand">{children}</span>
        <span>
          <strong>{label}</strong>
          <small>{descriptor}</small>
        </span>
        <i className="lkx-route-node-live">Live</i>
      </div>
      <div className="lkx-route-node-metrics">
        <span>
          <small>RPC</small>
          <b>{latency}</b>
        </span>
        <span>
          <small>Finality</small>
          <b>{finality}</b>
        </span>
        <span>
          <small>Height</small>
          <b>{height}</b>
        </span>
      </div>
      <span className="lkx-route-node-state">
        <i>Discovering</i>
        <i>Endpoint healthy · {latency}</i>
        <i>Broadcasting</i>
        <i>
          <Check aria-hidden="true" size={10} strokeWidth={3} /> Confirmed
        </i>
      </span>
      <span className="lkx-route-node-meter">
        <i />
      </span>
    </div>
  );
}

function RouteLane({ side }: { side: "left" | "right" }) {
  return (
    <div className={`lkx-route-lane lkx-route-lane--${side}`}>
      <i className="lkx-route-track" />
      <i className="lkx-route-beam" />
      <b className="lkx-route-packet lkx-route-packet--discover" />
      <b className="lkx-route-packet lkx-route-packet--out" />
      <b className="lkx-route-packet lkx-route-packet--return" />
    </div>
  );
}

const API_TOOLS = [
  { name: "launch_coin", detail: "MOON · Solana", state: "done" },
  { name: "buy_asset", detail: "$250 · Robinhood", state: "live" },
  { name: "transfer", detail: "USDC · @maya", state: "queued" },
] as const;

function AgentApiMovie() {
  return (
    <>
      <div className="lkx-api-movie" aria-hidden="true">
        <div className="lkx-api-topbar">
          <span className="lkx-api-eyebrow">
            <i /> AGENT API
          </span>
          <span className="lkx-api-session">
            SESSION <b>LIVE</b>
          </span>
          <span className="lkx-api-secure">
            <ShieldCheck size={12} /> Policy protected
          </span>
        </div>

        <div className="lkx-api-workspace">
          <section className="lkx-api-request">
            <div className="lkx-api-request-head">
              <span className="lkx-api-agent-mark">
                <Bot size={16} />
              </span>
              <span>
                <small>YOUR AGENT</small>
                <strong>requests an action</strong>
              </span>
              <code>POST /v1/execute</code>
            </div>
            <div className="lkx-api-code">
              <span>
                <i>1</i>
                <b>{`{`}</b>
              </span>
              <span>
                <i>2</i>
                <em>"tool"</em>: <strong>"launch_coin"</strong>,
              </span>
              <span>
                <i>3</i>
                <em>"symbol"</em>: <strong>"MOON"</strong>,
              </span>
              <span>
                <i>4</i>
                <em>"network"</em>: <strong>"solana"</strong>
              </span>
              <span>
                <i>5</i>
                <b>{`}`}</b>
                <mark className="lkx-api-caret" />
              </span>
            </div>
            <div className="lkx-api-scope-row">
              <span>
                <Braces size={11} /> One API
              </span>
              <span>Buy + sell</span>
              <span>Transfer funds</span>
            </div>
          </section>

          <div className="lkx-api-spine">
            <span className="lkx-api-packet">JSON</span>
            <i />
            <span className="lkx-api-linkr">L</span>
            <small>LINKR</small>
            <i />
            <span className="lkx-api-packet lkx-api-packet--out">TX</span>
          </div>

          <section className="lkx-api-execution">
            <div className="lkx-api-execution-head">
              <span>
                <small>EXECUTION STREAM</small>
                <strong>3 tool calls</strong>
              </span>
              <span className="lkx-api-latency">42ms</span>
            </div>
            <div className="lkx-api-tool-list">
              {API_TOOLS.map((tool, index) => (
                <div
                  className="lkx-api-tool"
                  data-state={tool.state}
                  key={tool.name}
                  style={{ "--tool-index": index } as MotionStyle}
                >
                  <span className="lkx-api-tool-status">
                    <Check size={10} strokeWidth={3} />
                  </span>
                  <span>
                    <code>{tool.name}()</code>
                    <small>{tool.detail}</small>
                  </span>
                  <i>{tool.state === "done" ? "200" : tool.state === "live" ? "RUN" : "NEXT"}</i>
                </div>
              ))}
            </div>
            <div className="lkx-api-networks">
              <span>
                <TerminalChainMark chain="solana" className="lkx-api-network-mark" />
                <b>Solana</b>
                <i>connected</i>
              </span>
              <span>
                <TerminalChainMark chain="robinhood" className="lkx-api-network-mark" />
                <b>Robinhood</b>
                <i>connected</i>
              </span>
            </div>
          </section>
        </div>

        <div className="lkx-api-result">
          <span className="lkx-api-result-check">
            <Check size={13} strokeWidth={3} />
          </span>
          <span>
            <small>EXECUTION COMPLETE</small>
            <strong>MOON is live</strong>
          </span>
          <code>tx_7xQ4...9Pk2</code>
          <b>201 CREATED</b>
        </div>
      </div>
      <span className="lkx-sr-only">
        Linkr gives AI agents a complete API for launching coins, transferring funds, and buying or
        selling assets across Solana and Robinhood.
      </span>
    </>
  );
}

function WorkflowMovie() {
  return (
    <div className="lkx-flow-shell">
      <div className="lkx-flow-runbar" aria-hidden="true">
        <span>
          <i /> Autonomous run
        </span>
        <strong>Launching MOON across 2 networks</strong>
        <code>RUN / LK-2048</code>
      </div>

      <ol className="lkx-flow" aria-label="From command to confirmed transaction">
        <li className="lkx-flow-node lkx-flow-node--command">
          <div className="lkx-flow-node-head">
            <span className="lkx-flow-orb">
              <XLogo />
            </span>
            <span>
              <small>01 / Intent</small>
              <strong>Command captured</strong>
            </span>
            <i className="lkx-flow-live">Live</i>
          </div>
          <div className="lkx-flow-message" aria-label="Launch MOON on Solana and Robinhood Chain">
            <span>Launch MOON on Solana</span>
            <span>+ Robinhood Chain</span>
            <i aria-hidden="true" />
          </div>
          <div className="lkx-flow-intents" aria-hidden="true">
            <span>MOON</span>
            <span>Solana</span>
            <span>Robinhood</span>
          </div>
          <span className="lkx-flow-state">
            <i /> Intent resolved
          </span>
        </li>

        <li className="lkx-flow-link lkx-flow-link--in" aria-hidden="true">
          <i className="lkx-flow-rail" />
          <i className="lkx-flow-packet" />
          <span>intent.json</span>
        </li>

        <li className="lkx-flow-node lkx-flow-node--agent">
          <div className="lkx-flow-node-head">
            <span className="lkx-flow-orb lkx-flow-orb--agent">
              <Bot aria-hidden="true" size={19} strokeWidth={2.1} />
            </span>
            <span>
              <small>02 / Operator</small>
              <strong>Linkr is executing</strong>
            </span>
            <i className="lkx-flow-live">Secure</i>
          </div>
          <div className="lkx-flow-agent-engine">
            <div className="lkx-flow-brain" aria-hidden="true">
              <i />
              <span>
                <b>Plan</b>
                <b>Build</b>
                <b>Sign</b>
              </span>
            </div>
            <span>
              <small>Execution engine</small>
              <strong>Planning routes</strong>
              <i>Policy checks passed</i>
            </span>
          </div>
          <ul className="lkx-flow-plan" aria-label="Execution plan">
            <li>
              <i>
                <Check aria-hidden="true" size={9} strokeWidth={3} />
              </i>
              <span>Parse intent</span>
              <b>MOON</b>
            </li>
            <li>
              <i>
                <Check aria-hidden="true" size={9} strokeWidth={3} />
              </i>
              <span>Build routes</span>
              <b>2 chains</b>
            </li>
            <li>
              <i>
                <Check aria-hidden="true" size={9} strokeWidth={3} />
              </i>
              <span>Sign + submit</span>
              <b>Ready</b>
            </li>
          </ul>
        </li>

        <li className="lkx-flow-link lkx-flow-link--out" aria-hidden="true">
          <i className="lkx-flow-rail" />
          <i className="lkx-flow-packet lkx-flow-packet--sol" />
          <i className="lkx-flow-packet lkx-flow-packet--rh" />
          <span>broadcast ×2</span>
        </li>

        <li className="lkx-flow-node lkx-flow-node--receipt">
          <div className="lkx-flow-node-head">
            <span className="lkx-flow-orb lkx-flow-orb--done">
              <Check aria-hidden="true" size={18} strokeWidth={2.7} />
            </span>
            <span>
              <small>03 / Outcome</small>
              <strong>Launch finalized</strong>
            </span>
            <i className="lkx-flow-live">Final</i>
          </div>
          <div className="lkx-flow-result">
            <span>2 / 2</span>
            <span>
              <small>Networks live</small>
              <strong>MOON deployed</strong>
            </span>
          </div>
          <div className="lkx-flow-receipt">
            <div>
              <span>Destinations</span>
              <b>Solana + RHC</b>
            </div>
            <div>
              <span>Receipt</span>
              <code>7xQ4…9Pk2</code>
            </div>
          </div>
          <span className="lkx-flow-confirm">
            <Check aria-hidden="true" size={12} strokeWidth={3} /> Finalized onchain
          </span>
        </li>
      </ol>
    </div>
  );
}

const HERO_PLATFORMS = [
  "X",
  "Telegram",
  "Terminal",
  "OpenClaw",
  "Hermes",
  "Codex",
  "Cursor",
  "Claude",
  "MCP",
  "Discord",
] as const;

const PLATFORM_HOLD_MS = 1250;
const PLATFORM_LEAVE_MS = 340;
const PLATFORM_ENTER_MS = 25;

type PlatformFlipPhase = "entering" | "visible" | "leaving";

function HeroPlatformFlip() {
  const [wordIndex, setWordIndex] = useState(0);
  const [phase, setPhase] = useState<PlatformFlipPhase>("visible");
  const word = HERO_PLATFORMS[wordIndex];

  useEffect(() => {
    const delay =
      phase === "visible"
        ? PLATFORM_HOLD_MS
        : phase === "leaving"
          ? PLATFORM_LEAVE_MS
          : PLATFORM_ENTER_MS;
    const timeoutId = window.setTimeout(() => {
      if (phase === "visible") {
        setPhase("leaving");
        return;
      }
      if (phase === "leaving") {
        setWordIndex((index) => (index + 1) % HERO_PLATFORMS.length);
        setPhase("entering");
        return;
      }
      setPhase("visible");
    }, delay);

    return () => window.clearTimeout(timeoutId);
  }, [phase]);

  return (
    <mark className="lkx-hero-flip">
      <span className="lkx-hero-flip-track" aria-hidden="true">
        <span key={word} data-phase={phase}>
          {word}
        </span>
      </span>
      <span className="lkx-sr-only">{HERO_PLATFORMS.join(", ")}</span>
    </mark>
  );
}

export function TerminalHero() {
  const showcaseRef = useRef<HTMLDivElement>(null);
  const activeScreenRef = useRef(0);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeScreen, setActiveScreen] = useState(0);
  const [previousScreen, setPreviousScreen] = useState<number | null>(null);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [showcaseVisible, setShowcaseVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [progressCycle, setProgressCycle] = useState(0);

  const selectScreen = useCallback((nextScreen: number) => {
    const normalizedScreen = (nextScreen + HERO_SCREENS.length) % HERO_SCREENS.length;
    const currentScreen = activeScreenRef.current;

    if (normalizedScreen === currentScreen) return;

    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    setPreviousScreen(currentScreen);
    activeScreenRef.current = normalizedScreen;
    setActiveScreen(normalizedScreen);
    transitionTimerRef.current = setTimeout(() => {
      setPreviousScreen(null);
      transitionTimerRef.current = null;
    }, SCREEN_TRANSITION_MS);
  }, []);

  const autoplayPaused = interactionPaused || !pageVisible || !showcaseVisible || reducedMotion;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setReducedMotion(media.matches);
    updateMotionPreference();
    media.addEventListener("change", updateMotionPreference);
    return () => media.removeEventListener("change", updateMotionPreference);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => setPageVisible(!document.hidden);
    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    const showcase = showcaseRef.current;
    if (!showcase || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => setShowcaseVisible(entry.isIntersecting && entry.intersectionRatio >= 0.45),
      { threshold: [0, 0.45, 1] },
    );
    observer.observe(showcase);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (autoplayPaused) return;
    setProgressCycle((cycle) => cycle + 1);
    const timer = window.setTimeout(
      () => selectScreen(activeScreenRef.current + 1),
      SCREEN_DWELL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [activeScreen, autoplayPaused, selectScreen]);

  useEffect(
    () => () => {
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    },
    [],
  );

  function screenState(index: number) {
    if (index === activeScreen) return "active";
    if (index === previousScreen) return "exit";
    return "idle";
  }

  return (
    <section className="lkx-hero" aria-label="The AI wallet agent for X">
      <div className="lkx-hero-shard" aria-hidden="true" />

      <div className="lkx-hero-copy">
        <h1>
          <span>The AI wallet</span>
          <span>agent for</span>
          <span className="lkx-hero-flip-line">
            <HeroPlatformFlip />
          </span>
        </h1>
        <p className="lkx-hero-lede">
          Launch tokens, send payments, swap, and manage wallets across Solana and Robinhood Chain /{" "}
          <strong>@linkrcash</strong>.
        </p>

        <ul className="lkx-hero-chips">
          {FEATURE_CHIPS.map(({ icon: Icon, label }) => (
            <li key={label}>
              <Icon aria-hidden="true" size={15} strokeWidth={2.4} />
              {label}
            </li>
          ))}
          <li>Solana / Robinhood Chain</li>
        </ul>
      </div>

      <div
        ref={showcaseRef}
        className="lkx-hero-showcase"
        data-autoplay={!autoplayPaused}
        data-screen={activeScreen}
        onMouseEnter={() => setInteractionPaused(true)}
        onMouseLeave={() => setInteractionPaused(false)}
        onFocusCapture={() => setInteractionPaused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setInteractionPaused(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            selectScreen(activeScreenRef.current - 1);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            selectScreen(activeScreenRef.current + 1);
          }
        }}
        role="region"
        aria-roledescription="carousel"
        aria-label="Linkr product previews"
      >
        <div className="lkx-showcase-aura" aria-hidden="true" />
        <div className="lkx-showcase-stage">
          <div className="lkx-showcase-viewport">
            <article
              className="lkx-screen lkx-screen--cli"
              data-state={screenState(0)}
              aria-hidden={activeScreen !== 0}
              aria-label="1 of 6: Linkr CLI"
            >
              <header className="lkx-card-label">
                <i className="lkt-dot" />
                Linkr CLI
              </header>
              <CliMovie active={activeScreen === 0} />
            </article>

            <article
              className="lkx-screen lkx-screen--command"
              data-state={screenState(1)}
              aria-hidden={activeScreen !== 1}
              aria-label="2 of 6: Linkr command"
            >
              <header className="lkx-card-label">
                <i className="lkt-dot" />
                Linkr command
              </header>
              <CommandMovie />
            </article>

            <article
              className="lkx-screen lkx-screen--actions"
              data-state={screenState(2)}
              aria-hidden={activeScreen !== 2}
              aria-label="3 of 6: Wallet actions"
            >
              <header className="lkx-card-label">
                <i className="lkt-dot" />
                Wallet actions
              </header>
              <ActionsMovie />
            </article>

            <article
              className="lkx-screen lkx-screen--api"
              data-state={screenState(3)}
              aria-hidden={activeScreen !== 3}
              aria-label="4 of 6: Agent API"
            >
              <header className="lkx-card-label">
                <i className="lkt-dot" />
                Complete Agent API
              </header>
              <AgentApiMovie />
            </article>

            <article
              className="lkx-screen lkx-screen--networks"
              data-state={screenState(4)}
              aria-hidden={activeScreen !== 4}
              aria-label="5 of 6: Supported networks"
            >
              <header className="lkx-card-label">
                <i className="lkt-dot" />
                Supported networks
              </header>
              <NetworkMovie />
            </article>

            <article
              className="lkx-screen lkx-screen--steps"
              data-state={screenState(5)}
              aria-hidden={activeScreen !== 5}
              aria-label="6 of 6: How it works"
            >
              <header className="lkx-card-label">
                <i className="lkt-dot" />
                How it works
              </header>
              <WorkflowMovie />
            </article>
          </div>

          <div className="lkx-showcase-controls">
            <button
              className="lkx-showcase-arrow"
              type="button"
              onClick={() => selectScreen(activeScreenRef.current - 1)}
              aria-label="Show previous preview"
            >
              <ChevronLeft aria-hidden="true" size={18} strokeWidth={2.4} />
            </button>

            <div className="lkx-showcase-tabs" aria-label="Choose a product preview">
              {HERO_SCREENS.map((screen, index) => (
                <button
                  key={screen}
                  type="button"
                  data-active={activeScreen === index}
                  aria-pressed={activeScreen === index}
                  onClick={() => selectScreen(index)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{screen}</strong>
                  {activeScreen === index && !autoplayPaused && (
                    <i key={progressCycle} aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>

            <button
              className="lkx-showcase-arrow"
              type="button"
              onClick={() => selectScreen(activeScreenRef.current + 1)}
              aria-label="Show next preview"
            >
              <ChevronRight aria-hidden="true" size={18} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
