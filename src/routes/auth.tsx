import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { XLogo } from "@/components/linkr/XLogo";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeAuthReturnTo } from "@/lib/linkr/auth-return";
import {
  beginAuthPopupFlow,
  clearAuthPopupFlow,
  createAuthFlowId,
  readAuthPopupResultForFlow,
  subscribeToAuthPopupResults,
  type AuthPopupResult,
} from "@/lib/linkr/auth-popup";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => {
    const returnTo = typeof search.returnTo === "string" ? search.returnTo : undefined;
    return returnTo ? { returnTo } : {};
  },
  head: () => ({
    meta: [
      { title: "Sign in - Linkr" },
      { name: "description", content: "Sign in with X to access your Linkr wallet." },
    ],
  }),
  component: AuthPage,
});

const SESSION_INSTALL_RETRIES = 20;
const SESSION_INSTALL_RETRY_MS = 150;
const AUTH_POPUP_CHECK_MS = 700;
const AUTH_POPUP_CLOSED_GRACE_MS = 2_500;
const AUTH_POPUP_TIMEOUT_MS = 10 * 60 * 1000;
const AUTH_HANDOFF_TIMEOUT_MS = 15_000;
const SESSION_INSTALL_FAILED =
  "X login finished, but Linkr could not install your session. Try again.";

