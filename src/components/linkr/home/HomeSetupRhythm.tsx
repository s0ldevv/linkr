import { CheckCircle2, ShieldCheck, Twitter, Wallet } from "lucide-react";

const setupSteps = [
  {
    icon: Twitter,
    title: "Connect X",
    body: "Sign in with the X account that will tag @linkrbot.",
  },
  {
    icon: Wallet,
    title: "Wallet appears",
    body: "Linkr automatically prepares an encrypted wallet for your X account.",
  },
  {
    icon: ShieldCheck,
    title: "Default limits",
    body: "Starter buy, sell, launch, and slippage limits are active immediately.",
  },
  {
    icon: CheckCircle2,
    title: "Reply on X",
    body: "Linkr reads the thread and records every completed action in your history.",
  },
];

export function HomeSetupRhythm() {
  return (
    <section
      className="sm-home-section sm-setup-section sm-safety-rhythm sm-rayo-approach-section"
      id="setup"
    >
      <div className="sm-home-section-copy">
        <p data-fx="rise">Setup rhythm</p>
        <h2 data-fx="chars">A wallet that is ready before the first command.</h2>
      </div>
      <div className="sm-setup-grid" data-fx-group>
        {setupSteps.map((step, index) => (
          <article key={step.title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <step.icon aria-hidden="true" size={22} />
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
