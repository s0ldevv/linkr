import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { RayoChrome } from "@/components/linkr/RayoChrome";
import { AppEntryGate } from "@/components/linkr/AppEntryGate";
import { CookiePrivacyNotice } from "@/components/linkr/CookiePrivacyNotice";
import { MobileInstallBanner } from "@/components/linkr/MobileInstallBanner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Button asChild>
            <Link to="/">Go home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Try again
          </Button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Linkr - Your Robinhood Chain wallet bot on X" },
      {
        name: "description",
        content:
          "A Robinhood Chain wallet bot for X. Reply with @linkrcash to trade, send, launch, or read a thread.",
      },
      { name: "author", content: "Linkr" },
      { name: "theme-color", content: "#ccff00" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Linkr" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { property: "og:title", content: "Linkr - Your Robinhood Chain wallet bot on X" },
      {
        property: "og:description",
        content:
          "Reply on X. Linkr reads the thread, checks your rules, and handles the wallet action.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@linkrcash" },
    ],
    links: [
      { rel: "icon", href: "/linkr-favi.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/linkr-favi.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Funnel+Display:wght@300..800&family=Funnel+Sans:ital,wght@0,300..800;1,300..800&family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800;900&family=Inter+Tight:wght@500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script src="/asset-recovery.js" />
        <HeadContent />
      </head>
      <body id="top">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { user, loading: authLoading } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  const isAuthSurface = normalizedPathname.startsWith("/auth");
  const isCliAuthSurface = normalizedPathname === "/cli/auth";
  const isTelegramAuthSurface = normalizedPathname.startsWith("/telegram");
  const isAuthCallbackSurface = normalizedPathname.startsWith("/auth/callback");
  const isLinksSurface = normalizedPathname === "/links";
  const hideEntryGate =
    normalizedPathname === "/terms-of-service" ||
    isLinksSurface ||
    isAuthSurface ||
    isCliAuthSurface ||
    isTelegramAuthSurface ||
    normalizedPathname === "/secretpanel";
  const appContent = (
    <div id="linkr-app-content">
      <Outlet />
      {!isAuthSurface &&
        !isCliAuthSurface &&
        !isTelegramAuthSurface &&
        !isAuthCallbackSurface &&
        !isLinksSurface && <RayoChrome />}
    </div>
  );

  return (
    <QueryClientProvider client={queryClient}>
      {!isTelegramAuthSurface && !isAuthSurface && !isCliAuthSurface && !isLinksSurface && (
        <MobileInstallBanner />
      )}
      {hideEntryGate ? (
        appContent
      ) : (
        <AppEntryGate authLoading={authLoading} user={user}>
          {appContent}
        </AppEntryGate>
      )}
      {!isLinksSurface && !isTelegramAuthSurface && !isCliAuthSurface && <CookiePrivacyNotice />}
      <Toaster theme="light" position="top-right" />
    </QueryClientProvider>
  );
}
