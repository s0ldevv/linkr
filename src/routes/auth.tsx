import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { XLogo } from "@/components/linkr/XLogo";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sanitizeAuthReturnTo } from "@/lib/linkr/auth-return";
import {
  beginAuthPopupFlow,
  clearAuthPopupFlow,
  createAuthFlowId,
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

function AuthPage() {
  const navigate = useNavigate();
  const { returnTo } = Route.useSearch();
  const authDestination = sanitizeAuthReturnTo(returnTo);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  const isAuthIndex = normalizedPathname === "/auth";
  const { user, loading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const popupCheckRef = useRef<number | undefined>(undefined);
  const activeFlowRef = useRef<string | null>(null);

  useEffect(() => {
    if (isAuthIndex && !loading && user && !signingIn) {
      navigate({ to: authDestination as never, replace: true });
    }
  }, [authDestination, isAuthIndex, user, loading, navigate, signingIn]);

  useEffect(() => {
    let handledFlowId: string | null = null;
    const onResult = (data: AuthPopupResult) => {
      const activeFlowId = activeFlowRef.current;
      if (data.flowId && activeFlowId && data.flowId !== activeFlowId) return;
      if (handledFlowId && handledFlowId === (data.flowId ?? activeFlowId)) return;
      handledFlowId = data.flowId ?? activeFlowId;

      window.clearInterval(popupCheckRef.current);
      popupCheckRef.current = undefined;
      popupRef.current?.close();
      popupRef.current = null;
      activeFlowRef.current = null;
      clearAuthPopupFlow(data.flowId ?? activeFlowId);
      setSigningIn(false);

      if (data.status === "ok") {
        setErrorMessage(null);
        navigate({ to: authDestination as never, replace: true });
        return;
      }
      if (data.status === "banned") {
        setErrorMessage(null);
        navigate({ to: "/auth/banned" });
        return;
      }
      const message = readableAuthError(data.message);
      setErrorMessage(message);
      toast.error(message);
    };

    const unsubscribe = subscribeToAuthPopupResults(onResult);
    return () => {
      unsubscribe();
      window.clearInterval(popupCheckRef.current);
    };
  }, [authDestination, navigate]);

  if (!isAuthIndex) return <Outlet />;

  async function signInWithX() {
    try {
      setSigningIn(true);
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

      setErrorMessage(null);
      window.clearInterval(popupCheckRef.current);
      popupCheckRef.current = window.setInterval(() => {
        if (!popup.closed) return;
        window.clearInterval(popupCheckRef.current);
        popupCheckRef.current = undefined;
        popupRef.current = null;
        clearAuthPopupFlow(activeFlowRef.current);
        activeFlowRef.current = null;
        setSigningIn(false);
      }, 700);
    } catch (error) {
      setSigningIn(false);
      const message = readableAuthError(error);
      setErrorMessage(message);
      toast.error(message);
    }
  }

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

          <Button
            onClick={signInWithX}
            disabled={signingIn}
            size="lg"
            className="app-login-x-button"
          >
            {signingIn ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <XLogo className="h-5 w-5" />
            )}
            {signingIn ? "Opening X..." : "Continue with X"}
          </Button>

          {errorMessage ? (
            <p className="app-login-status" data-state="error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
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
