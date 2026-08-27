import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadLocalKoboDeals } from '../src/sources/kobo.js';

test('loads only the requested week from validated Kobo JSONL', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kobo-jsonl-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'books.jsonl');
  const rows = [
    {
      year: 2026,
      week: 35,
      date: '2026-08-27',
      title: '《測試書》',
      author: '作者',
      source_url: 'https://www.kobo.com/zh/blog/weekly-dd99-2026-w35/',
      tw_url: 'https://www.kobo.com/tw/zh/ebook/example?utm_source=test'
    },
    {
      year: 2026,
      week: 34,
      date: '2026-08-20',
      title: '《舊書》',
      tw_url: 'https://www.kobo.com/tw/zh/ebook/old'
    }
  ];
  await fs.writeFile(file, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);

  const deals = await loadLocalKoboDeals(2026, 35, file);
  assert.equal(deals.length, 1);
  assert.equal(deals[0].title, '測試書');
  assert.equal(deals[0].fetchMethod, 'local-validated-jsonl');
  assert.equal(deals[0].startDate, '2026-08-27');
});
