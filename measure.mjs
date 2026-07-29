import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
const KEY = "linkr-entry-gate-accepted-2026-07-12";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });

async function measure(path, selectors) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((k) => window.localStorage.setItem(k, "true"), KEY);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
  await page.waitForSelector(".sm-public-section-head", { timeout: 25000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  const out = await page.evaluate((sels) => {
    const res = {};
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) { res[sel] = "MISSING"; continue; }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      res[sel] = {
        top: Math.round(r.top), height: Math.round(r.height),
        padT: cs.paddingTop, padB: cs.paddingBottom,
        marT: cs.marginTop, marB: cs.marginBottom,
        minH: cs.minHeight, display: cs.display,
        alignContent: cs.alignContent, justifyContent: cs.justifyContent,
        gridTemplateRows: cs.gridTemplateRows,
      };
    }
    return res;
  }, selectors);
  console.log(`\n===== ${path} =====`);
  for (const [k, v] of Object.entries(out)) console.log(k, JSON.stringify(v));
}

await measure("/explore", [
  "main.sm-public-launches-main",
  ".sm-public-launches-summary",
  ".sm-public-section-head",
  ".sm-public-section-head h2",
  ".sm-public-filter-toolbar",
  ".sm-public-launch-card-section",
]);

await measure("/activity", [
  "main.sm-public-board-shell",
  ".sm-public-activity-panel",
  ".sm-public-section-head",
  ".sm-public-section-head h2",
]);

await browser.close();
