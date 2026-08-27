import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBooksMarkdown } from '../src/sources/booksTw.js';

test('parses an official Books calendar record', () => {
  const calendar = new URL('https://www.google.com/calendar/render');
  calendar.searchParams.set('text', '99元-測試電子書');
  calendar.searchParams.set(
    'details',
    '商品連結：https://www.books.com.tw/products/E050000001\n測試電子書'
  );
  calendar.searchParams.set('dates', '20260827/20260828');

  const rows = parseBooksMarkdown(`[加入行事曆](${calendar.toString()})`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, '測試電子書');
  assert.equal(rows[0].salePrice, 99);
  assert.equal(rows[0].startDate, '2026-08-27');
  assert.equal(rows[0].endDate, '2026-08-28');
  assert.equal(rows[0].url, 'https://www.books.com.tw/products/E050000001');
});
