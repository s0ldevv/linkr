import puppeteer from "puppeteer-core";

const SP = "C:/Users/housa/AppData/Local/Temp/claude/C--WINDOWS-System32/677571a9-37e5-4884-be0a-8e63f8a2ab7e/scratchpad";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.BASE ?? "https://linkr.cash";
const KEY = "linkr-entry-gate-accepted-2026-07-12";
const path = process.argv[2] ?? "/";
const NAME = process.argv[3] ?? "mobile";

const isMobile = NAME === "mobile";
const W = isMobile ? 390 : 1440;
const H = isMobile ? 844 : 900;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: `${SP}/chrome-profile`,
  args: [`--window-size=${W},${H + 120}`, "--hide-scrollbars"],
  defaultViewport: null,
});

let page = (await browser.pages())[0] ?? (await browser.newPage());
if (isMobile) {
  await page.setUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  );
}

await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 90000 });

// wait for cloudflare to clear
for (let i = 0; i < 45; i++) {
  try {
    const t = await page.title();
    if (!/just a moment|attention required|^$/i.test(t)) break;
  } catch {
    // frame detaches while the challenge navigates
  }
  await new Promise((r) => setTimeout(r, 2000));
}

async function activePage() {
  const pages = await browser.pages();
  return pages[pages.length - 1];
}

async function tryEval(fn, arg) {
  for (let i = 0; i < 10; i++) {
    try {
      const p = await activePage();
      return await p.evaluate(fn, arg);
    } catch (err) {
      if (!/detached|Execution context|Target closed/i.test(String(err))) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error("page kept detaching");
}

await tryEval((k) => window.localStorage.setItem(k, "true"), KEY);
page = await activePage();
await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: 90000 });
await new Promise((r) => setTimeout(r, 5000));

const info = await tryEval(() => {
  const dump = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      cls: el.className?.toString?.().slice(0, 100),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
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

  const headers = [...document.querySelectorAll("header")].map((h) => dump(h));
  const imgs = [...document.querySelectorAll("header img")].map((img) => ({
    src: img.currentSrc || img.src,
    complete: img.complete,
    nw: img.naturalWidth,
    nh: img.naturalHeight,
    parentCls: img.parentElement?.className?.toString?.().slice(0, 90),
    ...dump(img),
  }));
  const brands = [...document.querySelectorAll(".sm-logo, .sm-logo-mark, .lkt-brand")].map(dump);
  return { title: document.title, w: innerWidth, headers, imgs, brands };
});

console.log(`\n===== ${NAME} ${BASE}${path} viewport=${info.w} =====`);
console.log(JSON.stringify(info, null, 2));

await page.screenshot({ path: `${SP}/live-${NAME}.png`, clip: { x: 0, y: 0, width: Math.min(W, info.w), height: 300 } });
await browser.close();
