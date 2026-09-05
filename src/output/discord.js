import fs from 'node:fs/promises';
import path from 'node:path';
import { formatTwDate, taipeiToday } from '../utils/date.js';

const PLATFORM_COLORS = {
  '讀墨': '🟢',
  'Kobo': '🔴',
  '博客來': '🔵',
  'Pubu': '🟠'
};

const PLATFORM_ORDER = ['讀墨', 'Kobo', '博客來', 'Pubu'];

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

function sourceFooter(rows) {
  const present = Object.keys(countBy(rows, 'platform'));
  const ordered = [
    ...PLATFORM_ORDER.filter(name => present.includes(name)),
    ...present.filter(name => !PLATFORM_ORDER.includes(name)).sort()
  ];
  return `資料來源：${ordered.join(' / ') || '無'}｜自動爬蟲整理`;
}

function trimTitle(title, max = 36) {
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}

function dealLine(row) {
  const price = row.sale_price_twd ? `NT$${row.sale_price_twd}` : '價格未標示';
  const discount = row.discount_pct ? `｜${row.discount_pct}% off` : '';
  const urgency = Number(row.days_left) === 0 ? '｜⚠️ 今天到期' : '';
  return `• **${row.platform}**｜[${trimTitle(row.title)}](${row.canonical_url || row.url})｜${price}${discount}｜到 ${formatTwDate(row.end_date)}${urgency}`;
}

function upcomingDealLine(row) {
  const price = row.sale_price_twd ? `NT$${row.sale_price_twd}` : '價格未標示';
  const discount = row.discount_pct ? `｜${row.discount_pct}% off` : '';
  return `• **${row.platform}**｜[${trimTitle(row.title)}](${row.canonical_url || row.url})｜${formatTwDate(row.start_date)} 開始｜${price}${discount}`;
}

function field(name, rows, fallback = '目前沒有符合條件的項目。', renderer = dealLine) {
  const value = rows.length ? rows.map(renderer).join('\n') : fallback;
  return {
    name,
    value: value.length > 1024 ? `${value.slice(0, 1000)}\n…` : value,
    inline: false
  };
}

function platformNames(rows) {
  const present = [...new Set(rows.map(row => row.platform).filter(Boolean))];
  return [
    ...PLATFORM_ORDER.filter(name => present.includes(name)),
    ...present.filter(name => !PLATFORM_ORDER.includes(name)).sort()
  ];
}

function recommendationSort(a, b) {
  return Number(a.days_left ?? 999999) - Number(b.days_left ?? 999999)
    || Number(b.discount_pct || 0) - Number(a.discount_pct || 0)
    || Number(a.sale_price_twd || 999999) - Number(b.sale_price_twd || 999999)
    || String(a.title).localeCompare(String(b.title), 'zh-Hant');
}

function upcomingSort(a, b) {
  return String(a.start_date).localeCompare(String(b.start_date))
    || Number(b.discount_pct || 0) - Number(a.discount_pct || 0)
    || Number(a.sale_price_twd || 999999) - Number(b.sale_price_twd || 999999)
    || String(a.title).localeCompare(String(b.title), 'zh-Hant');
}

function balancedSelection(rows, sorter, perPlatform = 2, maxTotal = 8) {
  const selected = [];
  for (const platform of platformNames(rows)) {
    const platformRows = rows
      .filter(row => row.platform === platform)
      .sort(sorter)
      .slice(0, perPlatform);
    selected.push(...platformRows);
    if (selected.length >= maxTotal) break;
  }
  return selected.slice(0, maxTotal);
}

function platformBrowseField(rows, active) {
  const activeCounts = countBy(active, 'platform');
  const lines = platformNames(rows).map(platform => {
    const source = rows.find(row => row.platform === platform && row.source_page)?.source_page
      || rows.find(row => row.platform === platform)?.canonical_url
      || rows.find(row => row.platform === platform)?.url;
    const label = `${PLATFORM_COLORS[platform] || '▫️'} ${platform}：${activeCounts[platform] || 0} 本有效`;
    return source ? `• [${label}](${source})` : `• ${label}`;
  });
  return {
    name: '各平台查看更多',
    value: lines.join('\n') || '目前沒有來源資料。',
    inline: false
  };
}

export function buildDiscordPayload(rows) {
  const today = taipeiToday();
  const testMode = process.env.DISCORD_TEST_MODE === '1';
  const active = rows.filter(row => row.status === '進行中');
  const upcoming = rows.filter(row => row.status === '即將開始');
  const ended = rows.filter(row => row.status === '已結束');
  const featured = balancedSelection(active, recommendationSort);
  const upcomingFeatured = balancedSelection(upcoming, upcomingSort);

  const activePlatformCounts = countBy(active, 'platform');
  const categoryCounts = Object.entries(countBy(active, 'category'))
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
          `本次抓取 **${rows.length}** 筆；目前有效 **${active.length}**、即將開始 **${upcoming.length}**、已結束 **${ended.length}**。`,
          `今日有效：${statLine(activePlatformCounts) || '目前沒有有效優惠'}`,
          `有效優惠分類：${categoryCounts || '尚未分類'}`,
          '推薦清單限制每平台最多 2 本，避免單一來源洗版。'
        ].filter(Boolean).join('\n'),
        fields: [
          field('今日有效精選', featured),
          field('即將開始', upcomingFeatured, '目前沒有即將開始的優惠。', upcomingDealLine),
          platformBrowseField(rows, active)
        ],
        footer: {
          text: sourceFooter(rows)
        },
        timestamp: new Date().toISOString()
      }
    ]
  };
}

export async function writeDiscordPayload(rows, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `discord_payload_${taipeiToday()}.json`);
  await fs.writeFile(filePath, JSON.stringify(buildDiscordPayload(rows), null, 2), 'utf8');
  return filePath;
}

function defaultThreadName() {
  const today = taipeiToday();
  const testMode = process.env.DISCORD_TEST_MODE === '1';
  return `${testMode ? '[測試] ' : ''}電子書特價日報 ${today}`;
}

export function buildWebhookUrl(webhookUrl, threadId) {
  const url = new URL(webhookUrl);
  if (threadId) url.searchParams.set('thread_id', threadId);
  url.searchParams.set('wait', 'true');
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
  let message = null;
  try {
    message = body ? JSON.parse(body) : null;
  } catch {
    message = null;
  }
  return { ok: response.ok, status: response.status, body, message };
}

export async function postDiscord(payload, webhookUrl) {
  const threadId = process.env.DISCORD_THREAD_ID || '';
  const threadName = process.env.DISCORD_THREAD_NAME || '';

  const initialPayload = { ...payload };
  if (!threadId && threadName) {
    initialPayload.thread_name = threadName;
  }

  let result = await sendDiscord(webhookUrl, initialPayload, threadId);
  if (result.ok) return result.message || {};

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
      if (result.ok) return result.message || {};
    }
  }

  throw new Error(`Discord webhook failed: HTTP ${result.status} ${result.body}`);
}
