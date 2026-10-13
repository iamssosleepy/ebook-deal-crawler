import * as cheerio from 'cheerio';
import fs from 'node:fs/promises';
import { openHeaded, withHeadedBrowser } from '../utils/headedBrowser.js';
import { SOURCES } from '../../config/sources.js';
import { fetchHtml } from '../utils/http.js';
import { absoluteUrl, cleanText, stripTracking } from '../utils/text.js';
import { isoDateFromTaiwanMonthDay } from '../utils/date.js';
import { fetchOfficialMarkdown } from '../utils/proxy.js';
import { campaignWeek, campaignDates, isCampaignSource, isKoboBook, validateKoboCampaign } from './koboValidation.js';
import { fetchKobo99Tracker, fetchKoboFallbackApi, loadKoboSnapshot } from './koboSnapshot.js';
import { koboCacheDir, readKoboWeekCache, writeKoboWeekCache } from './koboCache.js';

const CONFIG = SOURCES.kobo;
const DEFAULT_LOCAL_JSONL = '/home/wch/Projects/personal/kobo-weekly-book-list/data/books.jsonl';

async function fetchKoboHtml(url) {
  try {
    return await fetchHtml(url);
  } catch {
    // Headless Chromium is always challenged by Kobo's Cloudflare, so go straight to a headed
    // browser (private Xvfb when there is no display). One page load, no retries here.
    const result = await withHeadedBrowser(browser => openHeaded(browser, url));
    if (result.status !== 200) {
      throw Object.assign(new Error(`KOBO_HTTP_${result.status}`), { code: 'KOBO_READ_FAILED' });
    }
    return result.html;
  }
}

async function fetchKoboMarkdown(url) {
  return fetchOfficialMarkdown(url);
}

function extractTitleFromHeading(text) {
  const match = text.match(/《([^》]+)》/);
  return match ? cleanText(match[1]) : '';
}

