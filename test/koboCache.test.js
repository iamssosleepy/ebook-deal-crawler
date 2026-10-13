import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetchKoboDeals, parseKoboHtml, parseKoboMarkdown } from '../src/sources/kobo.js';
import { koboCacheDir, readKoboWeekCache, writeKoboWeekCache } from '../src/sources/koboCache.js';
import { fetchKoboFallbackApi, loadKoboSnapshot } from '../src/sources/koboSnapshot.js';
import { campaignDates, campaignWeek } from '../src/sources/koboValidation.js';
import { normalizeDeals } from '../src/normalize.js';
import { buildDiscordPayload } from '../src/output/discord.js';
import { rowsForGoogleSheets, writeSheetsCsv } from '../src/output/sheetsCsv.js';

const FALLBACK_URL = 'https://secondary-source.invalid/api/deals';
const CANARY = 'SECONDARY_SOURCE_CANARY';
const PRIVACY = /secondary-source\.invalid|SECONDARY_SOURCE_CANARY/i;
const now = new Date('2026-10-06T02:00:00Z');
const quiet = { log() {}, warn() {} };

function articleUrl(year, week) {
  return `https://www.kobo.com/zh/blog/weekly-dd99-${year}-w${week}/`;
}

function markdownFor(year, week) {
  return campaignDates(year, week).map((date, index) => {
    const month = Number(date.slice(5, 7));
    const day = Number(date.slice(8, 10));
    return `### ${month}/${day} 週三 Kobo99選書《合成測試${index}》\n[查看電子書](https://www.kobo.com/tw/zh/ebook/synthetic-${week}-${index})\n`;
  }).join('\n');
}

function htmlFor(year, week) {
  return campaignDates(year, week).map((date, index) => {
    const month = Number(date.slice(5, 7));
    const day = Number(date.slice(8, 10));
    return `<h3>${month}/${day} 週三 Kobo99選書《合成測試${index}》</h3><p><a href="https://www.kobo.com/tw/zh/ebook/synthetic-${week}-${index}">查看電子書</a></p>`;
  }).join('');
}

function localRows(year, week) {
  return campaignDates(year, week).map((date, index) => ({
    platform: 'Kobo',
    campaignType: '每日99書單',
    title: `本機測試${index}`,
    author: '',
    publisher: '',
    originalPrice: '',
    salePrice: 99,
    startDate: date,
    endDate: date,
    url: `https://www.kobo.com/tw/zh/ebook/local-${week}-${index}`,
    coverUrl: '',
    sourcePage: articleUrl(year, week),
    fetchMethod: 'local-validated-jsonl',
    confidence: 'high'
  }));
}

function fallbackPayload(year, week, fetchedAt, mutate = body => body) {
  const body = {
    unused: `${CANARY} ${FALLBACK_URL}`,
    kobo: {
      success: true,
      platform: 'kobo',
      source: `Kobo Blog weekly-dd99-${year}-w${week}`,
      fetchedAt,
      unused: CANARY,
      deals: campaignDates(year, week).map((date, index) => ({
        platform: 'kobo',
        title: `備援測試${index}`,
        author: '',
        date,
        dealPrice: 99,
        originalPrice: 0,
        bookUrl: `https://www.kobo.com/tw/zh/ebook/fallback-${week}-${index}`,
        coverUrl: 'https://kobo-blog.transforms.svdcdn.com/production/img/covers/fallback.jpg',
        unused: CANARY
      }))
    }
  };
  return mutate(body);
}

function jsonResponse(body, { status = 200, length } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === 'content-length' && length != null) return String(length);
        return null;
      }
    },
    async text() { return text; }
  };
}

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kobo-cache-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

function linesOf() {
  const lines = [];
  return { lines, logger: { log: message => lines.push(message), warn: message => lines.push(message) } };
}

