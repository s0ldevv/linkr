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

const APP_TITLE = "Linkr - Your Robinhood Chain wallet bot on X";
const APP_DESCRIPTION =
  "A Robinhood Chain wallet bot for X. Reply with @linkrbot to trade, send, launch, or read a thread.";
const OG_DESCRIPTION =
  "Reply on X. Linkr reads the thread, checks your rules, and handles the wallet action.";
const OG_IMAGE_URL =
  "https://raw.githubusercontent.com/s0ldevv/linkr/main/public/linkr/linkr-og-c9ef0be9d1b6.png";
const OG_IMAGE_ALT = "Linkr app preview";
// Without a crossorigin setting the browser fetches the manifest with no
// credentials, so the edge in front of the app sees a cookie-less request and
// answers the bot challenge with 403. "use-credentials" sends the same-origin
// cookies the document already holds. Same-origin CORS-mode fetches are not
// subject to an Access-Control-Allow-Origin check, so nothing else changes.
const MANIFEST_LINK = {
  rel: "manifest",
  href: "/manifest.webmanifest",
  crossOrigin: "use-credentials",
} as const;

function isAuthenticatedAppRoute(matches: Array<{ pathname: string; routeId: string }>): boolean {
  return matches.some(
    (match) => match.pathname.startsWith("/app") || match.routeId.includes("_authenticated"),
  );
}

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
  head: ({ matches }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_TITLE },
      {
        name: "description",
        content: APP_DESCRIPTION,
      },
      {
        name: "robots",
        content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
      },
      {
        name: "googlebot",
        content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
      },
      {
        name: "bingbot",
        content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
      },
      { name: "twitterbot", content: "index, follow" },
      { name: "author", content: "Linkr" },
      { name: "theme-color", content: "#ccff00" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Linkr" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { property: "og:site_name", content: "Linkr" },
      { property: "og:title", content: APP_TITLE },
      { property: "og:description", content: OG_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:image", content: OG_IMAGE_URL },
      { property: "og:image:secure_url", content: OG_IMAGE_URL },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: OG_IMAGE_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@linkrbot" },
      { name: "twitter:title", content: APP_TITLE },
      { name: "twitter:description", content: OG_DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE_URL },
      { name: "twitter:image:alt", content: OG_IMAGE_ALT },
    ],
    links: [
      { rel: "icon", href: "/linkr-favi.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/linkr-favi.png" },
      { rel: "image_src", href: OG_IMAGE_URL },
      ...(isAuthenticatedAppRoute(matches) ? [] : [MANIFEST_LINK]),
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
