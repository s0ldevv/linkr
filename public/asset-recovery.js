// Last-resort recovery from a chunk that will not load.
//
// Vercel Skew Protection is the primary defence: a Vercel-built production
// deployment issues a __vdpl cookie, so a tab open across a deploy keeps being
// served its own chunks. This script only covers the cases that escape it —
// cookies blocked, a tab older than the skew window, or a deployment removed.
//
// Deliberately minimal. SSR documents are served no-store, so exactly ONE reload
// is enough to obtain HTML with current chunk hashes. A chunk 404 is always a
// server-side deployment problem, never a browser cache problem, so this does not
// clear caches or unregister service workers — doing so only hides the real cause.
(() => {
  const RELOAD_KEY = "linkr:asset-reload";
  const RELOAD_WINDOW_MS = 30_000;
  const REPORT_PATH = "/api/asset-failure";
  const LEGACY_PARAMS = ["_asset_retry", "_asset_recovery_ts"];

  let handled = false;

  const readMark = () => {
    try {
      return Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
    } catch (_) {
      return 0;
    }
  };

  const writeMark = (value) => {
    try {
      sessionStorage.setItem(RELOAD_KEY, String(value));
    } catch (_) {}
  };

  const clearMark = () => {
    try {
      sessionStorage.removeItem(RELOAD_KEY);
    } catch (_) {}
  };

  const failedAsset = (event) => {
    const fromPayload = event && event.payload && event.payload.href;
    if (typeof fromPayload === "string") return fromPayload;
    const target = event && event.target;
    const asset = target && (target.src || target.href);
    return typeof asset === "string" ? asset : null;
  };

  const isAppAsset = (asset) => {
    if (!asset) return false;
    try {
      const url = new URL(asset, location.href);
      return url.origin === location.origin && url.pathname.startsWith("/assets/");
    } catch (_) {
      return asset.includes("/assets/");
    }
  };

  const report = (asset, outcome) => {
    try {
      const body = JSON.stringify({
        asset,
        outcome,
        document: location.pathname,
        at: new Date().toISOString(),
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(REPORT_PATH, new Blob([body], { type: "application/json" }));
        return;
      }
      fetch(REPORT_PATH, {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    } catch (_) {}
  };

  const showFallback = (asset) => {
    const render = () => {
      const main = document.createElement("main");
      main.style.cssText =
        "min-height:100vh;display:grid;place-items:center;padding:24px;background:#09090b;color:#fafafa;font:16px system-ui,sans-serif;text-align:center";

      const panel = document.createElement("div");
      panel.style.cssText = "max-width:460px";

      const title = document.createElement("h1");
      title.textContent = "Linkr just updated";
      title.style.cssText = "font-size:24px;margin:0 0 12px";

      const message = document.createElement("p");
      message.textContent =
        "A part of the app could not be loaded. Reloading should pick up the new version.";
      message.style.cssText = "margin:0 0 20px;color:#a1a1aa;line-height:1.45";

      const button = document.createElement("button");
      button.textContent = "Reload Linkr";
      button.style.cssText =
        "border:0;border-radius:8px;padding:12px 18px;background:#fafafa;color:#09090b;font-weight:600;cursor:pointer";
      button.addEventListener("click", () => {
        clearMark();
        location.reload();
      });

      panel.append(title, message, button);
      main.append(panel);
      document.body.replaceChildren(main);
    };

    if (document.body) render();
    else addEventListener("DOMContentLoaded", render, { once: true });
  };

  const recover = (event) => {
    if (handled) return;

    const asset = failedAsset(event);
    if (!isAppAsset(asset)) return;

    handled = true;
    if (event && typeof event.preventDefault === "function") event.preventDefault();

    // A mark inside the window means the reload already happened and did not help.
    // Reloading again would loop, so stop and say so honestly.
    const mark = readMark();
    if (mark && Date.now() - mark < RELOAD_WINDOW_MS) {
      clearMark();
      report(asset, "reload-did-not-help");
      showFallback(asset);
      return;
    }

    writeMark(Date.now());
    report(asset, "reloading");
    console.warn("[Linkr] A build asset failed to load; reloading once for fresh HTML.", asset);
    location.reload();
  };

  addEventListener("vite:preloadError", recover);
  addEventListener("error", (event) => failedAsset(event) && recover(event), true);

  // The app booted, so any earlier failure is resolved. Clear the mark and strip
  // the query params the previous multi-attempt recovery script used to append.
  addEventListener("load", () => {
    if (handled) return;
    clearMark();

    const url = new URL(location.href);
    if (!LEGACY_PARAMS.some((param) => url.searchParams.has(param))) return;
    LEGACY_PARAMS.forEach((param) => url.searchParams.delete(param));
    history.replaceState(history.state, "", url.toString());
  });
})();
