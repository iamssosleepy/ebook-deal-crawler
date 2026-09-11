import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseKoboSnapshot, loadKoboSnapshot, SNAPSHOT_SOURCE } from '../src/sources/koboSnapshot.js';
import { fetchKoboDeals } from '../src/sources/kobo.js';
import { campaignDates, validateKoboCampaign } from '../src/sources/koboValidation.js';
import { normalizeDeals } from '../src/normalize.js';
import { buildDiscordPayload } from '../src/output/discord.js';

const now = new Date('2026-09-11T08:00:00Z');
const fixture = () => ({ kobo: { success: true, platform: 'kobo',
  source: 'Kobo Blog weekly-dd99-2026-w37', fetchedAt: '2026-09-11T04:12:34.402Z',
  deals: campaignDates(2026, 37).map((date, i) => ({
    platform: 'kobo', title: `合成測試${i}`, date, dealPrice: 99, originalPrice: 0,
    bookUrl: `https://www.kobo.com/tw/zh/ebook/synthetic-${i}`
  })) } });

test('public snapshot retains third-party provenance and unknown original price', () => {
  const rows = parseKoboSnapshot(fixture(), now);
  assert.equal(rows.length, 7);
  assert.equal(rows[0].sourcePage, SNAPSHOT_SOURCE);
  assert.equal(rows[0].confidence, 'medium');
  assert.equal(rows[0].originalPrice, '');
  assert.equal(rows[0].sourceFetchedAt, fixture().kobo.fetchedAt);
  assert.throws(() => validateKoboCampaign(rows, 2026, 37), { code: 'KOBO_INVALID_SOURCE' });
  const normalized = normalizeDeals(rows);
  assert.ok(normalized.every(r => r.source_page === SNAPSHOT_SOURCE && r.confidence === 'medium'));
  const payload = buildDiscordPayload(normalized);
  assert.equal(payload.embeds[0].footer.text, '資料來源：Kobo｜自動爬蟲整理');
  assert.doesNotMatch(JSON.stringify(payload), /HelloRuru|第三方整理/);
  assert.ok(normalized.every(r => r.fetch_method === 'helloruru-public-api-snapshot'));
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

test('valid snapshot avoids all live Kobo endpoints', async () => {
  const result = await fetchKoboDeals({ now, logger: {log() {}, warn() {}},
    loadSnapshot: async () => parseKoboSnapshot(fixture(), now),
    fetchMarkdown: () => assert.fail('no proxy call'),
    fetchHtml: () => assert.fail('no html call'),
    loadLocal: () => assert.fail('no old cache call') });
  assert.equal(result.length, 7);
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
