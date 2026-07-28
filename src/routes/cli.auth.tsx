import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, Check, CheckCircle2, Copy, Loader2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { XLogo } from "@/components/linkr/XLogo";
import { supabase } from "@/integrations/supabase/client";
import {
  beginAuthPopupFlow,
  clearAuthPopupFlow,
  createAuthFlowId,
  subscribeToAuthPopupResults,
  type AuthPopupResult,
} from "@/lib/linkr/auth-popup";

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

type CliAuthState = "idle" | "waiting" | "approving" | "approved" | "blocked" | "error";

const CLI_REQUEST_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const SESSION_INSTALL_RETRIES = 20;
const SESSION_INSTALL_RETRY_MS = 150;

function CliAuthPage() {
  const { request } = Route.useSearch();
  const requestValid = Boolean(request && CLI_REQUEST_PATTERN.test(request));
  const [state, setState] = useState<CliAuthState>(requestValid ? "idle" : "error");
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyResetRef = useRef<number | undefined>(undefined);
  const popupRef = useRef<Window | null>(null);
  const popupCheckRef = useRef<number | undefined>(undefined);
  const activeFlowRef = useRef<string | null>(null);
  const handledFlowRef = useRef<string | null>(null);
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

  const resetXAuthPopup = useCallback((flowId?: string | null) => {
    window.clearInterval(popupCheckRef.current);
    popupCheckRef.current = undefined;
    popupRef.current?.close();
    popupRef.current = null;
    const resolvedFlowId = flowId ?? activeFlowRef.current;
    if (resolvedFlowId) clearAuthPopupFlow(resolvedFlowId);
    activeFlowRef.current = null;
  }, []);

  const approveCliAuth = useCallback(
    async (expectedUserId?: string | null) => {
      if (!request || !requestValid) {
        setState("error");
        setMessage("This CLI authorization link is invalid.");
        return;
      }

      try {
        setState("approving");
        setMessage(null);
        const token = await waitForBrowserSessionToken(expectedUserId);
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
        setCode(String(payload.user_code));
        setState("approved");
        setMessage(null);
        setCopyError(null);
      } catch (error) {
        setCode(null);
        setState("error");
        setMessage(error instanceof Error ? error.message : "CLI authorization failed.");
      }
    },
    [request, requestValid],
  );

  useEffect(() => {
    resetXAuthPopup();
    window.clearTimeout(copyResetRef.current);
    setCopied(false);
    setCopyError(null);
    setCode(null);
    handledFlowRef.current = null;
    if (!requestValid) {
      setState("error");
      setMessage("This CLI authorization link is invalid.");
      return;
    }
    setState("idle");
    setMessage(null);
  }, [request, requestValid, resetXAuthPopup]);

  useEffect(() => {
    const onResult = (data: AuthPopupResult) => {
      const activeFlowId = activeFlowRef.current;
      if (!activeFlowId) return;
      if (data.flowId && data.flowId !== activeFlowId) return;
      if (handledFlowRef.current === activeFlowId) return;
      handledFlowRef.current = activeFlowId;
      resetXAuthPopup(activeFlowId);

      if (data.status === "ok") {
        void approveCliAuth(data.userId);
        return;
      }
      setCode(null);
      setState("error");
      setMessage(
        data.status === "banned"
          ? readableCliAuthError("banned_x_user")
          : readableXAuthError(data.message),
      );
    };

    const unsubscribe = subscribeToAuthPopupResults(onResult);
    return () => {
      unsubscribe();
      resetXAuthPopup();
    };
  }, [approveCliAuth, resetXAuthPopup]);

  useEffect(() => {
    return () => window.clearTimeout(copyResetRef.current);
  }, []);

  function startXAuth() {
    try {
      if (!requestValid) throw new Error("This CLI authorization link is invalid.");
      resetXAuthPopup();
      handledFlowRef.current = null;

      const supabaseUrl =
        import.meta.env.VITE_SUPABASE_URL ||
        (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined);
      if (!supabaseUrl) throw new Error("Supabase URL is not configured.");

      const flowId = createAuthFlowId();
      const redirectTo = new URL("/auth/callback", window.location.origin);
      redirectTo.searchParams.set("auth_popup", "1");
      redirectTo.searchParams.set("auth_flow", flowId);
      redirectTo.searchParams.set("cli_auth", "1");

      const loginUrl = new URL(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/x-oauth/user`);
      loginUrl.searchParams.set("auth_popup", "1");
      loginUrl.searchParams.set("auth_flow", flowId);
      loginUrl.searchParams.set("redirect_to", redirectTo.toString());

      beginAuthPopupFlow(flowId);
      const popup = openCenteredPopup(loginUrl.toString());
      if (!popup) {
        clearAuthPopupFlow(flowId);
        setCode(null);
        setState("blocked");
        setMessage("Popups are blocked. Allow popups for Linkr, then try again.");
        return;
      }

      activeFlowRef.current = flowId;
      popupRef.current = popup;
      popup.focus();
      setCode(null);
      setCopyError(null);
      setState("waiting");
      setMessage(null);
      window.clearInterval(popupCheckRef.current);
      popupCheckRef.current = window.setInterval(() => {
        if (!popup.closed) return;
        window.clearInterval(popupCheckRef.current);
        popupCheckRef.current = undefined;
        popupRef.current = null;
        if (activeFlowRef.current !== flowId) return;
        clearAuthPopupFlow(flowId);
        activeFlowRef.current = null;
        setState((current) => (current === "waiting" ? "idle" : current));
        setMessage("X login window closed before authorization finished.");
      }, 700);
    } catch (error) {
      resetXAuthPopup();
      setCode(null);
      setState("error");
      setMessage(readableXAuthError(error));
    }
  }

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

  const verifying = state === "waiting" || state === "approving";
  const canRetry = requestValid && state === "error";

  return (
    <div className="sm-auth-page app-rayo-launches-page app-rayo-login-page cli-auth-page min-h-screen bg-background text-foreground">
      <main className="app-login-shell">
        <section className="app-login-copy cli-auth-copy" aria-labelledby="cli-auth-title">
          <h1 id="cli-auth-title">
            Linkr CLI.
            <span>X verified.</span>
          </h1>
          <p>
            Authenticate with the X account that should own this CLI session. Linkr only shows the
            terminal code after X verifies the browser.
          </p>
        </section>

        <section className="app-login-panel cli-auth-panel" aria-label="Linkr CLI authorization">
          {(state === "idle" ||
            state === "waiting" ||
            state === "approving" ||
            state === "blocked") && (
            <>
              <div className="app-login-panel-top cli-auth-panel-top">
                <span
                  className="cli-auth-state-icon"
                  data-state={verifying ? "loading" : state === "blocked" ? "error" : "idle"}
                >
                  {verifying ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : state === "blocked" ? (
                    <AlertCircle className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                  )}
                </span>
                <strong>
                  {state === "approving"
                    ? "Preparing CLI code"
                    : state === "waiting"
                      ? "Waiting for X"
                      : "Verify with X"}
                </strong>
                <p>
                  {state === "approving"
                    ? "Linkr is finalizing the terminal authorization."
                    : state === "waiting"
                      ? "Finish X login in the popup, then return here."
                      : "Continue with X before Linkr gives you a one-time CLI code."}
                </p>
              </div>

              <Button
                type="button"
                onClick={startXAuth}
                disabled={verifying || !requestValid}
                size="lg"
                className="app-login-x-button cli-auth-copy-button"
              >
                {verifying ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <XLogo className="h-5 w-5" />
                )}
                {state === "approving"
                  ? "Preparing code..."
                  : state === "waiting"
                    ? "Waiting for X..."
                    : state === "blocked"
                      ? "Try X again"
                      : "Continue with X"}
              </Button>

              {message ? (
                <p
                  className="app-login-status cli-auth-status"
                  data-state={state === "blocked" ? "error" : "waiting"}
                  role={state === "blocked" ? "alert" : "status"}
                >
                  {message}
                </p>
              ) : null}
            </>
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
            <>
              <div className="app-login-panel-top cli-auth-panel-top" role="alert">
                <span className="cli-auth-state-icon" data-state="error">
                  <AlertCircle className="h-5 w-5" aria-hidden="true" />
                </span>
                <strong>CLI authorization failed</strong>
                <p>{message ?? "Start login again from your terminal."}</p>
              </div>

              {canRetry ? (
                <Button
                  type="button"
                  onClick={startXAuth}
                  size="lg"
                  className="app-login-x-button cli-auth-copy-button"
                >
                  <XLogo className="h-5 w-5" />
                  Try X again
                </Button>
              ) : null}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

async function waitForBrowserSessionToken(expectedUserId?: string | null): Promise<string> {
  for (let attempt = 0; attempt < SESSION_INSTALL_RETRIES; attempt += 1) {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const session = data.session;
    if (session?.access_token && (!expectedUserId || session.user.id === expectedUserId)) {
      return session.access_token;
    }
    await delay(SESSION_INSTALL_RETRY_MS);
  }
  throw new Error(
    expectedUserId
      ? "X login finished, but Linkr could not install the matching browser session."
      : "X login finished, but Linkr could not install the browser session.",
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  if (/cli_x_authentication_required/.test(value)) {
    return "Authenticate your X account before Linkr shows this CLI code.";
  }
  if (/expired/.test(value)) return "This CLI login expired. Run linkr login again.";
  if (/banned/.test(value)) return "This X account is not permitted to use Linkr.";
  if (/rate_limit/.test(value)) return "Too many attempts. Wait a moment and try again.";
  return "Start login again from your terminal.";
}

function readableXAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/access_denied/i.test(message)) return "X login cancelled. You can try again anytime.";
  if (/banned|not permitted/i.test(message)) {
    return "This X account is not permitted to use Linkr.";
  }
  if (/requirements/i.test(message)) {
    return "This X account does not currently meet Linkr access requirements.";
  }
  return message || "X login did not finish. You can try again anytime.";
}

function openCenteredPopup(url: string): Window | null {
  const width = 480;
  const height = 720;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  return window.open(
    url,
    "linkr_x_cli_auth",
    [
      "popup=yes",
      `width=${width}`,
      `height=${height}`,
      `left=${Math.round(left)}`,
      `top=${Math.round(top)}`,
      "menubar=no",
      "toolbar=no",
      "location=no",
      "status=no",
      "resizable=yes",
      "scrollbars=yes",
    ].join(","),
  );
}
