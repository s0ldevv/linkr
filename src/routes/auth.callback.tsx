import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { publishAuthPopupResult, readPendingAuthPopupFlow } from "@/lib/linkr/auth-popup";

const TELEGRAM_AUTH_SUCCESS_CLOSE_MS = 2_000;
const AUTH_CALLBACK_STALL_MS = 8_000;

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  head: () => ({ meta: [{ title: "Signing you in..." }] }),
  component: Callback,
});

function Callback() {
  const navigate = useNavigate();
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [smsLinked, setSmsLinked] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);

  // A popup either closes itself or renders a result. If neither happened,
  // never leave the spinner running with no way out. Full-tab callbacks
  // navigate away on their own and must not be interrupted.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const closesItself =
      params.get("auth_popup") === "1" ||
      params.has("auth_flow") ||
      params.has("telegram_link") ||
      params.get("telegram_auth") === "1" ||
      params.has("sms_link") ||
      params.get("sms_auth") === "1" ||
      Boolean(window.opener);
    if (!closesItself) return;
    const timer = window.setTimeout(() => setStalled(true), AUTH_CALLBACK_STALL_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = new URL(window.location.href);
      const isTelegramAuth =
        url.searchParams.has("telegram_link") || url.searchParams.get("telegram_auth") === "1";
      const isSmsAuth =
        url.searchParams.has("sms_link") || url.searchParams.get("sms_auth") === "1";
      const pendingPopup = readPendingAuthPopupFlow();
      const isPopupAuth =
        !isTelegramAuth &&
        !isSmsAuth &&
        (url.searchParams.get("auth_popup") === "1" ||
          url.searchParams.has("auth_flow") ||
          Boolean(pendingPopup));
      const authFlowId = url.searchParams.get("auth_flow") ?? pendingPopup?.flowId ?? null;
      try {
        if (isPopupAuth && url.searchParams.get("auth_status") === "banned") {
          notifyAuthOpener("banned", undefined, authFlowId);
          closeAuthPopup();
          return;
        }
        const callbackError =
          url.searchParams.get("error_description") ?? url.searchParams.get("error");
        if (callbackError) {
          if (!cancelled) {
            if (isTelegramAuth) {
              notifyTelegramAuthOpener("error", callbackError);
              setTelegramError(callbackError);
              return;
            }
            if (isSmsAuth) {
              notifySmsAuthOpener("error", callbackError);
              setSmsError(callbackError);
              return;
            }
            if (isPopupAuth) {
              notifyAuthOpener("error", callbackError, authFlowId);
              closeAuthPopup();
              return;
            }
            toast.error(callbackError);
            navigate({ to: "/auth" });
          }
          return;
        }

        // Let the opener redeem the one-time handoff itself. Installing the
        // session in the popup and waiting for cross-tab auth synchronization is
        // racy in some browsers: the popup and the opener share one origin-wide
        // auth lock, so the popup can block forever on this page. The code
        // expires in 60 seconds, is single-use, and is sent only to the
        // same-origin opener (never persisted).
        const popupHandoffCode = url.searchParams.get("handoff_code");
        if (isPopupAuth && popupHandoffCode) {
          const handoffRedirect = new URL(url.toString());
          handoffRedirect.searchParams.delete("handoff_code");
          notifyAuthOpener("ok", undefined, authFlowId, undefined, {
            code: popupHandoffCode,
            redirectTo: handoffRedirect.toString(),
          });
          // Give BroadcastChannel delivery a brief window when X navigation has
          // severed window.opener. The dashboard closes us immediately on receipt.
          window.setTimeout(closeAuthPopup, 250);
          return;
        }

        const { data, error } = await resolveAuthSession(url);
        if (cancelled) return;
        if (error) {
          if (isTelegramAuth) {
            notifyTelegramAuthOpener("error", error.message);
            setTelegramError(error.message);
            return;
          }
          if (isSmsAuth) {
            notifySmsAuthOpener("error", error.message);
            setSmsError(error.message);
            return;
          }
          if (isPopupAuth) {
            notifyAuthOpener("error", error.message, authFlowId);
            closeAuthPopup();
            return;
          }
          toast.error(error.message);
          navigate({ to: "/auth" });
          return;
        }
        if (data.session) {
          const supabaseUrl =
            import.meta.env.VITE_SUPABASE_URL ||
            (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined);
          if (supabaseUrl) {
            try {
              const res = await fetch(
                `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/ensure-user-bootstrap`,
                {
                  method: "POST",
                  headers: { Authorization: `Bearer ${data.session.access_token}` },
                },
              );
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                if (res.status === 403 && body.error === "banned_x_user") {
                  await supabase.auth.signOut();
                  if (isPopupAuth) {
                    notifyAuthOpener("banned", undefined, authFlowId);
                    closeAuthPopup();
                    return;
                  }
                  navigate({ to: "/auth/banned" });
                  return;
                }
                throw new Error(body.error ?? "Could not prepare your Linkr account.");
              }
            } catch (bootstrapError) {
              if (cancelled) return;
              toast.warning(
                bootstrapError instanceof Error
                  ? bootstrapError.message
                  : "Your Linkr account will finish preparing in the dashboard.",
              );
            }
          }
          if (cancelled) return;
          if (isTelegramAuth) {
            setTelegramLinked(true);
            notifyTelegramAuthOpener("ok");
            await loadTelegramWebAppScript();
            const app = window.Telegram?.WebApp;
            app?.ready?.();
            app?.setHeaderColor?.("#111111");
            app?.setBackgroundColor?.("#111111");
            window.setTimeout(() => {
              if (app?.close) app.close();
              else window.close();
            }, TELEGRAM_AUTH_SUCCESS_CLOSE_MS);
            return;
          }
          if (isSmsAuth) {
            setSmsLinked(true);
            notifySmsAuthOpener("ok");
            window.setTimeout(closeAuthPopup, TELEGRAM_AUTH_SUCCESS_CLOSE_MS);
            return;
          }
          if (isPopupAuth) {
            notifyAuthOpener("ok", undefined, authFlowId, data.session.user.id);
            closeAuthPopup();
            return;
          }
          navigate({ to: "/app" });
        } else {
          if (isTelegramAuth) {
            const message = "No Linkr session was returned. Try the Telegram login again.";
            notifyTelegramAuthOpener("error", message);
            setTelegramError(message);
            return;
          }
          if (isSmsAuth) {
            const message = "No Linkr session was returned. Text LOGIN to Linkr and try again.";
            notifySmsAuthOpener("error", message);
            setSmsError(message);
            return;
          }
          if (isPopupAuth) {
            notifyAuthOpener(
              "error",
              "No Linkr session was returned. Try X login again.",
              authFlowId,
            );
            closeAuthPopup();
            return;
          }
          navigate({ to: "/auth" });
        }
      } catch (unexpectedError) {
        // An unhandled rejection here would leave this window spinning on
        // "Finishing X login..." forever while the opener waits on a result
        // that never arrives. Always report something the opener can act on.
        if (cancelled) return;
        const message =
          unexpectedError instanceof Error
            ? unexpectedError.message
            : "X login did not finish. Try again.";
        if (isTelegramAuth) {
          notifyTelegramAuthOpener("error", message);
          setTelegramError(message);
          return;
        }
        if (isSmsAuth) {
          notifySmsAuthOpener("error", message);
          setSmsError(message);
          return;
        }
        if (isPopupAuth) {
          notifyAuthOpener("error", message, authFlowId);
          closeAuthPopup();
          return;
        }
        toast.error(message);
        navigate({ to: "/auth" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (telegramLinked) {
    return (
      <div className="sm-auth-page app-rayo-launches-page app-rayo-login-page telegram-auth-page telegram-auth-callback-page min-h-screen">
        <main className="telegram-auth-result-shell">
          <section className="app-login-panel telegram-auth-panel telegram-auth-result-panel">
            <CheckCircle2 className="telegram-auth-result-icon" aria-hidden="true" />
            <strong>Linkr is connected.</strong>
            <p>Return to the bot to chat, prepare actions, and confirm them in Telegram.</p>
          </section>
        </main>
      </div>
    );
  }

  if (smsLinked) {
    return (
      <div className="sm-auth-page app-rayo-launches-page app-rayo-login-page telegram-auth-page telegram-auth-callback-page min-h-screen">
        <main className="telegram-auth-result-shell">
          <section className="app-login-panel telegram-auth-panel telegram-auth-result-panel">
            <CheckCircle2 className="telegram-auth-result-icon" aria-hidden="true" />
            <strong>Linkr SMS is connected.</strong>
            <p>
              Return to Messages and text Linkr. Value-moving actions still require an exact
              confirmation reply.
            </p>
          </section>
        </main>
      </div>
    );
  }

  if (telegramError) {
    return (
      <div className="sm-auth-page app-rayo-launches-page app-rayo-login-page telegram-auth-page telegram-auth-callback-page min-h-screen">
        <main className="telegram-auth-result-shell">
          <section
            className="app-login-panel telegram-auth-panel telegram-auth-result-panel telegram-auth-result-panel-error"
            role="alert"
          >
            <AlertCircle className="telegram-auth-result-icon" aria-hidden="true" />
            <strong>{authErrorTitle(telegramError)}</strong>
            <p>{authErrorBody(telegramError)}</p>
            <button
              type="button"
              onClick={() => window.close()}
              className="app-login-x-button telegram-auth-x-button telegram-auth-muted-button"
            >
              Close window
            </button>
          </section>
        </main>
      </div>
    );
  }

  if (smsError) {
    return (
      <div className="sm-auth-page app-rayo-launches-page app-rayo-login-page telegram-auth-page telegram-auth-callback-page min-h-screen">
        <main className="telegram-auth-result-shell">
          <section
            className="app-login-panel telegram-auth-panel telegram-auth-result-panel telegram-auth-result-panel-error"
            role="alert"
          >
            <AlertCircle className="telegram-auth-result-icon" aria-hidden="true" />
            <strong>{authErrorTitle(smsError)}</strong>
            <p>{authErrorBody(smsError)}</p>
            <button
              type="button"
              onClick={() => window.close()}
              className="app-login-x-button telegram-auth-x-button telegram-auth-muted-button"
            >
              Close window
            </button>
          </section>
        </main>
      </div>
    );
  }

  if (stalled) {
    return (
      <div className="sm-auth-page app-rayo-launches-page app-rayo-login-page telegram-auth-page telegram-auth-callback-page min-h-screen">
        <main className="telegram-auth-result-shell">
          <section
            className="app-login-panel telegram-auth-panel telegram-auth-result-panel"
            role="status"
          >
            <AlertCircle className="telegram-auth-result-icon" aria-hidden="true" />
            <strong>X login is taking longer than expected.</strong>
            <p>You can close this window. If Linkr did not sign you in, start the login again.</p>
            <button
              type="button"
              onClick={() => window.close()}
              className="app-login-x-button telegram-auth-x-button telegram-auth-muted-button"
            >
              Close window
            </button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="sm-auth-page app-rayo-launches-page app-rayo-login-page telegram-auth-page telegram-auth-callback-page min-h-screen">
      <main className="telegram-auth-loading-shell">
        <div className="telegram-auth-loading">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
          <p>Finishing X login...</p>
        </div>
      </main>
    </div>
  );
}

function authErrorTitle(message: string): string {
  return /access_denied/i.test(message) ? "X login cancelled." : "X login did not finish.";
}

function authErrorBody(message: string): string {
  if (/access_denied/i.test(message)) {
    return "Close this window to return to Linkr, then try again whenever you are ready.";
  }
  return message;
}

async function resolveAuthSession(url: URL) {
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const hadLegacySessionFragment = fragment.has("access_token") || fragment.has("refresh_token");
  if (url.hash) {
    url.hash = "";
    window.history.replaceState(window.history.state, "", url.toString());
  }

  const handoffCode = url.searchParams.get("handoff_code");
  if (handoffCode) {
    const redirectUrl = new URL(url.toString());
    redirectUrl.searchParams.delete("handoff_code");
    window.history.replaceState(window.history.state, "", redirectUrl.toString());
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!supabaseUrl) return { data: { session: null }, error: new Error("Supabase URL missing") };
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/x-oauth/handoff`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handoff_code: handoffCode,
          redirect_to: redirectUrl.toString(),
        }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.access_token || !payload?.refresh_token) {
      return {
        data: { session: null },
        error: new Error(payload?.error ?? "Login handoff failed"),
      };
    }
    return await supabase.auth.setSession({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
    });
  }
  const code = url.searchParams.get("code");
  if (code) return await supabase.auth.exchangeCodeForSession(code);

  if (hadLegacySessionFragment) {
    return {
      data: { session: null },
      error: new Error("This sign-in link has expired. Start X login again."),
    };
  }

  return await supabase.auth.getSession();
}

function notifyTelegramAuthOpener(status: "ok" | "error", message?: string) {
  if (!window.opener || window.opener.closed) return;
  window.opener.postMessage(
    {
      type: "linkr:telegram-auth",
      status,
      message: message ?? null,
    },
    window.location.origin,
  );
}

function notifySmsAuthOpener(status: "ok" | "error", message?: string) {
  if (!window.opener || window.opener.closed) return;
  window.opener.postMessage(
    { type: "linkr:sms-auth", status, message: message ?? null },
    window.location.origin,
  );
}

function notifyAuthOpener(
  status: "ok" | "error" | "banned",
  message?: string,
  flowId?: string | null,
  userId?: string,
  handoff?: { code: string; redirectTo: string },
) {
  publishAuthPopupResult({
    type: "linkr:auth",
    status,
    message: message ?? null,
    flowId: flowId ?? null,
    userId: userId ?? null,
    handoffCode: handoff?.code ?? null,
    handoffRedirectTo: handoff?.redirectTo ?? null,
  });
}

function closeAuthPopup() {
  window.close();
  window.setTimeout(() => window.close(), 50);
  window.setTimeout(() => window.close(), 250);
}

function loadTelegramWebAppScript(): Promise<void> {
  if (window.Telegram?.WebApp) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(
    'script[src="https://telegram.org/js/telegram-web-app.js"]',
  );
  if (existing) {
    return new Promise((resolve) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      window.setTimeout(resolve, 500);
    });
  }
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
    window.setTimeout(resolve, 900);
  });
}
