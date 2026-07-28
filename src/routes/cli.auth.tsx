import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, Check, CheckCircle2, Copy, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { authSearchFor } from "@/lib/linkr/auth-return";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/cli/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { request?: string } => {
    const request = typeof search.request === "string" ? search.request : undefined;
    return request ? { request } : {};
  },
  head: () => ({
    meta: [
      { title: "Linkr CLI authorization" },
      {
        name: "description",
        content: "Authorize the Linkr CLI from your browser.",
      },
    ],
  }),
  component: CliAuthPage,
});

function CliAuthPage() {
  const navigate = useNavigate();
  const { request } = Route.useSearch();
  const { user, loading } = useAuth();
  const [state, setState] = useState<"loading" | "approved" | "error">("loading");
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyResetRef = useRef<number | undefined>(undefined);
  const returnPath = useMemo(
    () => `/cli/auth${request ? `?request=${encodeURIComponent(request)}` : ""}`,
    [request],
  );
  const codeGroups = useMemo(
    () =>
      code
        ? code
            .split("-")
            .filter(Boolean)
            .map((part) => Array.from(part))
        : [],
    [code],
  );

  useEffect(() => {
    return () => window.clearTimeout(copyResetRef.current);
  }, []);

  useEffect(() => {
    if (!request || !/^[A-Za-z0-9_-]{32,256}$/.test(request)) {
      setState("error");
      setMessage("This CLI authorization link is invalid.");
      return;
    }
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth", search: authSearchFor(returnPath), replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setState("loading");
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Sign in again to authorize the CLI.");
        const response = await fetch("/api/cli/auth/approve", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ request_code: request }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.user_code) {
          const errorCode = payload?.error?.code ?? payload?.error ?? "cli_auth_failed";
          throw new Error(readableCliAuthError(errorCode));
        }
        if (cancelled) return;
        setCode(String(payload.user_code));
        setState("approved");
        setMessage(null);
        setCopyError(null);
      } catch (error) {
        if (cancelled) return;
        setState("error");
        setMessage(error instanceof Error ? error.message : "CLI authorization failed.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, navigate, request, returnPath, user]);

  async function copyCode() {
    if (!code) return;
    try {
      await writeClipboard(code);
      window.clearTimeout(copyResetRef.current);
      setCopied(true);
      setCopyError(null);
      copyResetRef.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
      setCopyError("Copy failed. Type this code into your terminal.");
    }
  }

  return (
    <div className="sm-auth-page app-rayo-launches-page app-rayo-login-page cli-auth-page min-h-screen bg-background text-foreground">
      <main className="app-login-shell">
        <section className="app-login-copy cli-auth-copy" aria-labelledby="cli-auth-title">
          <h1 id="cli-auth-title">
            Linkr CLI.
            <span>Browser verified.</span>
          </h1>
          <p>
            Approve this login in your browser, then paste the one-time code back into your
            terminal.
          </p>
        </section>

        <section className="app-login-panel cli-auth-panel" aria-label="Linkr CLI authorization">
          {state === "loading" && (
            <div className="app-login-panel-top cli-auth-panel-top">
              <span className="cli-auth-state-icon" data-state="loading">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              </span>
              <strong>Authorizing CLI</strong>
              <p>Keep this tab open while Linkr verifies the terminal request.</p>
            </div>
          )}

          {state === "approved" && code && (
            <>
              <div className="app-login-panel-top cli-auth-panel-top">
                <span className="cli-auth-state-icon" data-state="approved">
                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                </span>
                <strong>Paste this code</strong>
                <p>The terminal is waiting for this one-time authorization code.</p>
              </div>

              <div className="cli-auth-code-card" aria-label={`CLI authorization code ${code}`}>
                <div className="cli-auth-code-groups" aria-hidden="true">
                  {codeGroups.map((group, groupIndex) => (
                    <div className="cli-auth-code-group" key={`${group.join("")}-${groupIndex}`}>
                      {group.map((glyph, index) => (
                        <span
                          className="cli-auth-code-cell"
                          key={`${glyph}-${groupIndex}-${index}`}
                        >
                          {glyph}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
                <code className="sr-only">{code}</code>
              </div>

              <Button
                type="button"
                onClick={copyCode}
                size="lg"
                className="app-login-x-button cli-auth-copy-button"
                data-copied={copied}
              >
                {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                {copied ? "Copied" : "Copy code"}
              </Button>

              {copyError ? (
                <p className="app-login-status cli-auth-status" data-state="error" role="alert">
                  {copyError}
                </p>
              ) : null}
            </>
          )}

          {state === "error" && (
            <div className="app-login-panel-top cli-auth-panel-top" role="alert">
              <span className="cli-auth-state-icon" data-state="error">
                <AlertCircle className="h-5 w-5" aria-hidden="true" />
              </span>
              <strong>CLI authorization failed</strong>
              <p>{message ?? "Start login again from your terminal."}</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

async function writeClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy_failed");
}

function readableCliAuthError(code: unknown): string {
  const value = String(code ?? "");
  if (/expired/.test(value)) return "This CLI login expired. Run linkr login again.";
  if (/banned/.test(value)) return "This X account is not permitted to use Linkr.";
  if (/rate_limit/.test(value)) return "Too many attempts. Wait a moment and try again.";
  return "Start login again from your terminal.";
}
