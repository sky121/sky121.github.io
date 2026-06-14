const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const name = process.argv[2];
  const svgPath = `/tmp/dragoose-dragons/${name}.svg`;
  const outPath = process.argv[3] || `/tmp/dragoose-dragons/${name}.png`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 680, height: 680 }, deviceScaleFactor: 1 });
  const fs = require('fs');
  const svg = fs.readFileSync(svgPath, 'utf8');
  const html = `<!doctype html><html><head><style>*{margin:0;padding:0}html,body{background:transparent}</style></head><body>${svg}</body></html>`;
  await page.setContent(html, { waitUntil: 'networkidle' });
  const el = await page.$('svg');
  await el.screenshot({ path: outPath, omitBackground: true });
  await browser.close();
  console.log('rendered', outPath);
})();
