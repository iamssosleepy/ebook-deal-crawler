import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildDiscordPayload, buildWebhookUrl, writeDiscordPayload } from '../src/output/discord.js';
import { taipeiToday } from '../src/utils/date.js';

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

test('webhook requests a receipt without dropping a forum thread id', () => {
  const url = new URL(buildWebhookUrl('https://discord.com/api/webhooks/1/example', 'thread-123'));
  assert.equal(url.searchParams.get('thread_id'), 'thread-123');
  assert.equal(url.searchParams.get('wait'), 'true');
});

test('digest separates status counts and limits recommendations per platform', () => {
  process.env.DISCORD_TEST_MODE = '0';
  const activePubu = Array.from({ length: 4 }, (_, index) => ({
    platform: 'Pubu',
    title: `Pubu ${index + 1}`,
    sale_price_twd: 99,
    discount_pct: 70 - index,
    status: '進行中',
    start_date: taipeiToday(),
    end_date: taipeiToday(),
    days_left: 0,
    canonical_url: `https://example.com/pubu-${index + 1}`,
    source_page: 'https://example.com/pubu',
    category: '其他'
  }));
  const rows = [
    ...activePubu,
    {
      platform: 'Kobo',
      title: 'Kobo active',
      sale_price_twd: 66,
      status: '進行中',
      start_date: taipeiToday(),
      end_date: taipeiToday(),
      days_left: 0,
      canonical_url: 'https://example.com/kobo-active',
      source_page: 'https://example.com/kobo',
      category: '小說文學'
    },
    {
      platform: '讀墨',
      title: 'Readmoo upcoming',
      sale_price_twd: 99,
      status: '即將開始',
      start_date: '2099-01-01',
      end_date: '2099-01-02',
      days_left: 999,
      canonical_url: 'https://example.com/readmoo-upcoming',
      source_page: 'https://example.com/readmoo',
      category: '心理成長'
    },
    {
      platform: '博客來',
      title: 'Books ended',
      sale_price_twd: 99,
      status: '已結束',
      start_date: '2020-01-01',
      end_date: '2020-01-02',
      days_left: -1,
      canonical_url: 'https://example.com/books-ended',
      source_page: 'https://example.com/books',
      category: '其他'
    }
  ];

  const embed = buildDiscordPayload(rows).embeds[0];
  assert.match(embed.description, /目前有效 \*\*5\*\*、即將開始 \*\*1\*\*、已結束 \*\*1\*\*/);
  const featured = embed.fields.find(item => item.name === '今日有效精選');
  assert.equal((featured.value.match(/\*\*Pubu\*\*/g) || []).length, 2);
  assert.match(featured.value, /Kobo active/);
  assert.doesNotMatch(featured.value, /Books ended|Readmoo upcoming/);
  const upcoming = embed.fields.find(item => item.name === '即將開始');
  assert.match(upcoming.value, /Readmoo upcoming/);
  const browse = embed.fields.find(item => item.name === '各平台查看更多');
  assert.match(browse.value, /Pubu：4 本有效/);
  assert.match(browse.value, /博客來：0 本有效/);
});

test('Discord payload filename uses the Taipei calendar date', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ebook-discord-date-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = await writeDiscordPayload([], directory);
  assert.equal(path.basename(filePath), `discord_payload_${taipeiToday()}.json`);
});
