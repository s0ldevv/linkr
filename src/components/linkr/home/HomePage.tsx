import { MarketingHeader } from "@/components/linkr/MarketingHeader";
import { useHomeDashboardData } from "@/hooks/use-home-dashboard-data";
import { useHomeScrollFx } from "@/hooks/use-home-scroll-fx";
import { xIntent } from "@/lib/linkr/home-data";
import { HomeHero } from "./HomeHero";

const commandExamples = [
  {
    title: "Buy in context",
    note: "For fast entries while reading a live thread.",
    command: "@linkrbot buy $100 of this",
  },
  {
    title: "Trim a position",
    note: "Percentage sells stay bounded by the rules you saved.",
    command: "@linkrbot sell 50% of this",
  },
  {
    title: "Move ETH",
    note: "Send from the same command wallet without opening another tab.",
    command: "@linkrbot send 0.25 ETH to 7xKQ...",
  },
  {
    title: "Launch from media",
    note: "A reply can carry the symbol, image, and dev-buy envelope.",
    command: "@linkrbot launch $TOKEN with this image",
  },
  {
    title: "Ask for context",
    note: "When the thread is noisy, Linkr can pull out the contract trail.",
    command: "@linkrbot what is the CA above?",
  },
];

export function HomePage() {
  const dashboardQuery = useHomeDashboardData();
  useHomeScrollFx();

  return (
    <div className="sm-home sm-home-rebuild">
      <MarketingHeader />
      <main>
        <HomeHero query={dashboardQuery} />

        <section className="sm-rayo-word-marquee" aria-hidden="true">
          <div data-fx="marquee-scrub" style={{ marginTop: "3rem" }}>
            <span>Replies</span>
            <i />
            <span>Rules</span>
            <i />
            <span>Wallets</span>
            <i />
            <span>Receipts</span>
            <i />
            <span>Explore</span>
            <i />
          </div>
        </section>

        <section className="sm-home-section sm-command-studio sm-rayo-stack-section" id="commands">
          <div className="sm-home-section-copy">
            <p data-fx="rise">Command language</p>
            <h2 data-fx="chars">Short replies, designed to be read under pressure.</h2>
          </div>
          <div className="sm-command-studio-layout">
            <div className="sm-command-note" data-fx="rise">
              <span>Grammar</span>
              <strong>@linkrbot</strong>
              <p>
                One command prefix, then the smallest phrase that describes the wallet action. The
                dashboard carries the details that do not belong in a tweet.
              </p>
            </div>
            <div className="sm-command-grid" data-fx-group>
              {commandExamples.map((example, index) => (
                <a
                  key={example.title}
                  href={xIntent(example.command)}
                  target="_blank"
                  rel="noreferrer"
                  data-command-index={index}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{example.title}</strong>
                  <p>{example.note}</p>
                  <code>{example.command}</code>
                </a>
              ))}
            </div>
          </div>
        </section>
      </main>
      <footer className="sm-rayo-footer" aria-label="Footer">
        <div data-fx="rise">linkr</div>
        <p data-fx="rise">Reply on X. Check the rules. Sign only what should move.</p>
      </footer>
    </div>
  );
}
