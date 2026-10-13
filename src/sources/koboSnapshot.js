import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cleanText, stripTracking } from '../utils/text.js';
import { campaignDates, campaignWeek, isKoboBook, validateKoboCampaign } from './koboValidation.js';

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

// Diagnostics only: never a URL, title or body. Values are reduced to a safe charset and capped.
function safeMeta(value) {
  if (typeof value !== 'string') return value === undefined ? 'missing' : typeof value;
  if (/:\/\//.test(value)) return 'url-redacted';
  return value.replace(/[^A-Za-z0-9._:+/-]/g, '?').slice(0, 48);
}

export function logSnapshotMeta(logger, week, label, meta) {
  if (typeof logger?.warn !== 'function') return;
  try {
    const parts = Object.entries(meta).map(([key, value]) => `${key}=${safeMeta(value)}`);
    logger.warn(`kobo: W${week} ${label} meta ${parts.join(' ')}`);
  } catch { /* diagnostics must never break the crawl */ }
}

function dealDates(deals) {
  if (!Array.isArray(deals)) return 'n/a';
  return [...new Set(deals.map(d => (typeof d?.date === 'string' ? d.date : '?')))]
    .slice(0, 10).map(safeMeta).join(',');
}

export function parseKoboSnapshot(data, now = new Date(), { logger } = {}) {
  const { year, week } = campaignWeek(now);
  const source = data?.kobo;
  logSnapshotMeta(logger, week, 'snapshot', {
    source: source?.source, fetchedAt: source?.fetchedAt, updatedAt: source?.updatedAt,
    success: String(source?.success === true),
    deals: Array.isArray(source?.deals) ? String(source.deals.length) : 'n/a',
    dates: dealDates(source?.deals)
  });
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

export async function loadKoboSnapshot(now = new Date(), filePath = SNAPSHOT_PATH, { logger } = {}) {
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
  return parseKoboSnapshot(data, now, { logger });
}

function headerValue(response, name) {
  const headers = response?.headers;
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] ?? null;
}

export async function fetchKoboFallbackApi(now = new Date(), { url, fetchImpl = fetch, timeoutMs = 20000, logger } = {}) {
  if (url === 'off') fail('KOBO_FALLBACK_DISABLED');
  const data = await fetchJson(url, { fetchImpl, timeoutMs, code: 'KOBO_FALLBACK_FAILED' });
  return parseKoboSnapshot(data, now, { logger });
}

async function fetchJson(url, { fetchImpl = fetch, timeoutMs = 20000, code }) {
  if (typeof url !== 'string' || url === '') fail(code);
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
    fail(code);
  }
  if (!response || response.status !== 200) fail(code);
  const declared = Number(headerValue(response, 'content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) fail(code);
  let text;
  try {
    text = await response.text();
  } catch {
    fail(code);
  }
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) fail(code);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail(code);
  }
  return data;
}

// Third-party weekly list (no LICENSE upstream). Rows cite the official Kobo article and are
// re-validated with the same rules as every other stage.
export const KOBO99_TRACKER_URL = 'https://raw.githubusercontent.com/kobo99tw/kobo99-tracker/main/docs/data/latest.json';
const MAX_AGE = 8 * 86400000;

function ntd(value) {
  if (typeof value === 'number') return value;
  const match = typeof value === 'string' && value.trim().match(/^(?:NT\$)?\s*([\d,]+)$/i);
  return match ? Number(match[1].replace(/,/g, '')) : NaN;
}

// The tracker's links carry blog session/campaign ids (sId, ssId, cPos, utm_*); keep only the book path.
function bookUrlWithoutQuery(value) {
  if (typeof value !== 'string') return '';
  try {
    const parsed = new URL(stripTracking(value));
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function isoDate(value, year) {
  if (typeof value !== 'string') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return '';
  return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

export function parseKobo99Tracker(data, now = new Date(), { logger } = {}) {
  const { year, week } = campaignWeek(now);
  const updated = typeof data?.updated_at === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(data.updated_at)
    ? Date.parse(data.updated_at) : NaN;
  logSnapshotMeta(logger, week, 'kobo99-tracker', {
    week: `${data?.year}-w${data?.week}`, updatedAt: data?.updated_at,
    saleStart: data?.sale_start, saleEnd: data?.sale_end,
    books: Array.isArray(data?.books) ? String(data.books.length) : 'n/a', dates: dealDates(data?.books)
  });
  const dates = campaignDates(year, week);
  if (data?.year !== year || data?.week !== week ||
      !Number.isFinite(updated) || updated > now.getTime() + 300000 || now.getTime() - updated > MAX_AGE ||
      typeof data.sale_start !== 'string' || typeof data.sale_end !== 'string' ||
      !dates.includes(data.sale_start) || !dates.includes(data.sale_end) || data.sale_start > data.sale_end ||
      !Array.isArray(data.books) || !data.books.length || data.books.length > 100) {
    fail('KOBO_SNAPSHOT_INVALID');
  }
  const rows = data.books.map(book => {
    const date = isoDate(book?.date, year);
    const url = bookUrlWithoutQuery(book?.kobo_url);
    const original = ntd(book?.kobo_price);
    if (typeof book?.title !== 'string' || !book.title.trim() || ntd(book.sale_price) !== 99 ||
        !date || date < data.sale_start || date > data.sale_end || !isKoboBook(url)) {
      fail('KOBO_SNAPSHOT_INVALID_ROW');
    }
    return {
      platform: 'Kobo', campaignType: '每日99書單', title: cleanText(book.title),
      author: typeof book.author === 'string' ? cleanText(book.author) : '',
      publisher: typeof book.publisher === 'string' ? cleanText(book.publisher) : '',
      originalPrice: Number.isFinite(original) && original > 99 ? original : '',
      salePrice: 99, startDate: date, endDate: date, url, coverUrl: '',
      sourcePage: articleUrl(year, week), sourceFetchedAt: data.updated_at,
      fetchMethod: 'kobo99-tracker', confidence: 'medium'
    };
  });
  return validateKoboCampaign(rows, year, week);
}

export async function fetchKobo99Tracker(now = new Date(), { url = KOBO99_TRACKER_URL, fetchImpl = fetch, timeoutMs = 20000, logger } = {}) {
  const data = await fetchJson(url, { fetchImpl, timeoutMs, code: 'KOBO_TRACKER_FAILED' });
  return parseKobo99Tracker(data, now, { logger });
}
