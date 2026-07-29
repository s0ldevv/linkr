(() => {
  const MAX_ATTEMPTS = 4;
  const RETRY_BASE_DELAY_MS = 350;
  const RETRY_MAX_DELAY_MS = 3000;
  const RECOVERY_KEY = "linkr:asset-recovery:" + location.pathname;
  const RECOVERY_PARAMS = ["_asset_retry", "_asset_recovery_ts"];

  let scheduled = false;

  const safeSessionGet = (key) => {
    try {
      return sessionStorage.getItem(key);
    } catch (_) {
      return null;
    }
  };

  const safeSessionSet = (key, value) => {
    try {
      sessionStorage.setItem(key, value);
    } catch (_) {}
  };

  const safeSessionRemove = (key) => {
    try {
      sessionStorage.removeItem(key);
    } catch (_) {}
  };

  const failedAssetFromEvent = (event) => {
    const payload = event && event.payload;
    if (payload && typeof payload.href === "string") return payload.href;

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

  const markAttempt = () => {
    const attempts = Number(safeSessionGet(RECOVERY_KEY) || "0");
    safeSessionSet(RECOVERY_KEY, String(attempts + 1));
    return attempts;
  };

  const cleanupBrowserCaches = async () => {
    await Promise.allSettled([
      (async () => {
        if (!("serviceWorker" in navigator)) return;
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.allSettled(registrations.map((registration) => registration.unregister()));
      })(),
      (async () => {
        if (!("caches" in window)) return;
        const keys = await caches.keys();
        await Promise.allSettled(keys.map((key) => caches.delete(key)));
      })(),
    ]);
  };

  const reloadWithFreshDocument = async (attempts, reason) => {
    await cleanupBrowserCaches();

    const url = new URL(location.href);
    RECOVERY_PARAMS.forEach((param) => url.searchParams.delete(param));
    url.searchParams.set("_asset_retry", String(attempts + 1));
    url.searchParams.set("_asset_recovery_ts", String(Date.now()));

    console.warn("[Linkr] Recovering from stale or blocked build asset.", {
      attempt: attempts + 1,
      reason,
      nextUrl: url.pathname + url.search,
    });

    location.replace(url.toString());
  };

  const showFallback = (reason) => {
    const retry = async () => {
      safeSessionRemove(RECOVERY_KEY);
      await reloadWithFreshDocument(0, reason || "manual-retry");
    };

    const render = () => {
      const main = document.createElement("main");
      main.style.cssText =
        "min-height:100vh;display:grid;place-items:center;padding:24px;background:#09090b;color:#fafafa;font:16px system-ui,sans-serif;text-align:center";

      const panel = document.createElement("div");
      panel.style.cssText = "max-width:460px";

      const title = document.createElement("h1");
      title.textContent = "Linkr could not load the latest app";
      title.style.cssText = "font-size:24px;margin:0 0 12px";

      const message = document.createElement("p");
      message.textContent =
        "The browser is still receiving an old or blocked app file. Try once more to clear cached app state and load a fresh copy.";
      message.style.cssText = "margin:0 0 20px;color:#a1a1aa;line-height:1.45";

      const button = document.createElement("button");
      button.textContent = "Reload Linkr";
      button.style.cssText =
        "border:0;border-radius:8px;padding:12px 18px;background:#fafafa;color:#09090b;font-weight:600;cursor:pointer";
      button.addEventListener("click", retry);

      panel.append(title, message, button);
      main.append(panel);
      document.body.replaceChildren(main);
    };

    if (document.body) render();
    else addEventListener("DOMContentLoaded", render, { once: true });
  };

  const recover = (event, reason) => {
    if (scheduled) return;

    const asset = failedAssetFromEvent(event);
    if (!isAppAsset(asset)) return;

    scheduled = true;
    if (event && typeof event.preventDefault === "function") event.preventDefault();

    const attempts = markAttempt();
    const recoveryReason = reason || asset || "asset-load-failed";

    if (attempts >= MAX_ATTEMPTS) {
      showFallback(recoveryReason);
      return;
    }

    const delay = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * Math.pow(2, attempts));
    setTimeout(() => {
      reloadWithFreshDocument(attempts, recoveryReason).catch(() => {
        location.reload();
      });
    }, delay);
  };

  addEventListener("vite:preloadError", (event) => recover(event, "vite-preload-error"));

  addEventListener(
    "error",
    (event) => {
      const asset = failedAssetFromEvent(event);
      if (asset) recover(event, asset);
    },
    true,
  );

  setTimeout(() => {
    if (scheduled) return;
    safeSessionRemove(RECOVERY_KEY);

    const url = new URL(location.href);
    const hadRecoveryParam = RECOVERY_PARAMS.some((param) => url.searchParams.has(param));
    if (!hadRecoveryParam) return;

    RECOVERY_PARAMS.forEach((param) => url.searchParams.delete(param));
    history.replaceState(history.state, "", url.toString());
  }, 10000);
})();