test('markdown and html successes write the same-week cache; local success does not', async t => {
  assert.deepEqual(campaignWeek(now), { year: 2026, week: 40 });
  const dir = await tempDir(t);
  const file = path.join(dir, 'kobo-week-2026-w40.json');

  const markdownRows = await fetchKoboDeals({
    now,
    logger: quiet,
    fetchMarkdown: async () => markdownFor(2026, 40),
    loadLocal: () => assert.fail('local'),
    fetchHtml: () => assert.fail('html'),
    readCache: () => assert.fail('read'),
    loadFallback: () => assert.fail('fallback'),
    loadSnapshot: () => assert.fail('file'),
    writeCache: args => writeKoboWeekCache({ ...args, dir })
  });
  const markdownCache = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(markdownCache.version, 1);
  assert.equal(markdownCache.year, 2026);
  assert.equal(markdownCache.week, 40);
  assert.equal(markdownCache.stage, 'markdown');
  assert.equal(markdownCache.savedAt, now.toISOString());
  assert.deepEqual(markdownCache.rows, markdownRows);
  assert.deepEqual(await readKoboWeekCache({ year: 2026, week: 40, dir }), markdownRows);
  assert.deepEqual(await fs.readdir(dir), ['kobo-week-2026-w40.json']);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  }

  const htmlRows = await fetchKoboDeals({
    now,
    logger: quiet,
    fetchMarkdown: async () => { throw new Error('blocked'); },
    loadLocal: async () => [],
    fetchHtml: async () => htmlFor(2026, 40),
    readCache: () => assert.fail('read'),
    loadFallback: () => assert.fail('fallback'),
    loadSnapshot: () => assert.fail('file'),
    writeCache: args => writeKoboWeekCache({ ...args, dir })
  });
  const htmlCache = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(htmlCache.stage, 'html');
  assert.deepEqual(htmlCache.rows, htmlRows);
  assert.equal(htmlRows[0].fetchMethod, 'http+html');
  assert.equal(parseKoboHtml(htmlFor(2026, 40), articleUrl(2026, 40), 2026)[0].sourcePage, articleUrl(2026, 40));

  let wrote = false;
  const local = await fetchKoboDeals({
    now,
    logger: quiet,
    fetchMarkdown: async () => { throw new Error('blocked'); },
    loadLocal: async () => localRows(2026, 40),
    fetchHtml: () => assert.fail('html'),
    readCache: () => assert.fail('read'),
    loadFallback: () => assert.fail('fallback'),
    loadSnapshot: () => assert.fail('file'),
    writeCache: async () => { wrote = true; }
  });
  assert.equal(wrote, false);
  assert.equal(local[0].fetchMethod, 'local-validated-jsonl');
  assert.equal(htmlCache.stage, 'html');
});

test('a cache write failure still returns the official rows', async () => {
  const { lines, logger } = linesOf();
  const result = await fetchKoboDeals({
    now,
    logger,
    fetchMarkdown: async () => markdownFor(2026, 40),
    loadLocal: () => assert.fail('local'),
    fetchHtml: () => assert.fail('html'),
    readCache: () => assert.fail('read'),
    loadFallback: () => assert.fail('fallback'),
    loadSnapshot: () => assert.fail('file'),
    writeCache: async () => { throw new Error(`EACCES /var/${CANARY}`); }
  });
  assert.equal(result.length, 7);
  assert.equal(result[0].fetchMethod, 'official-markdown-proxy');
  assert.ok(lines.includes('kobo: W40 markdown validated 7 rows'));
  assert.ok(lines.includes('kobo: W40 cache KOBO_CACHE_WRITE_FAILED'));
  assert.doesNotMatch(lines.join('\n'), PRIVACY);
});

test('same-week cache is reused and does not call the live fallback', async t => {
  const dir = await tempDir(t);
  const rows = parseKoboMarkdown(markdownFor(2026, 40), articleUrl(2026, 40), 2026);
  await writeKoboWeekCache({ year: 2026, week: 40, rows, dir, now, stage: 'markdown' });
  let fallback = 0;
  let wrote = false;
  const { lines, logger } = linesOf();
  const result = await fetchKoboDeals({
    now,
    logger,
    fetchMarkdown: async () => { throw new Error(`blocked ${FALLBACK_URL}`); },
    loadLocal: async () => [],
    fetchHtml: async () => { throw new Error('blocked'); },
    readCache: query => readKoboWeekCache({ ...query, dir }),
    writeCache: async () => { wrote = true; },
    loadFallback: async () => { fallback += 1; return rows; },
    loadSnapshot: () => assert.fail('file')
  });
  assert.equal(fallback, 0);
  assert.equal(wrote, false);
  assert.deepEqual(result, rows);
  assert.ok(lines.includes('kobo: W40 cache validated 7 rows'));
  assert.doesNotMatch(lines.join('\n'), PRIVACY);
  assert.doesNotMatch(lines.join('\n'), /https?:/);
});

