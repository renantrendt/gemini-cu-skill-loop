// Throwaway: opens a Playwright Chromium pointed at arxiv.org so the user
// can position the window where they want it. Continuously writes the
// current window position to /tmp/chromium-position.env in shell-source
// format so the agent's run can reuse the same coords. Closes on the
// /tmp/close-positioning signal.
import { chromium } from 'playwright';
import { existsSync, writeFileSync } from 'node:fs';

const CHROMIUM_FULL =
  '/Users/renanserrano/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const browser = await chromium.launch({ headless: false, executablePath: CHROMIUM_FULL });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1280 } });
const page = await ctx.newPage();
await page.goto('https://arxiv.org/', { waitUntil: 'domcontentloaded', timeout: 60_000 });

console.log('chromium open — drag/resize where you want it');
console.log('continuously saving position to /tmp/chromium-position.env');

let lastPos = '';
const positionInterval = setInterval(async () => {
  try {
    const pos = await page.evaluate(() => ({
      x: Math.round(window.screenX),
      y: Math.round(window.screenY),
      outerW: Math.round(window.outerWidth),
      outerH: Math.round(window.outerHeight),
      viewportW: Math.round(window.innerWidth),
      viewportH: Math.round(window.innerHeight),
    }));
    const env = [
      `WINDOW_X=${pos.x}`,
      `WINDOW_Y=${pos.y}`,
      `WINDOW_W=${pos.outerW}`,
      `WINDOW_H=${pos.outerH}`,
      `VIEWPORT_W=${pos.viewportW}`,
      `VIEWPORT_H=${pos.viewportH}`,
    ].join('\n') + '\n';
    if (env !== lastPos) {
      writeFileSync('/tmp/chromium-position.env', env);
      lastPos = env;
    }
  } catch {}
}, 500);

while (!existsSync('/tmp/close-positioning')) {
  await new Promise((r) => setTimeout(r, 300));
}
clearInterval(positionInterval);
await browser.close();
console.log('chromium closed; final position in /tmp/chromium-position.env');
