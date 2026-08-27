import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscordPayload } from '../src/output/discord.js';

test('footer lists only sources present in the report', () => {
  process.env.DISCORD_TEST_MODE = '1';
  const rows = [
    {
      platform: 'Kobo',
      title: '測試書',
      sale_price_twd: 99,
      status: '進行中',
      start_date: '2026-08-27',
      end_date: '2026-08-28',
      days_left: 1,
      canonical_url: 'https://example.com/kobo',
      category: '文學小說'
    },
    {
      platform: 'Pubu',
      title: '另一冊',
      sale_price_twd: 66,
      status: '進行中',
      start_date: '2026-08-27',
      end_date: '2026-08-27',
      days_left: 0,
      canonical_url: 'https://example.com/pubu',
      category: '商業理財'
    }
  ];

  const payload = buildDiscordPayload(rows);
  assert.match(payload.embeds[0].title, /^\[TEST\]/);
  assert.equal(payload.embeds[0].footer.text, '資料來源：Kobo / Pubu｜自動爬蟲整理');
  assert.doesNotMatch(payload.embeds[0].footer.text, /博客來/);
});
