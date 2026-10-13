import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadLocalKoboDeals, fetchKoboDeals, parseKoboHtml, parseKoboMarkdown } from '../src/sources/kobo.js';
import { campaignWeek, campaignDates, validateKoboCampaign } from '../src/sources/koboValidation.js';

// Synthetic fixtures only: these are NOT real W37 books or a publishable source.
const row = {
  year: 2026, week: 37, date: '2026-09-10', title: '《合成測試》',
  source_url: 'https://www.kobo.com/zh/blog/weekly-dd99-2026-w37/',
  tw_url: 'https://www.kobo.com/tw/zh/ebook/synthetic-only'
};

for (const [name, changes] of [
  ['old date relabelled as W37', { date: '2026-09-03' }],
  ['future week date', { date: '2026-09-17' }],
  ['invalid calendar date', { date: '2026-09-31' }],
  ['old source relabelled as W37', { source_url: 'https://www.kobo.com/zh/blog/weekly-dd99-2026-w36/' }],
  ['counterfeit source host', { source_url: 'https://www.kobo.com.example.org/zh/blog/weekly-dd99-2026-w37/' }],
  ['non-book destination', { tw_url: 'https://www.kobo.com/zh/blog/weekly-dd99-2026-w37/' }]
]) {
  test(`does not load ${name}`, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kobo-integrity-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'books.jsonl');
    await fs.writeFile(file, `${JSON.stringify({ ...row, ...changes })}\n`);
    assert.deepEqual(await loadLocalKoboDeals(2026, 37, file), []);
  });
}

const dates = campaignDates(2026, 37);
const target = row.source_url;
const now = new Date('2026-09-11T08:00:00Z');
const fullRows = () => dates.map((date, i) => ({
  title: `合成測試${i}`, startDate: date, endDate: date,
  sourcePage: target, url: `${row.tw_url}-${i}`
}));
const markdown = dates.map((date, i) =>
  `### 9/${Number(date.slice(-2))} 週${'四五六日一二三'[i]} Kobo99選書《合成測試${i}》\n[查看電子書](${row.tw_url}-${i})\n`
).join('\n');
const html = dates.map((date, i) =>
  `<h3>9/${Number(date.slice(-2))} 週${'四五六日一二三'[i]} Kobo99選書《合成測試${i}》</h3><p><a href="${row.tw_url}-${i}">查看電子書</a></p>`
).join('');
const quiet = { log() {}, warn() {} };
const unavailable = async () => { throw new Error('SENSITIVE_REMOTE_BODY'); };

function watchers() {
  const calls = [];
  return {
    calls,
    readCache: async () => { calls.push('read'); return null; },
    writeCache: async () => { calls.push('write'); },
    loadFallback: async () => { calls.push('fallback'); return null; },
    loadSnapshot: async () => { calls.push('snapshot'); return null; }
  };
}

