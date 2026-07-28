import { Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, MessageCircle, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { xIntent } from "@/lib/linkr/home-data";

const HERO_WORDS = [
  "Wallet",
  "transfers",
  "rewards",
  "launches",
  "buys",
  "sells",
  "queries",
  "analytics",
  "claims",
  "questions",
  "Dex info",
  "trends",
  "research",
] as const;
const HERO_WORD_LABEL = HERO_WORDS.join(", ");
const HERO_WORD_HOLD_MS = 2040;
const HERO_WORD_TRANSITION_MS = 180;

type HeroWordPhase = "entering" | "visible" | "leaving";

function HeroWordRail() {
  const [wordIndex, setWordIndex] = useState(0);
  const [wordPhase, setWordPhase] = useState<HeroWordPhase>("visible");
  const word = HERO_WORDS[wordIndex];

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => {
        if (wordPhase === "visible") {
          setWordPhase("leaving");
          return;
        }

        if (wordPhase === "leaving") {
          setWordIndex((index) => (index + 1) % HERO_WORDS.length);
          setWordPhase("entering");
          return;
        }

        setWordPhase("visible");
      },
      wordPhase === "visible" ? HERO_WORD_HOLD_MS : HERO_WORD_TRANSITION_MS,
    );

    return () => window.clearTimeout(timeoutId);
  }, [wordPhase]);

  return (
    <em className="sm-linkr-hero-word-rail">
      <span className="sm-linkr-hero-word-track" aria-hidden="true">
        <span key={word} data-phase={wordPhase}>
          {word}
        </span>
      </span>
      <span className="sm-rayo-title-accessible">{HERO_WORD_LABEL}</span>
    </em>
  );
}

export function HeroCopy() {
  const { user } = useAuth();

  return (
    <div className="sm-hero-copy sm-rayo-hero-copy sm-linkr-hero-copy" data-fx-hero>
      <section className="sm-linkr-hero-shell" aria-label="Linkr command hero">
        <div className="sm-linkr-hero-layout">
          <div className="sm-linkr-hero-support">
            <div className="sm-linkr-hero-main">
              <h1 className="sm-linkr-hero-title">
                <span className="sm-linkr-hero-title-primary" data-fx-hero-intro>
                  <span>Let</span>
                  <span>Linkr</span>
                </span>
                <span className="sm-linkr-hero-line">
                  <span className="sm-linkr-hero-title-copy">handle your</span>
                </span>
                <span className="sm-linkr-hero-pill-line">
                  <HeroWordRail />
                </span>
              </h1>

              <p className="sm-linkr-hero-tagline" data-fx-hero-intro>
                Move from an X reply to a guarded Robinhood Chain or Solana action without digging
                through dashboards. Linkr reads the command, checks your saved rules, and keeps the
                receipt close.
              </p>

              <div className="sm-linkr-hero-actions" data-fx-hero-intro>
                <Link className="sm-linkr-hero-cta" data-magnetic to={user ? "/app" : "/auth"}>
                  {user ? "Open dashboard" : "Start with X"}
                  <ArrowRight aria-hidden="true" size={19} />
                </Link>
                <a
                  className="sm-linkr-hero-cta sm-linkr-hero-cta-ghost"
                  data-magnetic
                  href={xIntent("@linkrcash buy $100 of this")}
                  rel="noreferrer"
                  target="_blank"
                >
                  Try @linkrcash
                  <ArrowUpRight aria-hidden="true" size={18} />
                </a>
              </div>
            </div>

            <aside className="sm-linkr-command-stage" aria-label="Linkr command routing preview">
              <div className="sm-linkr-command-card" data-fx-hero-intro>
                <div className="sm-linkr-command-card-head">
                  <span>
                    <MessageCircle aria-hidden="true" size={16} />X reply
                  </span>
                  <b>
                    <ShieldCheck aria-hidden="true" size={15} />
                    rules checked
                  </b>
                </div>
                <p>@linkrcash buy $100 of this and use my saved limits</p>
                <div className="sm-linkr-command-card-foot">
                  <span>Read reply</span>
                  <span>Match wallet</span>
                  <span>Prepare receipt</span>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
}
