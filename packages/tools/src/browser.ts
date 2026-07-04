import { ToolHandler } from './tool-handler.js';

let playwright: typeof import('playwright') | null = null;

async function getPlaywright() {
  if (!playwright) {
    try {
      playwright = await import('playwright');
    } catch {
      return null;
    }
  }
  return playwright;
}

async function ensureChromium() {
  const pw = await getPlaywright();
  if (!pw) return false;

  try {
    await pw.chromium.launch({ headless: true });
    return true;
  } catch {
    try {
      const { execSync } = await import('node:child_process');
      execSync('npx playwright install chromium', { stdio: 'inherit', env: { ...process.env, CI: '1' } });
      return true;
    } catch {
      return false;
    }
  }
}

export const browserTool: ToolHandler = {
  name: 'browser',
  description: 'Navigate to a URL, take a screenshot, or evaluate JavaScript (requires Playwright)',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['navigate', 'screenshot', 'evaluate'], description: 'Browser action' },
      url: { type: 'string', description: 'URL to navigate to' },
      js: { type: 'string', description: 'JavaScript to evaluate (for evaluate action)' },
    },
    required: ['action'],
  },

  async execute(args, _context) {
    const action = args.action as string;
    const pw = await getPlaywright();
    if (!pw) {
      return JSON.stringify({ error: 'Playwright is not installed. Run: npm install playwright && npx playwright install chromium' });
    }

    const ready = await ensureChromium();
    if (!ready) {
      return JSON.stringify({ error: 'Playwright is installed but Chromium could not be launched. Run: npx playwright install chromium' });
    }

    try {
      const browser = await pw.chromium.launch({ headless: true });
      const page = await browser.newPage();

      switch (action) {
        case 'navigate': {
          const url = args.url as string;
          if (!url) return JSON.stringify({ error: 'url is required for navigate action' });
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          const title = await page.title();
          await browser.close();
          return JSON.stringify({ success: true, url, title });
        }

        case 'screenshot': {
          const url = args.url as string;
          if (url) await page.goto(url, { waitUntil: 'domcontentloaded' });
          const buffer = await page.screenshot({ type: 'png', fullPage: true });
          const base64 = Buffer.from(buffer).toString('base64');
          await browser.close();
          return JSON.stringify({ success: true, format: 'png', data: `data:image/png;base64,${base64}`, size: buffer.length });
        }

        case 'evaluate': {
          const js = args.js as string;
          if (!js) return JSON.stringify({ error: 'js is required for evaluate action' });
          const result = await page.evaluate(js);
          await browser.close();
          return JSON.stringify({ success: true, result });
        }

        default:
          await browser.close();
          return JSON.stringify({ error: `Unknown browser action: ${action}` });
      }
    } catch (error) {
      return JSON.stringify({ error: `Browser error: ${error instanceof Error ? error.message : String(error)}` });
    }
  },
};
