// Render an SVG file to a transparent PNG with Playwright/Chromium.
// Usage: node render.js input.svg output.png WIDTH HEIGHT
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const [, , svgPath, outPath, wArg, hArg] = process.argv;
  const W = parseInt(wArg, 10);
  const H = parseInt(hArg, 10);
  const svg = fs.readFileSync(svgPath, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
  });
  const html = `<!doctype html><html><head><style>
    *{margin:0;padding:0}
    html,body{background:transparent}
    #stage{width:${W}px;height:${H}px}
    svg{display:block}
  </style></head><body><div id="stage">${svg}</div></body></html>`;
  await page.setContent(html, { waitUntil: 'networkidle' });
  // small settle for filters
  await page.waitForTimeout(150);
  const el = await page.$('#stage');
  await el.screenshot({ path: outPath, omitBackground: true });
  await browser.close();
  console.log('rendered', outPath, W + 'x' + H);
})();
