import { SOURCES } from '../../config/sources.js';
import { numberFromText, stripTracking } from '../utils/text.js';

const CONFIG = SOURCES.readmoo;

function extractSchedules(html) {
  const markerIndex = html.indexOf('schedules:');
  if (markerIndex < 0) return [];

  const start = html.indexOf('[', markerIndex);
  if (start < 0) return [];

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(html.slice(start, index + 1));
      }
    }
  }

  return [];
}

export function parseReadmooHtml(html) {
  return extractSchedules(String(html || ''))
    .filter((row) => row?.date && row?.book?.title && row?.book?.store_url)
    .map((row) => ({
      platform: CONFIG.platform,
      campaignType: '每日特惠',
      title: row.book.title,
      originalPrice: numberFromText(row.book.ref_price || row.book.list_price),
      salePrice: numberFromText(row.promo_price),
      startDate: row.date,
      endDate: row.date,
      url: stripTracking(row.book.store_url),
      coverUrl: row.book.cover_url || '',
      sourcePage: CONFIG.sourcePage,
      fetchMethod: CONFIG.method,
      confidence: row.promo_price ? 'high' : 'medium'
    }));
}

export async function fetchReadmooDeals() {
  const response = await fetch(CONFIG.sourcePage, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7',
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36'
    },
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) {
    throw new Error(`Readmoo HTTP ${response.status}`);
  }

  const deals = parseReadmooHtml(await response.text());
  if (!deals.length) {
    throw new Error('Readmoo schedules payload was missing or empty');
  }
  return deals;
}
