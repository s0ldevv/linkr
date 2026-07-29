import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { XLogo } from "@/components/linkr/XLogo";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/telegram/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Connect Linkr on Telegram" },
      { name: "description", content: "Connect X to use Linkr inside Telegram." },
    ],
    scripts: [{ src: "https://telegram.org/js/telegram-web-app.js" }],
  }),
  component: TelegramAuthPage,
});

function TelegramAuthPage() {
  const [status, setStatus] = useState<"idle" | "waiting" | "connected" | "blocked" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const popupCheckRef = useRef<number | undefined>(undefined);
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URL(window.location.href).searchParams.get("telegram_link") ?? "";
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; status?: string; message?: string | null };
      if (data?.type !== "linkr:telegram-auth") return;
      window.clearInterval(popupCheckRef.current);
      popupCheckRef.current = undefined;
      if (data.status !== "ok") {
        popupRef.current?.close();
      }
      popupRef.current = null;
      if (data.status === "ok") {
        setErrorMessage(null);
        setStatus("connected");
      } else {
        setErrorMessage(readableAuthError(data.message));
        setStatus("error");
      }
    };
    const app = window.Telegram?.WebApp;
    app?.ready?.();
    app?.expand?.();
    app?.setHeaderColor?.("#111111");
    app?.setBackgroundColor?.("#111111");

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(popupCheckRef.current);
    };
  }, []);

  function startXAuth() {
    try {
      if (!token) throw new Error("Missing Telegram link token.");
      const supabaseUrl =
        import.meta.env.VITE_SUPABASE_URL ||
        (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined);
      if (!supabaseUrl) throw new Error("Supabase URL is not configured.");

      const redirectTo = new URL("/auth/callback", window.location.origin);
      redirectTo.searchParams.set("telegram_link", token);
      redirectTo.searchParams.set("telegram_auth", "1");

      const loginUrl = new URL(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/x-oauth/user`);
      loginUrl.searchParams.set("redirect_to", redirectTo.toString());

      const popup = openCenteredPopup(loginUrl.toString());
      if (!popup) {
        setErrorMessage("Popups are blocked. Allow popups for Linkr, then try again.");
        setStatus("blocked");
        return;
      }
      popupRef.current = popup;

      setErrorMessage(null);
      setStatus("waiting");
      window.clearInterval(popupCheckRef.current);
      popupCheckRef.current = window.setInterval(() => {
        if (!popup.closed) return;
        window.clearInterval(popupCheckRef.current);
        popupCheckRef.current = undefined;
        popupRef.current = null;
        setStatus((current) => (current === "waiting" ? "idle" : current));
      }, 700);
    } catch (error) {
      setErrorMessage(readableAuthError(error));
      setStatus("error");
    }
  }

  return (
    <div className="sm-auth-page app-rayo-launches-page app-rayo-login-page telegram-auth-page min-h-screen">
      <main className="app-login-shell telegram-auth-shell">
        <section className="app-login-panel telegram-auth-panel" aria-label="Connect X account">
          {status === "connected" ? (
            <div className="telegram-auth-success" aria-live="polite">
              <CheckCircle2 className="telegram-auth-success-icon" aria-hidden="true" />
              <strong>Authenticated</strong>
            </div>
          ) : (
            <>
              <div className="app-login-panel-top telegram-auth-panel-top">
                <strong>Connect X</strong>
                <p>Authorize once, then return to Telegram to chat with Linkr.</p>
              </div>

              {!token ? (
                <p className="telegram-auth-status" data-state="error" role="alert">
                  This Telegram login link is missing or expired. Go back to the bot and tap /login
                  again.
                </p>
              ) : (
                <Button
                  onClick={startXAuth}
                  disabled={status === "waiting"}
                  size="lg"
                  className="app-login-x-button telegram-auth-x-button"
                >
                  {status === "waiting" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <XLogo className="h-5 w-5" />
                  )}
                  {status === "waiting" ? "Waiting for X..." : "Continue with X"}
                </Button>
              )}

              {token && errorMessage ? (
                <p className="telegram-auth-status" data-state={status} role="alert">
                  {errorMessage}
                </p>
              ) : null}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function readableAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/access_denied/i.test(message)) return "X login cancelled. You can try again anytime.";
  if (/Missing Telegram link token/i.test(message)) {
    return "This Telegram login link is missing or expired. Go back to the bot and tap /login again.";
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
    "linkr_x_login",
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
