import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReadmooHtml } from '../src/sources/readmoo.js';

test('parses the official embedded Readmoo schedules payload', () => {
  const schedules = [{
    date: '2026-09-02',
    promo_price: 99,
    book: {
      title: '測試讀墨電子書',
      ref_price: '400.00',
      list_price: '280.00',
      store_url: 'https://readmoo.com/book/210000000000101?utm_source=test',
      cover_url: 'https://cdn.readmoo.com/cover/test.jpg',
      contributors: [{ name: '測試作者' }]
    }
  }];
  const html = `<script>window.specialOffer = { schedules: ${JSON.stringify(schedules)}, next: true };</script>`;

  const rows = parseReadmooHtml(html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, '測試讀墨電子書');
  assert.equal(rows[0].salePrice, 99);
  assert.equal(rows[0].originalPrice, 400);
  assert.equal(rows[0].startDate, '2026-09-02');
  assert.equal(rows[0].url, 'https://readmoo.com/book/210000000000101');
  assert.equal(rows[0].fetchMethod, 'http+embedded-json');
});

test('returns no rows when the official schedules payload is absent', () => {
  assert.deepEqual(parseReadmooHtml('<html></html>'), []);
});