test('a prior week cache file is never opened for the current week', async t => {
  const dir = await tempDir(t);
  const priorNow = new Date('2026-09-25T04:00:00Z');
  assert.deepEqual(campaignWeek(priorNow), { year: 2026, week: 39 });
  const prior = parseKoboMarkdown(markdownFor(2026, 39), articleUrl(2026, 39), 2026);
  prior[0].title = 'PRIOR_WEEK_SENTINEL';
  await writeKoboWeekCache({ year: 2026, week: 39, rows: prior, dir, now: priorNow, stage: 'html' });
  const before = await fs.readFile(path.join(dir, 'kobo-week-2026-w39.json'), 'utf8');
  assert.equal(await readKoboWeekCache({ year: 2026, week: 40, dir }), null);

  const fresh = parseKoboMarkdown(markdownFor(2026, 40), articleUrl(2026, 40), 2026);
  let fallback = 0;
  let wrote = false;
  const result = await fetchKoboDeals({
    now,
    logger: quiet,
    fetchMarkdown: async () => { throw new Error('blocked'); },
    loadLocal: async () => [],
    fetchHtml: async () => { throw new Error('blocked'); },
    readCache: query => readKoboWeekCache({ ...query, dir }),
    writeCache: async () => { wrote = true; },
    loadFallback: async () => { fallback += 1; return fresh; },
    loadSnapshot: () => assert.fail('file')
  });
  assert.equal(fallback, 1);
  assert.equal(wrote, false);
  assert.ok(result.every(row => row.title !== 'PRIOR_WEEK_SENTINEL'));
  assert.equal(await fs.readFile(path.join(dir, 'kobo-week-2026-w39.json'), 'utf8'), before);
  assert.deepEqual(await fs.readdir(dir), ['kobo-week-2026-w39.json']);
});

test('a week file with other dates or mismatched year/week is not reused', async t => {
  const dir = await tempDir(t);
  const stale = parseKoboMarkdown(markdownFor(2026, 39), articleUrl(2026, 39), 2026);
  const current = parseKoboMarkdown(markdownFor(2026, 40), articleUrl(2026, 40), 2026);
  const file = path.join(dir, 'kobo-week-2026-w40.json');
  await fs.writeFile(file, JSON.stringify({
    version: 1, year: 2026, week: 40, savedAt: now.toISOString(), stage: 'markdown', rows: stale
  }));
  await assert.rejects(() => readKoboWeekCache({ year: 2026, week: 40, dir }), error => {
    assert.equal(error.code, 'KOBO_CACHE_INVALID');
    assert.equal(error.message, 'KOBO_CACHE_INVALID');
    return true;
  });

  let fallback = 0;
  const result = await fetchKoboDeals({
    now,
    logger: quiet,
    fetchMarkdown: async () => { throw new Error('blocked'); },
    loadLocal: async () => [],
    fetchHtml: async () => { throw new Error('blocked'); },
    readCache: query => readKoboWeekCache({ ...query, dir }),
    writeCache: async () => {},
    loadFallback: async () => { fallback += 1; return current; },
    loadSnapshot: async () => null
  });
  assert.equal(fallback, 1);
  assert.deepEqual(result, current);

  await fs.writeFile(file, JSON.stringify({
    version: 1, year: 2026, week: 39, savedAt: now.toISOString(), stage: 'markdown', rows: current
  }));
  await assert.rejects(() => readKoboWeekCache({ year: 2026, week: 40, dir }), { code: 'KOBO_CACHE_INVALID' });
  await fs.writeFile(file, JSON.stringify({
    version: 1, year: 2025, week: 40, savedAt: now.toISOString(), stage: 'markdown', rows: current
  }));
  await assert.rejects(() => readKoboWeekCache({ year: 2026, week: 40, dir }), { code: 'KOBO_CACHE_INVALID' });
});

