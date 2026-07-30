import puppeteer from "puppeteer-core";

const SP = "C:/Users/housa/AppData/Local/Temp/claude/C--WINDOWS-System32/677571a9-37e5-4884-be0a-8e63f8a2ab7e/scratchpad";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "https://linkr.cash";
const KEY = "linkr-entry-gate-accepted-2026-07-12";
const PATH = process.env.TARGET_PATH ?? "/";
const NAME = process.env.NAME ?? "mobile";

const isMobile = NAME === "mobile";
const W = isMobile ? 390 : 1440;
const H = isMobile ? 844 : 900;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: `${SP}/chrome-profile`,
  args: [`--window-size=${W},${H + 140}`, "--hide-scrollbars"],
  defaultViewport: null,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function activePage() {
  const pages = await browser.pages();
  return pages[pages.length - 1];
}

async function safe(fn) {
  for (let i = 0; i < 15; i++) {
    try {
      return await fn(await activePage());
    } catch (err) {
      if (!/detached|Execution context|Target closed|LifecycleWatcher|Navigating frame/i.test(String(err))) throw err;
      await sleep(1500);
    }
  }
  return null;
}

if (isMobile) {
  await safe((p) =>
    p.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    ),
  );
}

await safe((p) => p.goto(`${BASE}${PATH}`, { waitUntil: "domcontentloaded", timeout: 90000 }));

// Wait for Cloudflare + app render.
let ready = false;
for (let i = 0; i < 60; i++) {
  const state = await safe((p) =>
    p.evaluate(() => ({
      title: document.title,
      hasHeader: Boolean(document.querySelector(".sm-marketing-header")),
      hasGate: Boolean(document.querySelector(".sm-entry-gate")),
    })),
  );
  if (state?.hasHeader) {
    ready = true;
    break;
  }
  if (state?.hasGate) {
    await safe((p) => p.evaluate((k) => window.localStorage.setItem(k, "true"), KEY));
    await safe((p) => p.reload({ waitUntil: "domcontentloaded", timeout: 90000 }));
  }
  await sleep(2000);
}

console.log("ready:", ready);

const info = await safe((p) =>
  p.evaluate(() => {
    const dump = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        cls: el.className?.toString?.().slice(0, 100),
        rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        overflow: cs.overflow,
        bg: cs.backgroundColor,
        clipPath: cs.clipPath,
        padding: cs.padding,
        objectFit: cs.objectFit,
        transform: cs.transform,
      };
    };
    const header = document.querySelector(".sm-marketing-header");
    const inner = header?.querySelector(".sm-marketing-header-inner");
    const logo = inner?.querySelector(".sm-logo");
    const mark = logo?.querySelector(".sm-logo-mark");
    const img = mark?.querySelector("img") ?? logo?.querySelector("img");
    return {
      url: location.href,
      vw: innerWidth,
      pageWrapperCls: document.body.firstElementChild?.className?.toString?.().slice(0, 120),
      hasMarkWrapper: Boolean(mark),
      logoHTML: logo?.outerHTML?.slice(0, 400),
      innerCols: inner ? getComputedStyle(inner).gridTemplateColumns : null,
      logo: dump(logo),
      mark: dump(mark),
      img: img
        ? { ...dump(img), nw: img.naturalWidth, nh: img.naturalHeight, complete: img.complete, src: img.currentSrc || img.src }
        : null,
      cssHrefs: [...document.querySelectorAll("link[rel=stylesheet]")].map((l) => l.href),
    };
  }),
);

console.log(JSON.stringify(info, null, 2));
await safe((p) => p.screenshot({ path: `${SP}/live-${NAME}.png`, clip: { x: 0, y: 0, width: Math.min(W, info?.vw ?? W), height: 260 } }));
await browser.close();