export async function loadLocalKoboDeals(year, week, filePath = process.env.KOBO_LOCAL_JSONL || DEFAULT_LOCAL_JSONL) {
  const dates = campaignDates(year, week);
  try {
    const records = (await fs.readFile(filePath, 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(row => row && Number(row.year) === year && Number(row.week) === week)
      .filter(row => dates.includes(row.date) && typeof row.title === 'string' &&
        cleanText(row.title).replace(/^《|》$/g, '').trim() &&
        isCampaignSource(row.source_url, year, week) &&
        (isKoboBook(row.tw_url) || isKoboBook(row.hk_url)));

    return records.map(row => ({
      platform: CONFIG.platform,
      campaignType: '每日99書單',
      title: cleanText(row.title).replace(/^《|》$/g, ''),
      author: row.author || '',
      publisher: row.publisher || '',
      originalPrice: '',
      salePrice: 99,
      startDate: row.date,
      endDate: row.date,
      url: stripTracking(isKoboBook(row.tw_url) ? row.tw_url : row.hk_url),
      coverUrl: '',
      sourcePage: row.source_url,
      fetchMethod: 'local-validated-jsonl',
      confidence: 'high'
    }));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

const STAGE_CODES = new Set([
  'KOBO_EMPTY',
  'KOBO_INVALID_SOURCE',
  'KOBO_INVALID_ROW',
  'KOBO_INCOMPLETE_DATES',
  'KOBO_CACHE_INVALID',
  'KOBO_FALLBACK_FAILED',
  'KOBO_SNAPSHOT_INVALID',
  'KOBO_SNAPSHOT_INVALID_ROW',
  'KOBO_SNAPSHOT_TOO_LARGE',
  'KOBO_FALLBACK_DISABLED',
  'KOBO_TRACKER_FAILED'
]);

function resolveKoboFallbackUrl() {
  const configured = process.env.KOBO_FALLBACK_URL;
  if (typeof configured !== 'string') return null;
  const trimmed = configured.trim();
  if (!trimmed || trimmed === 'off') return null;
  return trimmed;
}

function defaultReadCache({ year, week }) {
  return readKoboWeekCache({ year, week, dir: koboCacheDir() });
}

function defaultWriteCache(payload) {
  return writeKoboWeekCache({ ...payload, dir: koboCacheDir() });
}

async function defaultLoadFallback(now, { logger } = {}) {
  const url = resolveKoboFallbackUrl();
  if (url === null) throw Object.assign(new Error('KOBO_FALLBACK_DISABLED'), { code: 'KOBO_FALLBACK_DISABLED' });
  return fetchKoboFallbackApi(now, { url, logger });
}

export async function fetchKoboDeals({
  now = new Date(),
  fetchMarkdown = fetchKoboMarkdown,
  loadLocal = loadLocalKoboDeals,
  fetchHtml = fetchKoboHtml,
  readCache = defaultReadCache,
  writeCache = defaultWriteCache,
  loadFallback = defaultLoadFallback,
  loadTracker = (n, opts) => fetchKobo99Tracker(n, opts),
  loadSnapshot = (n, opts) => loadKoboSnapshot(n, undefined, opts),
  logger = console
} = {}) {
  const { year, week } = campaignWeek(now);
  const articleUrl = `https://www.kobo.com/zh/blog/weekly-dd99-${year}-w${week}/`;
  const failures = [];
  const stages = [
    ['markdown', async () => parseKoboMarkdown(await fetchMarkdown(articleUrl), articleUrl, year), true],
    ['local', () => loadLocal(year, week), false],
    // Never choose a category page's first (possibly old) campaign.
    ['html', async () => parseKoboHtml(await fetchHtml(articleUrl), articleUrl, year), true],
    ['cache', () => readCache({ year, week }), false],
    ['fallback', () => loadFallback(now, { logger }), false],
    ['kobo99-tracker', () => loadTracker(now, { logger }), false],
    ['fallback-file', () => loadSnapshot(now, { logger }), false]
  ];
  for (const [stage, read, official] of stages) {
    try {
      const deals = validateKoboCampaign(await read(), year, week);
      logger.log(`kobo: W${week} ${stage} validated ${deals.length} rows`);
      if (official) {
        try {
          await writeCache({ year, week, rows: deals, now, stage });
        } catch {
          try { logger.warn(`kobo: W${week} cache KOBO_CACHE_WRITE_FAILED`); } catch { /* keep the official rows */ }
        }
      }
      return deals;
    } catch (error) {
      const code = STAGE_CODES.has(error?.code) ? error.code : 'KOBO_READ_FAILED';
      failures.push({ stage, code });
      // Do not echo remote response bodies, credentials, or untrusted error text.
      logger.warn(`kobo: W${week} ${stage} ${code}`);
    }
  }
  throw Object.assign(new Error(`Kobo ${year}-W${week} unavailable: ${failures.map(item => `${item.stage}=${item.code}`).join(', ')}`), {
    code: 'KOBO_CAMPAIGN_UNAVAILABLE', failures
  });
}

export function parseKoboHtml(html, articleUrl, year = campaignWeek().year) {
  const $ = cheerio.load(html);
  const deals = [];

  // Assign every Kobo book link to the nearest preceding campaign heading in document order.
  // Kobo's markup puts the link inside the heading and in sibling "book-block" containers, and
  // the link text varies (or is empty for cover images), so never depend on the label.
  const linksByHeading = new Map();
  let current = null;
  $('h2, h3, a[href]').each((_, node) => {
    const tag = node.tagName?.toLowerCase();
    if (tag === 'h2' || tag === 'h3') {
      current = /Kobo99選書/.test(cleanText($(node).text())) ? node : null;
      if (current) linksByHeading.set(current, { tw: '', hk: '' });
      return;
    }
    if (!current) return;
    const href = absoluteUrl($(node).attr('href'), articleUrl);
    const slot = linksByHeading.get(current);
    if (!slot.tw && isKoboBook(href) && /^https:\/\/www\.kobo\.com\/tw\/zh\/ebook\//.test(href)) slot.tw = href;
    else if (!slot.hk && isKoboBook(href) && /^https:\/\/www\.kobo\.com\/hk\/zh\/ebook\//.test(href)) slot.hk = href;
  });

  $('h2, h3').each((_, heading) => {
    const headingText = cleanText($(heading).text());
    if (!/Kobo99選書/.test(headingText)) return;

    const title = extractTitleFromHeading(headingText);
    const startDate = isoDateFromTaiwanMonthDay(headingText, year);
    if (!title || !startDate) return;

    const sectionNodes = [];
    let cursor = $(heading).next();
    while (cursor.length && !['h2', 'h3'].includes(cursor[0].tagName?.toLowerCase())) {
      sectionNodes.push(cursor);
      cursor = cursor.next();
    }

    let author = '';
    let publisher = '';
    let twUrl = '';
    let hkUrl = '';
    let coverUrl = '';
    for (const node of sectionNodes) {
      const text = cleanText(node.text());
      const authorMatch = text.match(/由\s*([^出版社]+?)◎?著/);
      if (authorMatch) author = cleanText(authorMatch[1]);
      const publisherMatch = text.match(/出版社[:：]\s*([^\s]+)/);
      if (publisherMatch) publisher = cleanText(publisherMatch[1]);
      const img = node.find('img').first();
      if (img.length && !coverUrl) {
        coverUrl = absoluteUrl(img.attr('src') || img.attr('data-src'), articleUrl);
      }
    }

    ({ tw: twUrl, hk: hkUrl } = linksByHeading.get(heading) || { tw: '', hk: '' });
    deals.push({
      platform: CONFIG.platform,
      campaignType: '每日99書單',
      title,
      author,
      publisher,
      originalPrice: '',
      salePrice: 99,
      startDate,
      endDate: startDate,
      url: stripTracking(twUrl || hkUrl || articleUrl),
      coverUrl,
      sourcePage: articleUrl,
      fetchMethod: CONFIG.method,
      confidence: twUrl ? 'high' : 'medium'
    });
  });

  return deals;
}

export function parseKoboMarkdown(markdown, articleUrl, year = campaignWeek().year) {
  const headings = [...markdown.matchAll(/^### .*?(\d{1,2}\/\d{1,2})\s+週[一二三四五六日]\s+Kobo99選書.*$/gm)];
  const deals = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const block = markdown.slice(heading.index, headings[index + 1]?.index ?? markdown.length);
    const headingText = cleanText(heading[0].replace(/\*\*/g, ''));
    const title = extractTitleFromHeading(headingText);
    const startDate = isoDateFromTaiwanMonthDay(heading[1], year);
    if (!title || !startDate) continue;
    const twUrl = (block.match(/https:\/\/www\.kobo\.com\/tw\/zh\/ebook\/[^)\s]+/) || [''])[0];
    const author = cleanText((block.match(/^## .*?\s*由\s*(.+?)[＠@◎]?著\s*$/m) || [])[1] || '');
    const publisher = cleanText((block.match(/^出版社：\s*(.+?)\s*$/m) || [])[1] || '');
    deals.push({
      platform: CONFIG.platform,
      campaignType: '每日99書單',
      title,
      author,
      publisher,
      originalPrice: '',
      salePrice: 99,
      startDate,
      endDate: startDate,
      url: stripTracking(twUrl || articleUrl),
      coverUrl: '',
      sourcePage: articleUrl,
      fetchMethod: 'official-markdown-proxy',
      confidence: twUrl ? 'high' : 'medium'
    });
  }
  return deals;
}