test('cached kobo-fallback rows are rejected', async t => {
  const dir = await tempDir(t);
  const rows = parseKoboMarkdown(markdownFor(2026, 40), articleUrl(2026, 40), 2026)
    .map(row => ({ ...row, fetchMethod: 'kobo-fallback', confidence: 'medium' }));
  await writeKoboWeekCache({ year: 2026, week: 40, rows, dir, now, stage: 'markdown' });
  await assert.rejects(() => readKoboWeekCache({ year: 2026, week: 40, dir }), {
    code: 'KOBO_CACHE_INVALID',
    message: 'KOBO_CACHE_INVALID'
  });
  let fallback = 0;
  await fetchKoboDeals({
    now,
    logger: quiet,
    fetchMarkdown: async () => { throw new Error('blocked'); },
    loadLocal: async () => [],
    fetchHtml: async () => { throw new Error('blocked'); },
    readCache: query => readKoboWeekCache({ ...query, dir }),
    writeCache: async () => { throw new Error('should not cache fallback'); },
    loadFallback: async () => { fallback += 1; return rows; },
    loadSnapshot: async () => null
  });
  assert.equal(fallback, 1);
  assert.deepEqual(await fs.readdir(dir), ['kobo-week-2026-w40.json']);
});

test('live fallback supplies official rows and is not written to the cache', async t => {
  const dir = await tempDir(t);
  const seen = [];
  const { lines, logger } = linesOf();
  let wrote = false;
  const previousFallbackUrl = process.env.KOBO_FALLBACK_URL;
  process.env.KOBO_FALLBACK_URL = FALLBACK_URL;
  t.after(() => {
    if (previousFallbackUrl === undefined) delete process.env.KOBO_FALLBACK_URL;
    else process.env.KOBO_FALLBACK_URL = previousFallbackUrl;
  });
  const result = await fetchKoboDeals({
    now,
    logger,
    fetchMarkdown: async () => { throw new Error(`blocked ${CANARY}`); },
    loadLocal: async () => [],
    fetchHtml: async () => { throw new Error(`blocked ${CANARY}`); },
    readCache: async () => null,
    writeCache: async () => { wrote = true; await writeKoboWeekCache({ year: 2026, week: 40, rows: [], dir, now, stage: 'fallback' }); },
    loadSnapshot: () => assert.fail('file'),
    loadFallback: at => fetchKoboFallbackApi(at, {
      url: process.env.KOBO_FALLBACK_URL,
      fetchImpl: async (url, init) => {
        seen.push({ url, method: init.method, headers: init.headers, signal: init.signal });
        return jsonResponse(fallbackPayload(2026, 40, now.toISOString()));
      }
    })
  });
  assert.equal(wrote, false);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, FALLBACK_URL);
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].headers.accept, 'application/json');
  assert.match(seen[0].headers['user-agent'], /Chrome\/124/);
  assert.equal(seen[0].signal.aborted, false);
  assert.equal(String(seen[0].url).includes('refresh'), false);
  assert.equal(result.length, 7);
  assert.ok(result.every(row => row.sourcePage === articleUrl(2026, 40) &&
    row.fetchMethod === 'kobo-fallback' && row.confidence === 'medium' && row.originalPrice === '' &&
    row.coverUrl === 'https://kobo-blog.transforms.svdcdn.com/production/img/covers/fallback.jpg' &&
    !Object.hasOwn(row, 'upstreamSourcePage') && row.sourceFetchedAt === now.toISOString()));
  assert.deepEqual(await fs.readdir(dir), []);
  assert.ok(lines.includes('kobo: W40 fallback validated 7 rows'));
  assert.doesNotMatch(lines.join('\n'), PRIVACY);
  assert.doesNotMatch(lines.join('\n'), /https?:/);
});

