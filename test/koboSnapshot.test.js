import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseKoboSnapshot, loadKoboSnapshot } from '../src/sources/koboSnapshot.js';
import { fetchKoboDeals } from '../src/sources/kobo.js';
import { campaignDates, validateKoboCampaign } from '../src/sources/koboValidation.js';
import { normalizeDeals } from '../src/normalize.js';
import { buildDiscordPayload } from '../src/output/discord.js';
import { rowsForGoogleSheets } from '../src/output/sheetsCsv.js';

const now = new Date('2026-09-11T08:00:00Z');
const fixture = () => ({ kobo: { success: true, platform: 'kobo',
  source: 'Kobo Blog weekly-dd99-2026-w37', fetchedAt: '2026-09-11T04:12:34.402Z',
  deals: campaignDates(2026, 37).map((date, i) => ({
    platform: 'kobo', title: `合成測試${i}`, date, dealPrice: 99, originalPrice: 0,
    bookUrl: `https://www.kobo.com/tw/zh/ebook/synthetic-${i}`
  })) } });

test('fallback snapshot cites the official article and keeps unknown original price', () => {
  const data = fixture();
  data.note = 'HelloRuru https://ebook-deals.vmpvmp1017.workers.dev/api/deals';
  data.kobo.deals[0].coverUrl = 'https://kobo-blog.transforms.svdcdn.com/production/img/covers/synthetic.jpg';
  const rows = parseKoboSnapshot(data, now);
  const official = 'https://www.kobo.com/zh/blog/weekly-dd99-2026-w37/';
  assert.equal(rows.length, 7);
  assert.equal(rows[0].sourcePage, official);
  assert.equal(rows[0].fetchMethod, 'kobo-fallback');
  assert.equal(rows[0].confidence, 'medium');
  assert.equal(rows[0].originalPrice, '');
  assert.equal(rows[0].coverUrl, data.kobo.deals[0].coverUrl);
  assert.equal(rows[0].sourceFetchedAt, data.kobo.fetchedAt);
  assert.equal(Object.hasOwn(rows[0], 'upstreamSourcePage'), false);
  assert.equal(validateKoboCampaign(rows, 2026, 37), rows);
  const normalized = normalizeDeals(rows);
  assert.ok(normalized.every(row => row.source_page === official && row.confidence === 'medium' &&
    row.fetch_method === 'kobo-fallback' && !Object.hasOwn(row, 'sourceFetchedAt')));
  const payload = buildDiscordPayload(normalized);
  assert.equal(payload.embeds[0].footer.text, '資料來源：Kobo｜自動爬蟲整理');
  const published = `${JSON.stringify(normalized)}\n${JSON.stringify(rowsForGoogleSheets(normalized))}\n${JSON.stringify(payload)}`;
  assert.doesNotMatch(published, /helloruru|vmpvmp1017|workers\.dev/i);
  assert.doesNotMatch(published, /第三方整理/);
});

for (const [name, mutate] of [
  ['wrong campaign', d => { d.kobo.source = 'Kobo Blog weekly-dd99-2026-w36'; }],
  ['stale source despite fresh global timestamp', d => { d.updatedAt = now.toISOString(); d.kobo.fetchedAt = '2026-09-01T00:00:00Z'; }],
  ['future observation', d => { d.kobo.fetchedAt = '2026-09-12T00:00:00Z'; }],
  ['ambiguous timestamp', d => { d.kobo.fetchedAt = '2026-09-11T04:12:34'; }],
  ['missing day', d => { d.kobo.deals.pop(); }],
  ['stale date', d => { d.kobo.deals[0].date = '2026-09-03'; }],
  ['foreign product link', d => { d.kobo.deals[0].bookUrl = 'https://example.org/not-kobo'; }],
  ['unexpected price', d => { d.kobo.deals[0].dealPrice = 199; }],
  ['false success', d => { d.kobo.success = false; }],
  ['no title', d => { d.kobo.deals[0].title = ''; }]
]) {
  test(`snapshot rejects ${name}`, () => {
    const data = fixture(); mutate(data);
    assert.throws(() => parseKoboSnapshot(data, now));
  });
}

test('static snapshot is used only after live stages, cache, and the live fallback fail', async () => {
  const calls = [];
  const result = await fetchKoboDeals({ now, logger: { log() {}, warn() {} },
    fetchMarkdown: async () => { calls.push('markdown'); throw new Error('blocked'); },
    loadLocal: async () => { calls.push('local'); return []; },
    fetchHtml: async () => { calls.push('html'); throw new Error('blocked'); },
    readCache: async () => { calls.push('cache'); return null; },
    writeCache: async () => { calls.push('write'); },
    loadFallback: async () => {
      calls.push('fallback');
      throw Object.assign(new Error('KOBO_FALLBACK_FAILED'), { code: 'KOBO_FALLBACK_FAILED' });
    },
    loadSnapshot: async () => { calls.push('file'); return parseKoboSnapshot(fixture(), now); } });
  assert.deepEqual(calls, ['markdown', 'local', 'html', 'cache', 'fallback', 'file']);
  assert.equal(result.length, 7);
  assert.equal(result[0].fetchMethod, 'kobo-fallback');
  assert.equal(result[0].sourcePage, 'https://www.kobo.com/zh/blog/weekly-dd99-2026-w37/');
});

test('snapshot loader is read-only and missing file is not a success', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kobo-snapshot-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'input.json');
  assert.equal(await loadKoboSnapshot(now, file), null);
  const text = JSON.stringify(fixture());
  await fs.writeFile(file, text);
  assert.equal((await loadKoboSnapshot(now, file)).length, 7);
  assert.equal(await fs.readFile(file, 'utf8'), text);
});
