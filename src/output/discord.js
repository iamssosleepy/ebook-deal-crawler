import fs from 'node:fs/promises';
import path from 'node:path';
import { formatTwDate, taipeiToday } from '../utils/date.js';

const PLATFORM_COLORS = {
  '讀墨': '🟢',
  'Kobo': '🔴',
  '博客來': '🔵',
  'Pubu': '🟠'
};

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || '未分類';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function statLine(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${PLATFORM_COLORS[key] || '▫️'} ${key} ${value}`)
    .join('　');
}

function trimTitle(title, max = 36) {
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}

function dealLine(row) {
  const price = row.sale_price_twd ? `NT$${row.sale_price_twd}` : '價格未標示';
  const discount = row.discount_pct ? `｜${row.discount_pct}% off` : '';
  return `• **${row.platform}**｜[${trimTitle(row.title)}](${row.canonical_url || row.url})｜${price}${discount}｜到 ${formatTwDate(row.end_date)}`;
}

function field(name, rows, fallback = '目前沒有符合條件的項目。') {
  const value = rows.length ? rows.map(dealLine).join('\n') : fallback;
  return {
    name,
    value: value.length > 1024 ? `${value.slice(0, 1000)}\n…` : value,
    inline: false
  };
}

export function buildDiscordPayload(rows) {
  const today = taipeiToday();
  const testMode = process.env.DISCORD_TEST_MODE === '1';
  const active = rows.filter(row => row.status === '進行中');
  const todayEnding = active.filter(row => Number(row.days_left) === 0).slice(0, 8);
  const startingToday = rows.filter(row => row.start_date === today).slice(0, 8);
  const lowPrice = active
    .slice()
    .sort((a, b) => Number(a.sale_price_twd || 999999) - Number(b.sale_price_twd || 999999))
    .slice(0, 8);
  const bestDiscount = active
    .filter(row => Number(row.discount_pct) > 0)
    .sort((a, b) => Number(b.discount_pct) - Number(a.discount_pct))
    .slice(0, 8);

  const platformCounts = countBy(rows, 'platform');
  const categoryCounts = Object.entries(countBy(rows, 'category'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => `${name} ${count}`)
    .join('、');

  return {
    username: '電子書特價日報',
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `${testMode ? '[TEST] ' : ''}電子書特價日報｜${today}`,
        url: process.env.REPORT_URL || 'https://github.com/',
        color: 0x00ff87,
        description: [
          testMode ? '**測試推播，不代表正式資料。**' : '',
          `今日共整理 **${rows.length}** 筆限時電子書優惠，進行中 **${active.length}** 筆。`,
          statLine(platformCounts),
          `主要分類：${categoryCounts || '尚未分類'}`
        ].filter(Boolean).join('\n'),
        fields: [
          field('今天開始', startingToday),
          field('今天到期，先看這些', todayEnding),
          field('低價優先', lowPrice),
          field('折扣率較高', bestDiscount)
        ],
        footer: {
          text: '資料來源：Readmoo / Kobo / 博客來 / Pubu｜自動爬蟲整理'
        },
        timestamp: new Date().toISOString()
      }
    ]
  };
}

export async function writeDiscordPayload(rows, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `discord_payload_${new Date().toISOString().slice(0, 10)}.json`);
  await fs.writeFile(filePath, JSON.stringify(buildDiscordPayload(rows), null, 2), 'utf8');
  return filePath;
}

function defaultThreadName() {
  const today = taipeiToday();
  const testMode = process.env.DISCORD_TEST_MODE === '1';
  return `${testMode ? '[測試] ' : ''}電子書特價日報 ${today}`;
}

function buildWebhookUrl(webhookUrl, threadId) {
  if (!threadId) return webhookUrl;
  const url = new URL(webhookUrl);
  url.searchParams.set('thread_id', threadId);
  return url.toString();
}

async function sendDiscord(webhookUrl, payload, threadId) {
  const url = buildWebhookUrl(webhookUrl, threadId);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
}

export async function postDiscord(payload, webhookUrl) {
  const threadId = process.env.DISCORD_THREAD_ID || '';
  const threadName = process.env.DISCORD_THREAD_NAME || '';

  const initialPayload = { ...payload };
  if (!threadId && threadName) {
    initialPayload.thread_name = threadName;
  }

  let result = await sendDiscord(webhookUrl, initialPayload, threadId);
  if (result.ok) return;

  if (result.status === 400 && !threadId && !initialPayload.thread_name) {
    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }
    if (parsed && parsed.code === 220001) {
      const retryPayload = { ...payload, thread_name: defaultThreadName() };
      result = await sendDiscord(webhookUrl, retryPayload, '');
      if (result.ok) return;
    }
  }

  throw new Error(`Discord webhook failed: HTTP ${result.status} ${result.body}`);
}
