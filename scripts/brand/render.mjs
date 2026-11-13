// Renders the wemock icons from the SVGs in .github/brand/ (A44).
// Run after `npm ci`: node scripts/brand/render.mjs
//
// Writes:
//   public/icon/16.png, 32.png        from icon-small.svg (the full bird blurs at that size)
//   public/icon/48.png, 128.png       from icon.svg
//   docs/store/images/store-icon-128.png   the Store icon: 96 px artwork, 16 px transparent
//                                          padding, a soft shadow so it reads on light and dark
//                                          (docs/ is gitignored; skipped when the folder is absent)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const svg = (name) => fs.readFileSync(path.join(root, '.github/brand', name), 'utf8');

const jobs = [
  { out: 'public/icon/16.png', src: 'icon-small.svg', size: 16 },
  { out: 'public/icon/32.png', src: 'icon-small.svg', size: 32 },
  { out: 'public/icon/48.png', src: 'icon.svg', size: 48 },
  { out: 'public/icon/128.png', src: 'icon.svg', size: 128 },
  { out: 'docs/store/images/store-icon-128.png', src: 'icon.svg', size: 128, art: 96, shadow: true },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const job of jobs) {
    const dir = path.join(root, path.dirname(job.out));
    if (!fs.existsSync(dir)) {
      console.log(`skip ${job.out} (no ${path.dirname(job.out)}/)`);
      continue;
    }
    const art = job.art ?? job.size;
    const shadow = job.shadow ? 'filter: drop-shadow(0 2px 3px rgba(0,0,0,.35));' : '';
    await page.setViewportSize({ width: job.size, height: job.size });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
      <div style="width:${job.size}px;height:${job.size}px;display:grid;place-items:center">
        <div style="width:${art}px;height:${art}px;${shadow}">${svg(job.src).replace('<svg ', `<svg style="width:${art}px;height:${art}px;display:block" `)}</div>
      </div></body></html>`);
    await page.screenshot({ path: path.join(root, job.out), omitBackground: true, clip: { x: 0, y: 0, width: job.size, height: job.size } });
    console.log(`wrote ${job.out}`);
  }
} finally {
  await browser.close();
}