test('fallback API rejects bad snapshots and bad responses', async () => {
  const calls = [];
  async function rejectPayload(body, code) {
    await assert.rejects(() => fetchKoboFallbackApi(now, {
      url: 'https://fallback.invalid/deals',
      fetchImpl: async (url, init) => {
        calls.push({ url, method: init?.method });
        return jsonResponse(body);
      }
    }), error => {
      assert.equal(error.code, code);
      assert.equal(error.message, code);
      assert.doesNotMatch(error.message, PRIVACY);
      assert.equal(error.cause, undefined);
      return true;
    });
  }

  await rejectPayload(fallbackPayload(2026, 40, now.toISOString(), data => {
    data.kobo.source = 'Kobo Blog weekly-dd99-2026-w39';
    return data;
  }), 'KOBO_SNAPSHOT_INVALID');
  await rejectPayload(fallbackPayload(2026, 40, new Date(now.getTime() - 8 * 86400000 - 1).toISOString()), 'KOBO_SNAPSHOT_INVALID');
  await rejectPayload(fallbackPayload(2026, 40, new Date(now.getTime() + 300001).toISOString()), 'KOBO_SNAPSHOT_INVALID');
  await rejectPayload(fallbackPayload(2026, 40, now.toISOString(), data => {
    data.kobo.deals.pop();
    return data;
  }), 'KOBO_INCOMPLETE_DATES');

  const edge = await fetchKoboFallbackApi(now, {
    url: 'https://fallback.invalid/deals',
    fetchImpl: async () => jsonResponse(fallbackPayload(2026, 40, new Date(now.getTime() - 8 * 86400000).toISOString()))
  });
  assert.equal(edge.length, 7);
  const nearFuture = await fetchKoboFallbackApi(now, {
    url: 'https://fallback.invalid/deals',
    fetchImpl: async () => jsonResponse(fallbackPayload(2026, 40, new Date(now.getTime() + 300000).toISOString()))
  });
  assert.equal(nearFuture.length, 7);

  const secret = `${CANARY} ${FALLBACK_URL}`;
  let reads = 0;
  await assert.rejects(() => fetchKoboFallbackApi(now, {
    url: secret,
    fetchImpl: async () => ({
      status: 403,
      headers: { get() { return null; } },
      text: async () => { reads += 1; return secret; }
    })
  }), error => {
    assert.equal(error.code, 'KOBO_FALLBACK_FAILED');
    assert.equal(error.message, 'KOBO_FALLBACK_FAILED');
    return true;
  });
  assert.equal(reads, 0);

  await assert.rejects(() => fetchKoboFallbackApi(now, {
    url: 'https://fallback.invalid/deals',
    fetchImpl: async () => ({
      status: 200,
      headers: { get: () => String(1024 * 1024 + 1) },
      text: async () => { reads += 1; return secret; }
    })
  }), { code: 'KOBO_FALLBACK_FAILED', message: 'KOBO_FALLBACK_FAILED' });
  assert.equal(reads, 0);

  await assert.rejects(() => fetchKoboFallbackApi(now, {
    url: 'https://fallback.invalid/deals',
    fetchImpl: async () => jsonResponse('x'.repeat(1024 * 1024 + 1))
  }), { code: 'KOBO_FALLBACK_FAILED', message: 'KOBO_FALLBACK_FAILED' });
  await assert.rejects(() => fetchKoboFallbackApi(now, {
    url: 'https://fallback.invalid/deals',
    fetchImpl: async () => jsonResponse(`{"no": ${secret}`)
  }), { code: 'KOBO_FALLBACK_FAILED', message: 'KOBO_FALLBACK_FAILED' });
  assert.ok(calls.every(call => call.method === 'GET' && call.url === 'https://fallback.invalid/deals'));
  assert.equal(calls.some(call => String(call.url).includes('refresh')), false);
});

