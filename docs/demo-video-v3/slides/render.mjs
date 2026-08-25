#!/usr/bin/env node
/**
 * slides.html → png/*.png at 3840×2160.
 *
 * Designed at 1920×1080 and rendered with deviceScaleFactor 2, so the PNGs are
 * true 4K without anyone having to think in 4K coordinates. Every figure is
 * SVG, so the doubling costs nothing in sharpness.
 *
 *   LD_LIBRARY_PATH=$HOME/.local/chromedeps/usr/lib64 node render.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { order: slugs, duplicates } = JSON.parse(fs.readFileSync(path.join(here, 'slides.json'), 'utf8'));
const out = path.join(here, 'png');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox', '--font-render-hinting=none'] });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
});
await page.goto('file://' + path.join(here, 'slides.html'), { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);

for (const slug of slugs) {
  const file = path.join(out, `${slug}.png`);
  if (duplicates[slug]) {
    // Same picture in both decks — copy the rendered original rather than
    // screenshotting the same markup twice (see DUPLICATES in build.py).
    fs.copyFileSync(path.join(out, `${duplicates[slug]}.png`), file);
    console.log(`  ${slug}.png  (copy of ${duplicates[slug]}.png)`);
    continue;
  }
  await page.locator(`#${slug}`).screenshot({ path: file });
  console.log(`  ${slug}.png`);
}
await browser.close();
