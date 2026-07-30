import { MessageCircle, Receipt, ScanText, ShieldCheck } from "lucide-react";
import type { SystemStatusEntry } from "@/lib/linkr/home-data";
import { allSystemsOperational, systemStatusRows } from "./terminal-data";

const STEPS = [
  {
    num: "01",
    icon: MessageCircle,
    title: "You post a reply",
    text: "Tweet or reply @linkrbot with what you want to do.",
  },
  {
    num: "02",
    icon: ScanText,
    title: "Linkr reads it",
    text: "Our AI parses your intent and prepares the action.",
  },
  {
    num: "03",
    icon: ShieldCheck,
    title: "We execute it",
    text: "Secure execution on supported chains within your saved rules.",
  },
  {
    num: "04",
    icon: Receipt,
    title: "You get receipts",
    text: "Instant confirmation and a receipt on the transaction.",
  },
];

const STATE_LABELS: Record<string, string> = {
  degraded: "Degraded",
  down: "Down",
  ok: "Healthy",
};

export function TerminalWorkflow({ status }: { status: SystemStatusEntry[] | undefined }) {
  const rows = systemStatusRows(status);
  const operational = allSystemsOperational(status);
  const hasData = (status?.length ?? 0) > 0;

  return (
    <div className="lkt-bottom lkt-workflow-band" id="workflow">
      <div className="lkt-workflow-side">
        <section className="lkt-workflow-intro" aria-label="How Linkr works">
          <span className="lkt-workflow-tag">Linkr Workflow</span>
          <h2>
            From reply
            <br />
            to receipt
          </h2>
        </section>

        <section className="lkt-status" id="system" aria-label="System status">
          <h2 className="lkt-status-title">System Status</h2>
          <ul className="lkt-status-list">
            {rows.map((row) => (
              <li key={row.label}>
                <span className="lkt-status-src">
                  <span
                    className="lkt-dot"
                    style={{ background: "currentColor", boxShadow: "none" }}
                    aria-hidden="true"
                  />
                  {row.label}
                </span>
                <span className="lkt-status-state" data-state={row.status}>
                  {row.hasData ? (STATE_LABELS[row.status] ?? row.status) : "Healthy"}
                </span>
              </li>
            ))}
          </ul>
          <div className="lkt-status-foot">
            {hasData
              ? operational
                ? "All Systems Operational"
                : "Degraded Performance"
              : "All Systems Operational"}
          </div>
        </section>
      </div>

      <section className="lkt-steps" aria-label="Workflow steps">
        {STEPS.map((step) => (
          <article className="lkt-step" key={step.num}>
            <span className="lkt-step-ghost" aria-hidden="true">
              {step.num}
            </span>
            <span className="lkt-step-icon" aria-hidden="true">
              <step.icon size={20} strokeWidth={2.2} />
            </span>
            <div className="lkt-step-body">
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