function AuthPage() {
  const navigate = useNavigate();
  const { returnTo } = Route.useSearch();
  const authDestination = sanitizeAuthReturnTo(returnTo);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  const isAuthIndex = normalizedPathname === "/auth";
  const { user, loading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [popupMayBeDetached, setPopupMayBeDetached] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const popupCheckRef = useRef<number | undefined>(undefined);
  const activeFlowRef = useRef<string | null>(null);
  const handledFlowRef = useRef<string | null>(null);

  useEffect(() => {
    if (isAuthIndex && !loading && user && !signingIn && !finalizing) {
      navigate({ to: authDestination as never, replace: true });
    }
  }, [authDestination, isAuthIndex, user, loading, navigate, signingIn, finalizing]);

  const resetAuthPopup = useCallback((flowId?: string | null) => {
    window.clearInterval(popupCheckRef.current);
    popupCheckRef.current = undefined;
    popupRef.current?.close();
    popupRef.current = null;
    const resolvedFlowId = flowId ?? activeFlowRef.current;
    if (resolvedFlowId) clearAuthPopupFlow(resolvedFlowId);
    activeFlowRef.current = null;
  }, []);

  const finishSignIn = useCallback(
    async (data: AuthPopupResult) => {
      setFinalizing(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        // The popup hands the one-time code over instead of redeeming it, so the
        // session is installed here, in the window that is about to navigate.
        if (data.handoffCode && data.handoffRedirectTo) {
          await installAuthSession(data.handoffCode, data.handoffRedirectTo, data.userId);
        } else {
          await waitForInstalledSession(data.userId);
        }
        setFinalizing(false);
        setSigningIn(false);
        navigate({ to: authDestination as never, replace: true });
      } catch (error) {
        setFinalizing(false);
        setSigningIn(false);
        const message = readableAuthError(error);
        setErrorMessage(message);
        toast.error(message);
      }
    },
    [authDestination, navigate],
  );

  const handleAuthPopupResult = useCallback(
    (data: AuthPopupResult) => {
      const activeFlowId = activeFlowRef.current;
      if (!activeFlowId) return;
      if (data.flowId && data.flowId !== activeFlowId) return;
      if (handledFlowRef.current === activeFlowId) return;
      handledFlowRef.current = activeFlowId;
      resetAuthPopup(activeFlowId);
      setPopupMayBeDetached(false);

      if (data.status === "ok") {
        void finishSignIn(data);
        return;
      }

      setFinalizing(false);
      setSigningIn(false);
      setStatusMessage(null);
      if (data.status === "banned") {
        setErrorMessage(null);
        navigate({ to: "/auth/banned" });
        return;
      }
      const message = readableAuthError(data.message);
      setErrorMessage(message);
      toast.error(message);
    },
    [finishSignIn, navigate, resetAuthPopup],
  );

  useEffect(() => subscribeToAuthPopupResults(handleAuthPopupResult), [handleAuthPopupResult]);

  useEffect(() => () => resetAuthPopup(), [resetAuthPopup]);

  if (!isAuthIndex) return <Outlet />;

  function signInWithX() {
    try {
      resetAuthPopup();
      handledFlowRef.current = null;
      setSigningIn(true);
      setErrorMessage(null);
      setStatusMessage(null);
      setPopupMayBeDetached(false);

      const supabaseUrl =
        import.meta.env.VITE_SUPABASE_URL ||
        (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined);
      if (!supabaseUrl) throw new Error("Supabase URL is not configured.");

      const loginUrl = new URL(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/x-oauth/user`);
      const redirectTo = new URL("/auth/callback", window.location.origin);
      const flowId = createAuthFlowId();
      redirectTo.searchParams.set("auth_popup", "1");
      redirectTo.searchParams.set("auth_flow", flowId);
      loginUrl.searchParams.set("auth_popup", "1");
      loginUrl.searchParams.set("auth_flow", flowId);
      loginUrl.searchParams.set("redirect_to", redirectTo.toString());
      beginAuthPopupFlow(flowId);

      const popup = openCenteredPopup(loginUrl.toString());
      if (!popup) {
        clearAuthPopupFlow(flowId);
        setSigningIn(false);
        const message = "Popups are blocked. Allow popups for Linkr, then try again.";
        setErrorMessage(message);
        toast.error(message);
        return;
      }
      popupRef.current = popup;
      activeFlowRef.current = flowId;
      popup.focus();

      const startedAt = Date.now();
      let closedAt: number | null = null;
      let detachedNoticeShown = false;
      popupCheckRef.current = window.setInterval(() => {
        if (activeFlowRef.current !== flowId) {
          window.clearInterval(popupCheckRef.current);
          popupCheckRef.current = undefined;
          return;
        }

        // Covers results that reached storage but whose postMessage and
        // BroadcastChannel delivery were dropped.
        const storedResult = readAuthPopupResultForFlow(flowId);
        if (storedResult) {
          handleAuthPopupResult(storedResult);
          return;
        }

        if (Date.now() - startedAt >= AUTH_POPUP_TIMEOUT_MS) {
          resetAuthPopup(flowId);
          setSigningIn(false);
          setPopupMayBeDetached(false);
          setStatusMessage("X login did not finish. You can try again anytime.");
          return;
        }

        // `popup.closed` is not a reliable cancel signal: this app sends
        // Cross-Origin-Opener-Policy: same-origin-allow-popups, so navigating to
        // X can swap the browsing context group and report the still-open popup
        // as closed. Never tear the flow down here. After a short grace, only
        // offer a way back in and keep listening until the timeout above.
        if (!popup.closed || detachedNoticeShown) return;
        if (closedAt === null) {
          closedAt = Date.now();
          return;
        }
        if (Date.now() - closedAt < AUTH_POPUP_CLOSED_GRACE_MS) return;
        detachedNoticeShown = true;
        popupRef.current = null;
        setPopupMayBeDetached(true);
        setStatusMessage(
          "Still waiting for X. If the login window is gone, continue with X again.",
        );
      }, AUTH_POPUP_CHECK_MS);
    } catch (error) {
      resetAuthPopup();
      setFinalizing(false);
      setSigningIn(false);
      setStatusMessage(null);
      setPopupMayBeDetached(false);
      const message = readableAuthError(error);
      setErrorMessage(message);
      toast.error(message);
    }
  }

  // A detached popup leaves the button live so the user is never stranded.
  const busy = finalizing || (signingIn && !popupMayBeDetached);

  return (
    <div className="sm-auth-page app-rayo-launches-page app-rayo-login-page min-h-screen bg-background text-foreground">
      <main className="app-login-shell">
        <section className="app-login-copy" aria-labelledby="login-title">
          <h1 id="login-title">
            Connect X.
            <span>Command Linkr.</span>
          </h1>
          <p>
            Sign in with the X account you will reply from. Linkr maps that handle to your wallet,
            then applies conservative limits you can adjust anytime.
          </p>
        </section>

        <section className="app-login-panel" aria-label="Sign in">
          <div className="app-login-panel-top">
            <strong>Sign in</strong>
            <p>Continue with X to open your Linkr wallet dashboard.</p>
          </div>

          <Button onClick={signInWithX} disabled={busy} size="lg" className="app-login-x-button">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <XLogo className="h-5 w-5" />}
            {finalizing ? "Signing you in..." : busy ? "Waiting for X..." : "Continue with X"}
          </Button>

          {errorMessage ? (
            <p className="app-login-status" data-state="error" role="alert">
              {errorMessage}
            </p>
          ) : statusMessage ? (
            <p className="app-login-status" data-state="waiting" role="status">
              {statusMessage}
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}

async function installAuthSession(
  handoffCode: string,
  redirectTo: string,
  expectedUserId: string | null,
): Promise<void> {
  const supabaseUrl =
    import.meta.env.VITE_SUPABASE_URL ||
    (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined);
  if (!supabaseUrl) throw new Error("Supabase URL is not configured.");

  const redirectUrl = new URL(redirectTo);
  if (
    redirectUrl.origin !== window.location.origin ||
    redirectUrl.pathname !== "/auth/callback" ||
    redirectUrl.searchParams.get("auth_popup") !== "1"
  ) {
    throw new Error("X login returned an invalid session handoff.");
  }

  const controller = new AbortController();
  const abortTimer = window.setTimeout(() => controller.abort(), AUTH_HANDOFF_TIMEOUT_MS);
  let ok: boolean;
  let payload: { access_token?: string; refresh_token?: string };
  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/x-oauth/handoff`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handoff_code: handoffCode,
          redirect_to: redirectUrl.toString(),
        }),
        signal: controller.signal,
      },
    );
    ok = response.ok;
    payload = await response.json().catch(() => ({}));
  } catch {
    throw new Error("X login finished, but Linkr could not reach the sign-in service. Try again.");
  } finally {
    window.clearTimeout(abortTimer);
  }
  if (!ok || !payload.access_token || !payload.refresh_token) {
    throw new Error(SESSION_INSTALL_FAILED);
  }

  const { data, error } = await withTimeout(
    supabase.auth.setSession({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
    }),
    AUTH_HANDOFF_TIMEOUT_MS,
    SESSION_INSTALL_FAILED,
  );
  const session = data.session;
  if (error || !session) throw new Error(SESSION_INSTALL_FAILED);
  if (expectedUserId && session.user.id !== expectedUserId) {
    throw new Error("X login finished, but the browser session belongs to another account.");
  }
}

async function waitForInstalledSession(expectedUserId: string | null): Promise<void> {
  for (let attempt = 0; attempt < SESSION_INSTALL_RETRIES; attempt += 1) {
    const { data } = await withTimeout(
      supabase.auth.getSession(),
      AUTH_HANDOFF_TIMEOUT_MS,
      SESSION_INSTALL_FAILED,
    );
    const session = data.session;
    if (session?.access_token && (!expectedUserId || session.user.id === expectedUserId)) return;
    await delay(SESSION_INSTALL_RETRY_MS);
  }
  throw new Error(SESSION_INSTALL_FAILED);
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function readableAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/access_denied/i.test(message)) return "X login cancelled. You can try again anytime.";
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
