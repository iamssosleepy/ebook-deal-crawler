import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cleanText, stripTracking } from '../utils/text.js';
import { campaignWeek, validateKoboCampaign } from './koboValidation.js';

// Fallback snapshot: parse a checked-in file or one JSON GET from a secondary public source.
// Rows cite the official Kobo article. This module never calls a refresh endpoint and never
// puts a URL or response body on an error.
const MAX_BYTES = 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 AppleWebKit like Gecko Chrome/124 Safari/537.36';

export const SNAPSHOT_PATH = fileURLToPath(new URL('../../data/kobo-snapshot.json', import.meta.url));

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function articleUrl(year, week) {
  return `https://www.kobo.com/zh/blog/weekly-dd99-${year}-w${week}/`;
}

function sanitizeCoverUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return '';
    const host = parsed.hostname.toLowerCase();
    if (host === 'kobo.com' || host.endsWith('.kobo.com') ||
        host === 'kobo-blog.transforms.svdcdn.com' || host.endsWith('.kobocdn.com')) {
      return url;
    }
  } catch {
    return '';
  }
  return '';
}

export function parseKoboSnapshot(data, now = new Date()) {
  const { year, week } = campaignWeek(now);
  const source = data?.kobo;
  const fetched = typeof source?.fetchedAt === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(source.fetchedAt)
    ? Date.parse(source.fetchedAt) : NaN;
  if (source?.success !== true || source.platform !== 'kobo' ||
      source.source !== `Kobo Blog weekly-dd99-${year}-w${week}` ||
      !Number.isFinite(fetched) || fetched > now.getTime() + 300000 ||
      now.getTime() - fetched > 8 * 86400000 ||
      !Array.isArray(source.deals) || source.deals.length > 100) {
    fail('KOBO_SNAPSHOT_INVALID');
  }
  const rows = source.deals.map(book => {
    if (book?.platform !== 'kobo' || book.dealPrice !== 99 ||
        typeof book.title !== 'string' || typeof book.bookUrl !== 'string') {
      fail('KOBO_SNAPSHOT_INVALID_ROW');
    }
    return {
      platform: 'Kobo', campaignType: '每日99書單', title: cleanText(book.title),
      author: typeof book.author === 'string' ? cleanText(book.author) : '', publisher: '',
      originalPrice: Number.isFinite(book.originalPrice) && book.originalPrice > 0 ? book.originalPrice : '',
      salePrice: book.dealPrice, startDate: book.date, endDate: book.date,
      url: stripTracking(book.bookUrl), coverUrl: sanitizeCoverUrl(book.coverUrl),
      sourcePage: articleUrl(year, week),
      sourceFetchedAt: source.fetchedAt,
      fetchMethod: 'kobo-fallback', confidence: 'medium'
    };
  });
  return validateKoboCampaign(rows, year, week);
}

export async function loadKoboSnapshot(now = new Date(), filePath = SNAPSHOT_PATH) {
  let text;
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_BYTES) fail('KOBO_SNAPSHOT_TOO_LARGE');
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'KOBO_SNAPSHOT_TOO_LARGE') throw error;
    fail('KOBO_SNAPSHOT_INVALID');
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail('KOBO_SNAPSHOT_INVALID');
  }
  return parseKoboSnapshot(data, now);
}

function headerValue(response, name) {
  const headers = response?.headers;
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] ?? null;
}

export async function fetchKoboFallbackApi(now = new Date(), { url, fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  if (url === 'off') fail('KOBO_FALLBACK_DISABLED');
  if (typeof url !== 'string' || url === '') fail('KOBO_FALLBACK_FAILED');
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': USER_AGENT
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    fail('KOBO_FALLBACK_FAILED');
  }
  if (!response || response.status !== 200) fail('KOBO_FALLBACK_FAILED');
  const declared = Number(headerValue(response, 'content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) fail('KOBO_FALLBACK_FAILED');
  let text;
  try {
    text = await response.text();
  } catch {
    fail('KOBO_FALLBACK_FAILED');
  }
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) fail('KOBO_FALLBACK_FAILED');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail('KOBO_FALLBACK_FAILED');
  }
  return parseKoboSnapshot(data, now);
}
