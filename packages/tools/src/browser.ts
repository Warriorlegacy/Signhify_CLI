import { ToolHandler } from './tool-handler.js';
import { AbortError } from './errors.js';
import { killProcessTree } from './process-utils.js';

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

async function ensureChromium(signal?: AbortSignal) {
  if (signal?.aborted) throw new AbortError('Browser operation was aborted');

  const pw = await getPlaywright();
  if (!pw) return false;

  let browser: import('playwright').Browser | undefined;
  try {
    if (signal?.aborted) throw new AbortError('Browser operation was aborted');
    browser = await pw.chromium.launch({ headless: true });
    if (signal?.aborted) throw new AbortError('Browser operation was aborted');
    return true;
  } catch (launchError) {
    if (signal?.aborted || (launchError instanceof Error && launchError.name === 'AbortError')) {
      throw (launchError instanceof AbortError ? launchError : new AbortError('Browser operation was aborted'));
    }
    try {
      const { spawn } = await import('node:child_process');
      await new Promise<void>((resolve, reject) => {
        let child: import('node:child_process').ChildProcess;
        try {
          child = spawn('npx', ['playwright', 'install', 'chromium'], {
            stdio: 'inherit',
            env: { ...process.env, CI: '1' },
            shell: true,
            detached: process.platform !== 'win32',
          });
        } catch (err) {
          if (signal?.aborted) {
            reject(new AbortError('Browser installation was aborted'));
          } else {
            reject(err);
          }
          return;
        }

        const terminate = () => {
          killProcessTree(child);
        };

        const onAbort = () => {
          terminate();
          cleanup();
          reject(new AbortError('Browser installation was aborted'));
        };

        const cleanup = () => {
          signal?.removeEventListener('abort', onAbort);
        };

        if (signal) {
          if (signal.aborted) {
            terminate();
            reject(new AbortError('Browser installation was aborted'));
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }

        child.on('error', (err: Error) => {
          cleanup();
          if (signal?.aborted) {
            reject(new AbortError('Browser installation was aborted'));
          } else {
            reject(err);
          }
        });

        child.on('close', (code: number | null) => {
          cleanup();
          if (signal?.aborted) {
            reject(new AbortError('Browser installation was aborted'));
          } else if (code === 0) {
            resolve();
          } else {
            reject(new Error(`playwright install failed with code ${code}`));
          }
        });
      });
      return true;
    } catch (installError) {
      if (signal?.aborted || (installError instanceof Error && installError.name === 'AbortError')) {
        throw (installError instanceof AbortError ? installError : new AbortError('Browser operation was aborted'));
      }
      return false;
    }
  } finally {
    await browser?.close().catch(() => undefined);
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

  async execute(args, context) {
    const action = args.action as string;
    const signal = context.signal;
    if (signal?.aborted) throw new AbortError('Browser operation was aborted');
    const pw = await getPlaywright();
    if (!pw) {
      return JSON.stringify({ error: 'Playwright is not installed. Run: npm install playwright && npx playwright install chromium' });
    }

    const ready = await ensureChromium(signal);
    if (!ready) {
      return JSON.stringify({ error: 'Playwright is installed but Chromium could not be launched. Run: npx playwright install chromium' });
    }

    try {
      if (signal?.aborted) throw new AbortError('Browser operation was aborted');
      const browser = await pw.chromium.launch({ headless: true });
      const closeOnAbort = () => { void browser.close().catch(() => undefined); };
      signal?.addEventListener('abort', closeOnAbort, { once: true });

      try {
        if (signal?.aborted) throw new AbortError('Browser operation was aborted');
        const page = await browser.newPage();

        switch (action) {
          case 'navigate': {
            const url = args.url as string;
            if (!url) return JSON.stringify({ error: 'url is required for navigate action' });
            await page.goto(url, { waitUntil: 'domcontentloaded' });
            const title = await page.title();
            return JSON.stringify({ success: true, url, title });
          }

          case 'screenshot': {
            const url = args.url as string;
            if (url) await page.goto(url, { waitUntil: 'domcontentloaded' });
            const buffer = await page.screenshot({ type: 'png', fullPage: true });
            const base64 = Buffer.from(buffer).toString('base64');
            return JSON.stringify({ success: true, format: 'png', data: `data:image/png;base64,${base64}`, size: buffer.length });
          }

          case 'evaluate': {
            const js = args.js as string;
            if (!js) return JSON.stringify({ error: 'js is required for evaluate action' });
            const result = await page.evaluate(js);
            return JSON.stringify({ success: true, result });
          }

          default:
            return JSON.stringify({ error: `Unknown browser action: ${action}` });
        }
      } finally {
        signal?.removeEventListener('abort', closeOnAbort);
        await browser.close().catch(() => undefined);
      }
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw (error instanceof AbortError ? error : new AbortError('Browser operation was aborted'));
      }
      return JSON.stringify({ error: `Browser error: ${error instanceof Error ? error.message : String(error)}` });
    }
  },
};
