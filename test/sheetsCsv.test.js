import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeSheetsCsv } from '../src/output/sheetsCsv.js';
import { taipeiToday } from '../src/utils/date.js';

test('CSV filename uses the Taipei calendar date', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ebook-csv-date-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = await writeSheetsCsv([], directory);
  assert.equal(path.basename(filePath), `ebook_deals_${taipeiToday()}.csv`);
});
