import puppeteer from "puppeteer-core";

const SP = "C:/Users/housa/AppData/Local/Temp/claude/C--WINDOWS-System32/677571a9-37e5-4884-be0a-8e63f8a2ab7e/scratchpad";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://localhost:5300/harness.html";
const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
});

const widths = [320, 360, 375, 390, 414, 430, 480, 560, 639, 640, 641, 768, 900, 1024, 1280, 1440];

const page = await browser.newPage();
await page.setUserAgent(IOS_UA);
await page.setViewport({ width: 390, height: 800, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await page.goto(URL, { waitUntil: "load", timeout: 60000 });

for (const w of widths) {
  await page.setViewport({ width: w, height: 800, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await new Promise((r) => setTimeout(r, 250));

  const r = await page.evaluate(() => {
    const logo = document.querySelector(".sm-marketing-header .sm-logo");
    const mark = logo?.querySelector(".sm-logo-mark");
    const img = mark?.querySelector("img");
    const box = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return `${b.width.toFixed(0)}x${b.height.toFixed(0)}@${b.x.toFixed(0)},${b.y.toFixed(0)}`;
    };
    const vis = (el) => {
      const cs = getComputedStyle(el);
      return `${cs.display}/${cs.visibility}/${cs.opacity}`;
    };
    return {
      logo: box(logo),
      mark: box(mark),
      img: box(img),
      imgVis: img ? vis(img) : null,
      markVis: mark ? vis(mark) : null,
      hit: (() => {
        const b = mark.getBoundingClientRect();
        const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return el ? el.tagName + "." + (el.className?.toString?.().slice(0, 30) ?? "") : "none";
      })(),
    };
  });

  console.log(
    `${String(w).padStart(4)} | logo ${String(r.logo).padEnd(16)} | mark ${String(r.mark).padEnd(16)} | img ${String(r.img).padEnd(16)} | img ${r.imgVis} | hit ${r.hit}`,
  );
}

await page.close();
await browser.close();
