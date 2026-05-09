import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { SOURCES } from '../../config/sources.js';
import { fetchHtml } from '../utils/http.js';
import { absoluteUrl, cleanText, stripTracking } from '../utils/text.js';
import { isoDateFromTaiwanMonthDay } from '../utils/date.js';

const CONFIG = SOURCES.kobo;

async function fetchKoboHtml(url) {
  try {
    return await fetchHtml(url);
  } catch (error) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei'
    });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2500);
      return await page.content();
    } finally {
      await browser.close();
    }
  }
}

function isoWeek(date = new Date()) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return { year: utc.getUTCFullYear(), week };
}

function extractTitleFromHeading(text) {
  const match = text.match(/《([^》]+)》/);
  return match ? cleanText(match[1]) : '';
}

async function findLatestWeeklyUrl() {
  const html = await fetchKoboHtml(CONFIG.tagPage);
  const $ = cheerio.load(html);
  const candidates = [];
  $('a[href*="weekly-dd99"]').each((_, node) => {
    const href = absoluteUrl($(node).attr('href'), CONFIG.tagPage);
    const text = cleanText($(node).text());
    if (href && text) candidates.push({ href, text });
  });

  if (!candidates.length) {
    const { year, week } = isoWeek();
    return `https://www.kobo.com/zh/blog/weekly-dd99-${year}-w${week}`;
  }
  return candidates[0].href;
}

export async function fetchKoboDeals() {
  const articleUrl = await findLatestWeeklyUrl();
  const html = await fetchKoboHtml(articleUrl);
  const $ = cheerio.load(html);
  const deals = [];

  $('h2, h3').each((_, heading) => {
    const headingText = cleanText($(heading).text());
    if (!/Kobo99選書/.test(headingText)) return;

    const title = extractTitleFromHeading(headingText);
    const startDate = isoDateFromTaiwanMonthDay(headingText);
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
      node.find('a[href]').each((_, link) => {
        const label = cleanText($(link).text());
        const href = absoluteUrl($(link).attr('href'), articleUrl);
        if (/查看電子書/.test(label) && /\/ebook\//.test(href)) {
          if (/HK/.test(label)) hkUrl = href;
          else twUrl = href;
        }
      });
      const img = node.find('img').first();
      if (img.length && !coverUrl) {
        coverUrl = absoluteUrl(img.attr('src') || img.attr('data-src'), articleUrl);
      }
    }

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
