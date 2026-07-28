(() => {
  const key = "linkr:asset-recovery:" + location.pathname;
  let scheduled = false;
  const showFallback = () => {
    const render = () => {
      const main = document.createElement("main");
      main.style.cssText =
        "min-height:100vh;display:grid;place-items:center;padding:24px;background:#09090b;color:#fafafa;font:16px system-ui,sans-serif;text-align:center";
      const panel = document.createElement("div");
      const title = document.createElement("h1");
      title.textContent = "Linkr is updating";
      title.style.cssText = "font-size:24px;margin:0 0 12px";
      const message = document.createElement("p");
      message.textContent = "Telegram received an incomplete page update. Try loading it again.";
      message.style.cssText = "max-width:420px;margin:0 0 20px;color:#a1a1aa";
      const button = document.createElement("button");
      button.textContent = "Try again";
      button.style.cssText =
        "border:0;border-radius:8px;padding:12px 18px;background:#fafafa;color:#09090b;font-weight:600";
      button.addEventListener("click", () => {
        try {
          sessionStorage.removeItem(key);
        } catch (_) {}
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
    if (scheduled) return;
    scheduled = true;
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    let attempts = 0;
    try {
      attempts = Number(sessionStorage.getItem(key) || "0");
    } catch (_) {}
    if (attempts >= 4) return showFallback();
    try {
      sessionStorage.setItem(key, String(attempts + 1));
    } catch (_) {}
    setTimeout(
      () => {
        const url = new URL(location.href);
        url.searchParams.set("_asset_retry", String(Date.now()));
        location.replace(url.toString());
      },
      Math.min(4000, 500 * Math.pow(2, attempts)),
    );
  };
  addEventListener("vite:preloadError", recover);
  addEventListener(
    "error",
    (event) => {
      const target = event.target;
      const asset = target && (target.src || target.href);
      if (typeof asset === "string" && asset.includes("/assets/")) recover(event);
    },
    true,
  );
  setTimeout(() => {
    if (scheduled) return;
    try {
      sessionStorage.removeItem(key);
    } catch (_) {}
    const url = new URL(location.href);
    if (url.searchParams.has("_asset_retry")) {
      url.searchParams.delete("_asset_retry");
      history.replaceState(history.state, "", url.toString());
    }
  }, 10000);
})();
