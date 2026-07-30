import puppeteer from "puppeteer-core";

const SP = "C:/Users/housa/AppData/Local/Temp/claude/C--WINDOWS-System32/677571a9-37e5-4884-be0a-8e63f8a2ab7e/scratchpad";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://localhost:5300/harness.html";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
});

for (const vp of [
  { name: "mobile", width: 390, height: 844 },
  { name: "small", width: 360, height: 780 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 500));

  const info = await page.evaluate(() => {
    const dump = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        overflow: cs.overflow,
        bg: cs.backgroundColor,
        clipPath: cs.clipPath,
        padding: cs.padding,
        objectFit: cs.objectFit,
        maxWidth: cs.maxWidth,
        minWidth: cs.minWidth,
        flex: cs.flex,
        transform: cs.transform,
      };
    };
    const header = document.querySelector(".sm-marketing-header");
    const inner = header.querySelector(".sm-marketing-header-inner");
    const logo = inner.querySelector(".sm-logo");
    const mark = logo.querySelector(".sm-logo-mark");
    const img = mark.querySelector("img");
    return {
      innerCols: getComputedStyle(inner).gridTemplateColumns,
      innerDisplay: getComputedStyle(inner).display,
      innerOverflow: getComputedStyle(inner).overflow,
      innerRect: dump(inner).rect,
      logo: dump(logo),
      mark: dump(mark),
      img: { ...dump(img), nw: img.naturalWidth, nh: img.naturalHeight, complete: img.complete, src: img.currentSrc },
      // what is painted at the logo's center point?
      hitAtLogoCenter: (() => {
        const r = mark.getBoundingClientRect();
        const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return el ? `${el.tagName}.${el.className?.toString?.().slice(0, 60)}` : null;
      })(),
    };
  });

  console.log(`\n===== ${vp.name} (${vp.width}) =====`);
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: `${SP}/harness-${vp.name}.png`, clip: { x: 0, y: 0, width: vp.width, height: 220 } });
  await page.close();
}

await browser.close();
