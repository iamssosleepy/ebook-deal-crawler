import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';

// Kobo's Cloudflare challenge rejects headless Chromium but lets a headed browser through.
// When no X display exists (CI, WSL without WSLg), start a private Xvfb for this process only.
const CHALLENGE_TITLE = /請稍候|Just a moment|Challenged|Attention Required/i;
const X11_SOCKET_DIR = '/tmp/.X11-unix';
const X11_SOCKET_FIX = 'sudo mkdir -p /tmp/.X11-unix && sudo chmod 1777 /tmp/.X11-unix && sudo chown root:root /tmp/.X11-unix';

export function prepareX11SocketDirectory({ fsImpl = fs, log = console.error } = {}) {
  const hint = detail => log(`XVFB_X11_SOCKET_DIR_HINT ${X11_SOCKET_DIR} ${detail}; run: ${X11_SOCKET_FIX}`);
  try {
    let stats;
    try {
      stats = fsImpl.statSync(X11_SOCKET_DIR);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        fsImpl.mkdirSync(X11_SOCKET_DIR, { mode: 0o1777 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      try {
        fsImpl.chmodSync(X11_SOCKET_DIR, 0o1777);
      } catch (error) {
        if (error.code !== 'EPERM') throw error;
        hint('chmod denied (EPERM)');
      }
      stats = fsImpl.statSync(X11_SOCKET_DIR);
    }
    let writable = true;
    try { fsImpl.accessSync(X11_SOCKET_DIR, fs.constants.W_OK); } catch { writable = false; }
    const mode = stats.mode & 0o7777;
    if (!stats.isDirectory() || mode !== 0o1777 || !writable) {
      hint(`mode=${mode.toString(8)} writable=${writable} directory=${stats.isDirectory()}`);
    }
    return writable;
  } catch (error) {
    // Directory repair is best effort; Xvfb stderr still supplies the actual startup failure.
    hint(`could not prepare directory (${error.code || error.name})`);
    return false;
  }
}

export function startVirtualDisplay({ spawnImpl = spawn, timeoutMs = 10000, fsImpl = fs, log = console.error } = {}) {
  // WSLg mounts /tmp/.X11-unix read-only; Xvfb then cannot bind its path socket. Linux X clients
  // also try the abstract socket, so listen only there in that case.
  const socketDirWritable = prepareX11SocketDirectory({ fsImpl, log });
  const args = ['-displayfd', '1', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'];
  if (!socketDirWritable) {
    args.push('-nolisten', 'unix');
    log('XVFB_ABSTRACT_SOCKET_ONLY /tmp/.X11-unix not writable; starting Xvfb with -nolisten unix');
  }
  return new Promise((resolve, reject) => {
    let child;
    let timer;
    let settled = false;
    let stderr = '';
    const fail = (reason, { cause, stop = false } = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const snippet = (stderr || String(cause?.stderr || '')).slice(0, 300);
      reject(Object.assign(new Error(`XVFB_UNAVAILABLE: ${reason}; stderr: ${snippet}`, { cause }), {
        code: 'XVFB_UNAVAILABLE', stderr: snippet
      }));
      if (stop) child?.kill();
    };
    try {
      child = spawnImpl('Xvfb', args,
        { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      fail(`spawn failed (${error.code || error.message})`, { cause: error });
      return;
    }
    timer = setTimeout(() => fail(`no display number within ${timeoutMs}ms`, { stop: true }), timeoutMs);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(0, 300); });
    child.once('error', error => {
      fail(`spawn failed (${error.code || error.message})`, { cause: error });
    });
    child.once('exit', (code, signal) => fail(`exited before display number (code=${code}, signal=${signal || 'none'})`));
    let out = '';
    child.stdout.on('data', chunk => {
      if (settled) return;
      out += chunk;
      const match = out.match(/^(\d+)\s*$/m);
      if (match) {
        settled = true;
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