test('campaign uses Taipei midnight, independent of machine timezone', () => {
  assert.deepEqual(campaignWeek(new Date('2026-09-09T15:59:59Z')), { year: 2026, week: 36 });
  assert.deepEqual(campaignWeek(new Date('2026-09-09T16:00:00Z')), { year: 2026, week: 37 });
  assert.deepEqual(campaignWeek(new Date('2026-12-31T16:00:00Z')), { year: 2027, week: 1 });
  assert.deepEqual(dates, ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16']);
});

test('campaign range handles year end and leap year without overflow', () => {
  assert.deepEqual(campaignDates(2026, 53), ['2026-12-31']);
  assert.deepEqual(campaignDates(2028, 53), ['2028-12-30', '2028-12-31']);
  for (const [year, week] of [[2026, 0], [2026, 54], [2026, 1.5], ['2026', 37]]) {
    assert.throws(() => campaignDates(year, week), RangeError);
  }
});

test('complete week may have several books on one day', () => {
  const data = [...fullRows(), { ...fullRows()[1], title: '同日另一本合成書' }];
  assert.equal(validateKoboCampaign(data, 2026, 37), data);
});

test('seven duplicate dates are not a complete weekly list', () => {
  assert.throws(() => validateKoboCampaign(Array(7).fill(fullRows()[0]), 2026, 37), { code: 'KOBO_INCOMPLETE_DATES' });
});

for (const [name, change, code] of [
  ['wrong campaign', { sourcePage: target.replace('w37', 'w36') }, 'KOBO_INVALID_SOURCE'],
  ['wrong year', { startDate: '2025-09-10', endDate: '2025-09-10' }, 'KOBO_INVALID_ROW'],
  ['cross-day validity', { endDate: '2026-09-11' }, 'KOBO_INVALID_ROW'],
  ['missing title', { title: ' ' }, 'KOBO_INVALID_ROW'],
  ['missing product link', { url: target }, 'KOBO_INVALID_ROW'],
  ['credentials in product URL', { url: 'https://user:password@www.kobo.com/tw/zh/ebook/example' }, 'KOBO_INVALID_ROW']
]) {
  test(`rejects parsed ${name}`, () => {
    const data = fullRows(); data[0] = { ...data[0], ...change };
    assert.throws(() => validateKoboCampaign(data, 2026, 37), { code });
  });
}

test('parsers retain explicit campaign year and equivalent book fields', () => {
  const fromHtml = parseKoboHtml(html, target, 2026);
  const fromMarkdown = parseKoboMarkdown(markdown, target, 2026);
  validateKoboCampaign(fromHtml, 2026, 37);
  validateKoboCampaign(fromMarkdown, 2026, 37);
  for (const field of ['title', 'startDate', 'endDate', 'url', 'sourcePage']) {
    assert.deepEqual(fromHtml.map(r => r[field]), fromMarkdown.map(r => r[field]));
  }
});

test('complete markdown stops fallback calls', async () => {
  const later = watchers();
  const result = await fetchKoboDeals({ now, logger: quiet, ...later,
    fetchMarkdown: async url => { assert.equal(url, target); return markdown; },
    loadLocal: () => assert.fail('unexpected local read'),
    fetchHtml: () => assert.fail('unexpected html read') });
  assert.equal(result.length, 7);
  assert.deepEqual(later.calls, ['write']);
});

test('validated complete local data stops html fetch after proxy fails', async () => {
  const later = watchers();
  const result = await fetchKoboDeals({ now, logger: quiet, fetchMarkdown: unavailable, ...later,
    loadLocal: async (year, week) => { assert.equal(year, 2026); assert.equal(week, 37); return fullRows(); },
    fetchHtml: () => assert.fail('unexpected html read') });
  assert.equal(result.length, 7);
  assert.deepEqual(later.calls, []);
});

test('partial local data does not stop complete current-week html fallback', async () => {
  const calls = [];
  const later = watchers();
  const result = await fetchKoboDeals({ now, logger: quiet, fetchMarkdown: unavailable, ...later,
    loadLocal: async () => fullRows().slice(0, 6),
    fetchHtml: async url => { calls.push(url); return html; } });
  assert.deepEqual(calls, [target]); // No tag page or old first candidate.
  assert.equal(result.length, 7);
  assert.deepEqual(later.calls, ['write']);
});

test('wrong-week markdown cannot bypass validation via a correct requested URL', async () => {
  const old = markdown.replaceAll(/9\/(1[0-6])/g, (_, day) => `9/${Number(day) - 7}`);
  const later = watchers();
  const result = await fetchKoboDeals({ now, logger: quiet, ...later,
    fetchMarkdown: async () => old, loadLocal: async () => fullRows(), fetchHtml: unavailable });
  assert.deepEqual(result, fullRows());
  assert.deepEqual(later.calls, []);
});

test('missing W37 reports separate safe stage errors and never returns old data', async () => {
  const warnings = [];
  const later = watchers();
  const old = fullRows().map(r => ({ ...r, sourcePage: target.replace('w37', 'w36') }));
  await assert.rejects(fetchKoboDeals({ now, logger: { log() {}, warn: m => warnings.push(m) }, ...later,
    fetchMarkdown: unavailable, loadLocal: async () => old, fetchHtml: async () => '<h1>Unavailable</h1>', loadTracker: async () => [] }), error => {
    assert.equal(error.code, 'KOBO_CAMPAIGN_UNAVAILABLE');
    assert.deepEqual(error.failures, [
      { stage: 'markdown', code: 'KOBO_READ_FAILED' },
      { stage: 'local', code: 'KOBO_INVALID_SOURCE' },
      { stage: 'html', code: 'KOBO_EMPTY' },
      { stage: 'cache', code: 'KOBO_EMPTY' },
      { stage: 'fallback', code: 'KOBO_EMPTY' },
      { stage: 'kobo99-tracker', code: 'KOBO_EMPTY' },
      { stage: 'fallback-file', code: 'KOBO_EMPTY' }
    ]);
    assert.equal(error.message, 'Kobo 2026-W37 unavailable: markdown=KOBO_READ_FAILED, local=KOBO_INVALID_SOURCE, html=KOBO_EMPTY, cache=KOBO_EMPTY, fallback=KOBO_EMPTY, kobo99-tracker=KOBO_EMPTY, fallback-file=KOBO_EMPTY');
    assert.ok(!error.message.includes('SENSITIVE_REMOTE_BODY'));
    return true;
  });
  assert.deepEqual(later.calls, ['read', 'fallback', 'snapshot']);
  assert.equal(warnings.length, 7);
  assert.ok(warnings.every(w => !w.includes('SENSITIVE_REMOTE_BODY')));
});
