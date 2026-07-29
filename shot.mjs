import puppeteer from "puppeteer-core";

const SP = "C:/Users/housa/AppData/Local/Temp/claude/C--WINDOWS-system32/a3923335-73a1-49b9-83a7-5b8d17629a99/scratchpad";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
const KEY = "linkr-entry-gate-accepted-2026-07-12";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1500, deviceScaleFactor: 1 });

for (const p of ["explore", "activity", "nfts"]) {
  await page.goto(`${BASE}/${p}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((k) => window.localStorage.setItem(k, "true"), KEY);
  await page.goto(`${BASE}/${p}`, { waitUntil: "networkidle2" });
  try {
    await page.waitForSelector(".sm-public-section-head", { timeout: 25000 });
  } catch {
    console.log(`${p}: section-head not found`);
  }
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `${SP}/shot-${p}.png` });
  console.log(`${p} done`);
}

await browser.close();
