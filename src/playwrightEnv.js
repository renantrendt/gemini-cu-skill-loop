// Playwright-backed browser environment for Gemini Computer Use.
//
// Implements the env interface expected by GeminiComputerUse.runTask:
//   screenshot() -> base64 PNG string (no data: prefix)
//   execute(action) -> Playwright commands for the documented action vocab
//   size() -> { width, height }
//   reset() -> navigate back to the start URL
//   currentUrl() -> current page URL (sync; cached after each action)

import { chromium } from 'playwright';

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

export async function createBrowserEnv({
  headless = false,
  startUrl = 'about:blank',
  viewport = DEFAULT_VIEWPORT,
  slowMo = 0,
} = {}) {
  const browser = await chromium.launch({ headless, slowMo });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  // Heavy sites (Apple, Booking) routinely exceed the 30s default; 60s
  // is the safe upper bound that still fails fast on dead URLs.
  page.setDefaultNavigationTimeout(60_000);
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  let _url = page.url();
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) _url = page.url();
  });

  // After every action, give the page a moment to settle. Computer Use
  // is screenshot-driven; pausing past the first paint avoids racing.
  const settle = async () => {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 2000 });
    } catch {}
    await page.waitForTimeout(250);
    _url = page.url();
  };

  async function execute(action) {
    switch (action.type) {
      case 'click':
        await page.mouse.click(action.x, action.y);
        break;
      case 'double_click':
        await page.mouse.dblclick(action.x, action.y);
        break;
      case 'triple_click':
        await page.mouse.click(action.x, action.y, { clickCount: 3 });
        break;
      case 'type':
        await page.keyboard.type(action.text ?? '');
        break;
      case 'press_key':
      case 'key_press':
        await page.keyboard.press(action.key ?? action.text ?? '');
        break;
      case 'hotkey': {
        const keys = Array.isArray(action.keys)
          ? action.keys
          : String(action.keys ?? action.text ?? '').split('+');
        await page.keyboard.press(keys.join('+'));
        break;
      }
      case 'scroll': {
        const dy =
          action.dy != null
            ? action.dy
            : action.direction === 'down'
            ? 400
            : action.direction === 'up'
            ? -400
            : 0;
        const dx = action.dx ?? 0;
        await page.mouse.wheel(dx, dy);
        break;
      }
      case 'navigate':
      case 'goto':
        await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        break;
      case 'go_back':
        await page.goBack({ waitUntil: 'domcontentloaded' });
        break;
      case 'go_forward':
        await page.goForward({ waitUntil: 'domcontentloaded' });
        break;
      case 'drag_and_drop':
        await page.mouse.move(action.x, action.y);
        await page.mouse.down();
        await page.mouse.move(action.x2 ?? action.toX, action.y2 ?? action.toY);
        await page.mouse.up();
        break;
      case 'wait':
        await page.waitForTimeout(action.ms ?? 1000);
        break;
      case 'take_screenshot':
        // no-op: the next screenshot() call already captures fresh state
        break;
      case 'done':
        break;
      default:
        throw new Error(`Unsupported action type: ${action.type}`);
    }
    await settle();
  }

  return {
    page,
    browser,
    context,
    size: () => ({ ...viewport }),
    currentUrl: () => _url,
    screenshot: async () => {
      const buf = await page.screenshot({ type: 'png' });
      return buf.toString('base64');
    },
    execute,
    reset: async () => {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
      _url = page.url();
    },
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}
