import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseKoboHtml } from '../src/sources/kobo.js';
import { validateKoboCampaign } from '../src/sources/koboValidation.js';
import { logSnapshotMeta } from '../src/sources/koboSnapshot.js';

const articleUrl = 'https://www.kobo.com/zh/blog/weekly-dd99-2026-w41/';

test('real W41 article (headed capture) parses 8 books with Kobo TW book links', async () => {
  const html = await fs.readFile(new URL('./fixtures/kobo-dd99-2026-w41.html', import.meta.url), 'utf8');
  const rows = parseKoboHtml(html, articleUrl, 2026);
  assert.equal(rows.length, 8);
  assert.deepEqual([...new Set(rows.map(r => r.startDate))],
    ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
  for (const row of rows) assert.match(row.url, /^https:\/\/www\.kobo\.com\/tw\/zh\/ebook\/[^/?]+/);
  assert.equal(new Set(rows.map(r => r.url)).size, 8);
  assert.equal(validateKoboCampaign(rows, 2026, 41).length, 8);
});

test('book links are found regardless of link text and HK links only fill in when TW is missing', () => {
  const html = `<article>
    <div class="content-block"><h3>10/8 週四 Kobo99選書:《甲》</h3></div>
    <div class="book-block"><a href="https://www.kobo.com/tw/zh/ebook/aaa?sId=1"><img src="x.jpg"></a></div>
    <div class="content-block"><h3>10/9 週五 Kobo99選書:<a href="https://www.kobo.com/hk/zh/ebook/bbb">《乙》</a></h3></div>
    <p><a href="https://example.com/ebook/zzz">外站</a></p>
    <div class="content-block"><h3>其他推薦</h3></div>
    <div class="book-block"><a href="https://www.kobo.com/tw/zh/ebook/not-a-deal">別的書</a></div>
  </article>`;
  const rows = parseKoboHtml(html, articleUrl, 2026);
  assert.equal(rows.length, 2);
  assert.match(rows[0].url, /\/tw\/zh\/ebook\/aaa/);
  assert.equal(rows[1].url, 'https://www.kobo.com/hk/zh/ebook/bbb');
});

test('diagnostic meta keeps comma separators in date lists', () => {
  const lines = [];
  logSnapshotMeta({ warn: m => lines.push(m) }, 41, 'x', { dates: '10/8,10/9' });
  assert.equal(lines[0], 'kobo: W41 x meta dates=10/8,10/9');
});
