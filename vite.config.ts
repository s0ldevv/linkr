// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const FRESH_BOOTSTRAP_HEADERS = {
  "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
  "cdn-cache-control": "no-store",
  "vercel-cdn-cache-control": "no-store",
  pragma: "no-cache",
  expires: "0",
};

const nitroConfig = {
  preset: "vercel",
  vercel: {
    skewProtection: true,
  },
  routeRules: {
    "/asset-recovery.js": {
      headers: FRESH_BOOTSTRAP_HEADERS,
    },
    "/sw.js": {
      headers: {
        ...FRESH_BOOTSTRAP_HEADERS,
        "service-worker-allowed": "/",
      },
    },
    "/manifest.webmanifest": {
      headers: {
        "cache-control": "no-cache, max-age=0, must-revalidate",
        "cdn-cache-control": "no-cache",
        "vercel-cdn-cache-control": "no-cache",
      },
    },
  },
};

export default defineConfig({
  // Vercel needs TanStack Start's Nitro server build. Without this, a normal
  // Vite build only emits JS assets under dist/client and no index route, so
  // Vercel's static hosting returns 404 for the homepage.
  // @lovable.dev/vite-tanstack-config exposes a narrow Nitro type, but passes
  // through Nitro's Vercel config and routeRules at runtime.
  nitro: nitroConfig as { preset: string },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
