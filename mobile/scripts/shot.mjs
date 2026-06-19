// Niezależny zrzut ekranu apki web (Playwright headless) — alternatywa dla Browser MCP.
// Użycie: LD_LIBRARY_PATH=/tmp/chromedeps/usr/lib/x86_64-linux-gnu node scripts/shot.mjs [url] [out.png]
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:8082';
const out = process.argv[3] || '/tmp/shot.png';
const width = Number(process.argv[4]) || 390;
const height = Number(process.argv[5]) || 844;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 2,
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500); // czas na bundling Metro + render fontów/svg
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
