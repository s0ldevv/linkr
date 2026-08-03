import { FormEvent, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { MarketingHeader } from "@/components/linkr/MarketingHeader";
import "@/components/linkr/bugs-page.css";
import { supabase } from "@/integrations/supabase/client";

type BugReportResponse = {
  ok?: boolean;
  report?: { id: string; created_at: string };
};

type BugForm = {
  title: string;
  category: string;
  severity: string;
  description: string;
  steps_to_reproduce: string;
  expected_behavior: string;
  page_path: string;
  website: string;
};

const EMPTY_FORM: BugForm = {
  title: "",
  category: "functionality",
  severity: "medium",
  description: "",
  steps_to_reproduce: "",
  expected_behavior: "",
  page_path: "",
  website: "",
};

export const Route = createFileRoute("/bugs")({
  head: () => ({
    meta: [
      { title: "Report a bug - Linkr" },
      {
        name: "description",
        content: "Tell Linkr what broke with a quick, anonymous bug report.",
      },
    ],
  }),
  component: BugsPage,
});

export function BugsPage() {
  const [form, setForm] = useState<BugForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [reportId, setReportId] = useState<string | null>(null);

  function updateField<Key extends keyof BugForm>(key: Key, value: BugForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    const { data, error } = await supabase.functions.invoke<BugReportResponse>("bug-report", {
      body: form,
    });

    setSubmitting(false);
    if (error || !data?.ok) {
      setErrorMessage(
        error?.message === "Failed to send a request to the Edge Function"
          ? "Linkr could not receive the report. Check your connection and try again."
          : "That report could not be sent. Please review it and try again.",
      );
      return;
    }

    setReportId(data.report?.id ?? "received");
  }

  function startAnotherReport() {
    setForm(EMPTY_FORM);
    setErrorMessage("");
    setReportId(null);
  }

  return (
    <div className="sm-bugs-page">
      <MarketingHeader />

      <main className="sm-bugs-main">
        <div className="sm-bugs-grid">
          <section className="sm-bugs-copy" aria-labelledby="bugs-title">
            <p className="sm-bugs-kicker">Make Linkr sharper</p>
            <h1 id="bugs-title">
              Found a <span>glitch?</span>
            </h1>
            <p className="sm-bugs-lede">
              Tell us what happened and where. A clear report helps us trace the problem and ship
              the fix faster.
            </p>

            <div className="sm-bugs-promise" aria-label="What to expect">
              <div>
                <span>01</span>
                <strong>No name or email</strong>
              </div>
              <div>
                <span>02</span>
                <strong>Reviewed by the Linkr team</strong>
              </div>
              <div>
                <span>03</span>
                <strong>Useful detail beats volume</strong>
              </div>
            </div>
          </section>

          {reportId ? (
            <section className="sm-bugs-success" aria-live="polite">
              <span className="sm-bugs-success-icon" aria-hidden="true">
                <Check size={36} strokeWidth={2.8} />
              </span>
              <h2>Report received.</h2>
              <p>Thanks for making Linkr better. The report is now in the team&apos;s fix queue.</p>
              {reportId !== "received" ? (
                <p className="sm-bugs-reference">Reference {reportId.slice(0, 8)}</p>
              ) : null}
              <button className="sm-bugs-submit" type="button" onClick={startAnotherReport}>
                Report another bug
                <ArrowRight size={18} strokeWidth={2.5} />
              </button>
            </section>
          ) : (
            <section className="sm-bugs-form-shell" aria-labelledby="bug-form-title">
              <div className="sm-bugs-form-heading">
                <div>
                  <span>Anonymous report</span>
                  <h2 id="bug-form-title">What went wrong?</h2>
                </div>
                <span className="sm-bugs-form-number" aria-hidden="true">
                  01
                </span>
              </div>

              <form className="sm-bugs-form" onSubmit={submitReport}>
                <label className="sm-bugs-field">
                  <span>Short summary</span>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(event) => updateField("title", event.target.value)}
                    minLength={5}
                    maxLength={140}
                    placeholder="Swap confirmation stays stuck"
                    autoComplete="off"
                    required
                  />
                </label>

                <div className="sm-bugs-field-row">
                  <label className="sm-bugs-field">
                    <span>Area</span>
                    <select
                      value={form.category}
                      onChange={(event) => updateField("category", event.target.value)}
                    >
                      <option value="functionality">Feature / functionality</option>
                      <option value="transaction">Transaction</option>
                      <option value="wallet">Wallet</option>
                      <option value="account">Account</option>
                      <option value="interface">Interface / layout</option>
                      <option value="other">Something else</option>
                    </select>
                  </label>

                  <label className="sm-bugs-field">
                    <span>Impact</span>
                    <select
                      value={form.severity}
                      onChange={(event) => updateField("severity", event.target.value)}
                    >
                      <option value="low">Low — small annoyance</option>
                      <option value="medium">Medium — feature is difficult</option>
                      <option value="high">High — feature is blocked</option>
                      <option value="critical">Critical — funds or security</option>
                    </select>
                  </label>
                </div>

                <label className="sm-bugs-field">
                  <span>What happened?</span>
                  <textarea
                    className="sm-bugs-description"
                    value={form.description}
                    onChange={(event) => updateField("description", event.target.value)}
                    minLength={20}
                    maxLength={4000}
                    placeholder="Describe what you saw, including any message Linkr showed."
                    required
                  />
                </label>

                <label className="sm-bugs-field">
                  <span>
                    Steps to reproduce <small>— optional</small>
                  </span>
                  <textarea
                    value={form.steps_to_reproduce}
                    onChange={(event) => updateField("steps_to_reproduce", event.target.value)}
                    maxLength={4000}
                    placeholder="1. Opened Wallet  2. Chose Swap  3. ..."
                  />
                </label>

                <div className="sm-bugs-field-row">
                  <label className="sm-bugs-field">
                    <span>
                      Expected result <small>— optional</small>
                    </span>
                    <input
                      type="text"
                      value={form.expected_behavior}
                      onChange={(event) => updateField("expected_behavior", event.target.value)}
                      maxLength={2000}
                      placeholder="What should have happened?"
                    />
                  </label>

                  <label className="sm-bugs-field">
                    <span>
                      Page or route <small>— optional</small>
                    </span>
                    <input
                      type="text"
                      value={form.page_path}
                      onChange={(event) => updateField("page_path", event.target.value)}
                      maxLength={500}
                      placeholder="/app/wallet"
                      autoComplete="off"
                    />
                  </label>
                </div>

                <label className="sm-bugs-honeypot" aria-hidden="true">
                  Website
                  <input
                    type="text"
                    value={form.website}
                    onChange={(event) => updateField("website", event.target.value)}
                    tabIndex={-1}
                    autoComplete="off"
                  />
                </label>

                {errorMessage ? (
                  <p className="sm-bugs-error" role="alert">
                    {errorMessage}
                  </p>
                ) : null}

                <button className="sm-bugs-submit" type="submit" disabled={submitting}>
                  {submitting ? (
                    <Loader2 data-loading="true" size={19} strokeWidth={2.5} />
                  ) : (
                    <ArrowRight size={19} strokeWidth={2.5} />
                  )}
                  {submitting ? "Sending report" : "Send bug report"}
                </button>
                <p className="sm-bugs-fine-print">
                  No personal information is requested or attached to this report.
                </p>
              </form>
            </section>
          )}
        </div>
      </main>

      <footer className="sm-bugs-footer">
        <p>© {new Date().getFullYear()} Linkr. Built in public, fixed in public.</p>
        <nav aria-label="Bug page footer">
          <Link to="/">Home</Link>
          <Link to="/docs">Docs</Link>
          <Link to="/privacy-policy">Privacy</Link>
        </nav>
      </footer>
    </div>
  );
}