test('published fallback output and logs omit the secondary source', async t => {
  const dir = await tempDir(t);
  const { lines, logger } = linesOf();
  const rows = await fetchKoboDeals({
    now,
    logger,
    fetchMarkdown: async () => { throw new Error(`${FALLBACK_URL} ${CANARY}`); },
    loadLocal: async () => [],
    fetchHtml: async () => { throw new Error(CANARY); },
    readCache: async () => null,
    writeCache: async () => {},
    loadSnapshot: async () => null,
    loadFallback: at => fetchKoboFallbackApi(at, {
      url: FALLBACK_URL,
      fetchImpl: async () => jsonResponse(fallbackPayload(2026, 40, now.toISOString()))
    })
  });
  const normalized = normalizeDeals(rows);
  const sheet = rowsForGoogleSheets(normalized);
  const csvPath = await writeSheetsCsv(normalized, dir);
  const csv = await fs.readFile(csvPath, 'utf8');
  const payload = buildDiscordPayload(normalized);
  const published = `${JSON.stringify(normalized)}\n${JSON.stringify(sheet)}\n${csv}\n${JSON.stringify(payload)}`;
  assert.doesNotMatch(published, PRIVACY);
  assert.doesNotMatch(lines.join('\n'), PRIVACY);
  assert.doesNotMatch(lines.join('\n'), /https?:/);
  assert.ok(normalized.every(row => row.fetch_method === 'kobo-fallback' && row.source_page === articleUrl(2026, 40) &&
    !Object.hasOwn(row, 'sourceFetchedAt') && !Object.hasOwn(row, 'upstreamSourcePage')));
  assert.equal(payload.embeds[0].footer.text, '資料來源：Kobo｜自動爬蟲整理');

  const real = await loadKoboSnapshot(new Date('2026-09-11T08:00:00Z'));
  const realNormalized = normalizeDeals(real);
  const realPublished = `${JSON.stringify(realNormalized)}\n${JSON.stringify(rowsForGoogleSheets(realNormalized))}\n${JSON.stringify(buildDiscordPayload(realNormalized))}`;
  assert.doesNotMatch(realPublished, PRIVACY);
  assert.ok(real.every(row => row.fetchMethod === 'kobo-fallback' &&
    row.sourcePage === articleUrl(2026, 37) && !Object.hasOwn(row, 'upstreamSourcePage')));
  assert.ok(realNormalized.every(row => !Object.hasOwn(row, 'sourceFetchedAt')));
});

