import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

// Kobo's Cloudflare challenge rejects headless Chromium but lets a headed browser through.
// When no X display exists (CI, WSL without WSLg), start a private Xvfb for this process only.
const CHALLENGE_TITLE = /請稍候|Just a moment|Challenged|Attention Required/i;

export function startVirtualDisplay({ spawnImpl = spawn, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl('Xvfb', ['-displayfd', '1', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'],
        { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      reject(Object.assign(new Error('XVFB_UNAVAILABLE'), { code: 'XVFB_UNAVAILABLE' }));
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(new Error('XVFB_UNAVAILABLE'), { code: 'XVFB_UNAVAILABLE' }));
    }, timeoutMs);
    child.once('error', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('XVFB_UNAVAILABLE'), { code: 'XVFB_UNAVAILABLE' }));
    });
    let out = '';
    child.stdout.on('data', chunk => {
      out += chunk;
      const match = out.match(/^(\d+)\s*$/m);
      if (match) {
        clearTimeout(timer);
        resolve({ display: `:${match[1]}`, stop: () => child.kill() });
      }
    });
  });
}

export async function withHeadedBrowser(fn, { env = process.env } = {}) {
  let xvfb = null;
  let display = env.DISPLAY;
  if (!display) {
    xvfb = await startVirtualDisplay();
    display = xvfb.display;
  }
  const browser = await chromium.launch({ headless: false, env: { ...env, DISPLAY: display } });
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch(() => {});
    xvfb?.stop();
  }
}

// Open one URL politely and wait for a challenge page to clear. Returns status/title/html.
export async function openHeaded(browser, url, { timeoutMs = 60000, challengeWaitMs = 40000 } = {}) {
  const page = await browser.newPage({ locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    let status = response?.status() ?? 0;
    if (CHALLENGE_TITLE.test(await page.title())) {
      try {
        const next = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: challengeWaitMs }).catch(() => null);
        await page.waitForFunction(re => !new RegExp(re, 'i').test(document.title),
          CHALLENGE_TITLE.source, { timeout: challengeWaitMs });
        const nav = await next;
        if (nav) status = nav.status();
        else status = CHALLENGE_TITLE.test(await page.title()) ? status : 200;
      } catch { /* still challenged */ }
    }
    await page.waitForTimeout(2000);
    const title = await page.title();
    return { status: CHALLENGE_TITLE.test(title) ? 403 : status, title, html: await page.content() };
  } finally {
    await page.close().catch(() => {});
  }
}
