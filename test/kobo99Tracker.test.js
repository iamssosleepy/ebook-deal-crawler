import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseKobo99Tracker, fetchKobo99Tracker, parseKoboSnapshot } from '../src/sources/koboSnapshot.js';
import { fetchKoboDeals } from '../src/sources/kobo.js';
import { normalizeDeals } from '../src/normalize.js';
import { buildDiscordPayload } from '../src/output/discord.js';

const fixture = async () => JSON.parse(await fs.readFile(new URL('./fixtures/kobo99-tracker-w41.json', import.meta.url), 'utf8'));
const now = new Date('2026-10-13T11:00:00+08:00');
const official = 'https://www.kobo.com/zh/blog/weekly-dd99-2026-w41/';

test('kobo99-tracker W41 fixture maps to validated official-cited rows', async () => {
  const data = await fixture();
  const rows = parseKobo99Tracker(data, now);
  assert.equal(rows.length, 8);
  assert.deepEqual([...new Set(rows.map(r => r.startDate))],
    ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
  for (const row of rows) {
    assert.equal(row.salePrice, 99);
    assert.equal(row.sourcePage, official);
    assert.equal(row.coverUrl, '');
    assert.equal(row.fetchMethod, 'kobo99-tracker');
    assert.equal(row.confidence, 'medium');
    assert.equal(row.endDate, row.startDate);
    assert.match(row.url, /^https:\/\/www\.kobo\.com\/tw\/zh\/ebook\/[^/?]+$/);
  }
  assert.equal(rows[0].originalPrice, 294);
});

test('kobo99-tracker rejects wrong week, stale data, non-99 price, bad dates and non-Kobo URLs', async () => {
  const cases = [
    d => { d.week = 40; },
    d => { d.year = 2025; },
    d => { d.updated_at = '2026-10-01T11:35:21+08:00'; },
    d => { d.updated_at = '2026-10-08 11:35'; },
    d => { d.books = []; },
    d => { d.sale_start = '2026-10-01'; }
  ];
  for (const mutate of cases) {
    const data = await fixture();
    mutate(data);
    assert.throws(() => parseKobo99Tracker(data, now), { code: 'KOBO_SNAPSHOT_INVALID' });
  }
  const rowCases = [
    d => { d.books[0].sale_price = 'NT$129'; },
    d => { delete d.books[0].sale_price; },
    d => { d.books[0].date = '10/1'; },
    d => { d.books[0].date = 'tomorrow'; },
    d => { d.books[0].kobo_url = 'https://evil.example/tw/zh/ebook/x'; },
    d => { d.books[0].title = ' '; }
  ];
  for (const mutate of rowCases) {
    const data = await fixture();
    mutate(data);
    assert.throws(() => parseKobo99Tracker(data, now), { code: 'KOBO_SNAPSHOT_INVALID_ROW' });
  }
  const missingDay = await fixture();
  missingDay.books = missingDay.books.filter(b => b.date !== '10/12');
  assert.throws(() => parseKobo99Tracker(missingDay, now), { code: 'KOBO_INCOMPLETE_DATES' });
});

test('fetchKobo99Tracker maps HTTP failures to a safe code without echoing the body', async () => {
  const fetchImpl = async () => ({ status: 503, headers: {}, text: async () => 'BODY_CANARY' });
  await assert.rejects(fetchKobo99Tracker(now, { fetchImpl }), e => e.code === 'KOBO_TRACKER_FAILED' && !e.message.includes('BODY_CANARY'));
  const data = await fixture();
  const ok = async () => ({ status: 200, headers: {}, text: async () => JSON.stringify(data) });
  assert.equal((await fetchKobo99Tracker(now, { fetchImpl: ok })).length, 8);
});

test('diagnostic meta logs carry week/time/dates but no URL or titles', async () => {
  const data = await fixture();
  const lines = [];
  const logger = { log: m => lines.push(m), warn: m => lines.push(m) };
  parseKobo99Tracker(data, now, { logger });
  assert.throws(() => parseKoboSnapshot({ kobo: { success: true, platform: 'kobo',
    source: 'https://secret.invalid/api?token=x', fetchedAt: '2026-10-08T03:35:21.701Z',
    deals: [{ title: 'TITLE_CANARY', date: '2026-10-13', bookUrl: 'https://secret.invalid/b' }] } }, now, { logger }));
  const text = lines.join('\n');
  assert.match(text, /kobo: W41 kobo99-tracker meta week=2026-w41 updatedAt=2026-10-08T11:35:21\.701664\+08:00/);
  assert.match(text, /kobo: W41 snapshot meta source=url-redacted fetchedAt=2026-10-08T03:35:21\.701Z/);
  assert.doesNotMatch(text, /https?:|secret\.invalid|TITLE_CANARY|token/);
  for (const book of data.books) assert.ok(!text.includes(book.title));
  assert.ok(lines.every(l => l.length < 400));
});

test('pipeline uses kobo99-tracker after the fallback and Discord marks rows as 第三方週公告', async () => {
  const data = await fixture();
  const lines = [];
  const rows = await fetchKoboDeals({ now, logger: { log: m => lines.push(m), warn: m => lines.push(m) },
    fetchMarkdown: async () => { throw new Error('403'); }, loadLocal: async () => [], fetchHtml: async () => '',
    readCache: async () => null, writeCache: async () => assert.fail('no cache for third-party rows'),
    loadFallback: async () => { throw Object.assign(new Error('x'), { code: 'KOBO_SNAPSHOT_INVALID' }); },
    loadTracker: (n, opts) => parseKobo99Tracker(data, n, opts),
    loadSnapshot: () => assert.fail('file stage not reached') });
  assert.equal(rows.length, 8);
  assert.ok(lines.includes('kobo: W41 kobo99-tracker validated 8 rows'));
  const text = JSON.stringify(buildDiscordPayload(normalizeDeals(rows)));
  assert.match(text, /第三方週公告/);
});