test('KOBO_FALLBACK_URL unset, empty, or off disables the live fallback; a URL enables it', async () => {
  const previous = process.env.KOBO_FALLBACK_URL;
  const originalFetch = globalThis.fetch;
  const fetches = [];
  globalThis.fetch = async url => {
    fetches.push(String(url));
    throw new Error(`blocked ${url} ${CANARY}`);
  };
  const base = {
    now,
    fetchMarkdown: async () => { throw new Error(`markdown ${FALLBACK_URL} ${CANARY}`); },
    loadLocal: async () => [],
    fetchHtml: async () => { throw new Error('html blocked'); },
    readCache: async () => null,
    writeCache: async () => {},
    loadTracker: async () => null,
    loadSnapshot: async () => null
  };
  try {
    delete process.env.KOBO_FALLBACK_URL;
    const unsetLogs = linesOf();
    await assert.rejects(() => fetchKoboDeals({ ...base, logger: unsetLogs.logger }), error => {
      assert.equal(error.failures.find(item => item.stage === 'fallback').code, 'KOBO_FALLBACK_DISABLED');
      assert.doesNotMatch(error.message, PRIVACY);
      assert.doesNotMatch(error.message, /https?:/);
      return true;
    });
    assert.deepEqual(fetches, []);
    assert.ok(unsetLogs.lines.includes('kobo: W40 fallback KOBO_FALLBACK_DISABLED'));
    assert.doesNotMatch(unsetLogs.lines.join('\n'), PRIVACY);
    assert.doesNotMatch(unsetLogs.lines.join('\n'), /https?:/);

    process.env.KOBO_FALLBACK_URL = '';
    const emptyLogs = linesOf();
    await assert.rejects(() => fetchKoboDeals({ ...base, logger: emptyLogs.logger }), error => {
      assert.equal(error.failures.find(item => item.stage === 'fallback').code, 'KOBO_FALLBACK_DISABLED');
      assert.doesNotMatch(error.message, PRIVACY);
      assert.doesNotMatch(error.message, /https?:/);
      return true;
    });
    assert.deepEqual(fetches, []);
    assert.ok(emptyLogs.lines.includes('kobo: W40 fallback KOBO_FALLBACK_DISABLED'));
    assert.doesNotMatch(emptyLogs.lines.join('\n'), PRIVACY);
    assert.doesNotMatch(emptyLogs.lines.join('\n'), /https?:/);

    process.env.KOBO_FALLBACK_URL = 'off';
    const disabledLogs = linesOf();
    await assert.rejects(() => fetchKoboDeals({ ...base, logger: disabledLogs.logger }), error => {
      assert.equal(error.failures.find(item => item.stage === 'fallback').code, 'KOBO_FALLBACK_DISABLED');
      assert.doesNotMatch(error.message, PRIVACY);
      assert.doesNotMatch(error.message, /https?:/);
      return true;
    });
    assert.deepEqual(fetches, []);
    assert.ok(disabledLogs.lines.includes('kobo: W40 fallback KOBO_FALLBACK_DISABLED'));
    assert.doesNotMatch(disabledLogs.lines.join('\n'), PRIVACY);
    assert.doesNotMatch(disabledLogs.lines.join('\n'), /https?:/);

    process.env.KOBO_FALLBACK_URL = FALLBACK_URL;
    const enabledLogs = linesOf();
    await assert.rejects(() => fetchKoboDeals({ ...base, logger: enabledLogs.logger }), error => {
      assert.equal(error.failures.find(item => item.stage === 'fallback').code, 'KOBO_FALLBACK_FAILED');
      assert.doesNotMatch(error.message, PRIVACY);
      assert.doesNotMatch(error.message, /https?:/);
      return true;
    });
    assert.deepEqual(fetches, [FALLBACK_URL]);
    assert.ok(enabledLogs.lines.includes('kobo: W40 fallback KOBO_FALLBACK_FAILED'));
    assert.doesNotMatch(enabledLogs.lines.join('\n'), PRIVACY);
    assert.doesNotMatch(enabledLogs.lines.join('\n'), /https?:/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.KOBO_FALLBACK_URL;
    else process.env.KOBO_FALLBACK_URL = previous;
  }
});

test('cache names pad the week, ignore other weeks, and stay disabled without a directory', async t => {
  const dir = await tempDir(t);
  await writeKoboWeekCache({ year: 2026, week: 9, rows: [], dir, now, stage: 'markdown' });
  assert.ok((await fs.readdir(dir)).includes('kobo-week-2026-w09.json'));
  await assert.rejects(() => readKoboWeekCache({ year: 2026, week: 9, dir }), { code: 'KOBO_CACHE_INVALID' });
  await fs.writeFile(path.join(dir, 'kobo-week-2026-w40.json'), `{"rows": ${CANARY}`);
  await assert.rejects(() => readKoboWeekCache({ year: 2026, week: 40, dir }), {
    code: 'KOBO_CACHE_INVALID',
    message: 'KOBO_CACHE_INVALID'
  });
  await fs.writeFile(path.join(dir, 'kobo-week-2026-w40.json'), 'x'.repeat(1024 * 1024 + 1));
  await assert.rejects(() => readKoboWeekCache({ year: 2026, week: 40, dir }), {
    code: 'KOBO_CACHE_INVALID',
    message: 'KOBO_CACHE_INVALID'
  });

  const before = await fs.readdir(dir);
  await writeKoboWeekCache({ year: 2026, week: 40, rows: [{ title: 'x' }], dir: '', now, stage: 'markdown' });
  assert.equal(await readKoboWeekCache({ year: 2026, week: 40, dir: '' }), null);
  assert.deepEqual(await fs.readdir(dir), before);

  const previousCache = process.env.KOBO_CACHE_DIR;
  const previousState = process.env.DELIVERY_STATE_DIR;
  try {
    process.env.KOBO_CACHE_DIR = '/cache';
    process.env.DELIVERY_STATE_DIR = '/state';
    assert.equal(koboCacheDir(), '/cache');
    process.env.KOBO_CACHE_DIR = '';
    assert.equal(koboCacheDir(), '/state');
    delete process.env.DELIVERY_STATE_DIR;
    assert.equal(koboCacheDir(), '');
  } finally {
    if (previousCache === undefined) delete process.env.KOBO_CACHE_DIR;
    else process.env.KOBO_CACHE_DIR = previousCache;
    if (previousState === undefined) delete process.env.DELIVERY_STATE_DIR;
    else process.env.DELIVERY_STATE_DIR = previousState;
  }
});

test('fallback coverUrl drops forbidden hosts and preserves svdcdn', async () => {
  const payload = fallbackPayload(2026, 40, now.toISOString(), data => {
    data.kobo.deals[0].coverUrl = 'https://cdn.secondary-source.invalid/x.jpg';
    return data;
  });
  const rows = await fetchKoboFallbackApi(now, {
    url: 'https://fallback.invalid/deals',
    fetchImpl: async () => jsonResponse(payload)
  });
  assert.equal(rows[0].coverUrl, '');
  assert.equal(rows[1].coverUrl, 'https://kobo-blog.transforms.svdcdn.com/production/img/covers/fallback.jpg');
});
