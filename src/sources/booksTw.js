import * as cheerio from 'cheerio';
import { SOURCES } from '../../config/sources.js';
import { fetchHtml } from '../utils/http.js';
import { absoluteUrl, cleanText, numberFromText, stripTracking } from '../utils/text.js';
import { isoDateFromTaiwanMonthDay, taipeiToday } from '../utils/date.js';
import { fetchOfficialMarkdown } from '../utils/proxy.js';

const CONFIG = SOURCES.booksTw;

function parseCalendarLinks($) {
  const rows = [];
  $('a[href*="google.com/calendar/render"]').each((_, node) => {
    try {
      const href = $(node).attr('href');
      const url = new URL(href);
      const text = cleanText(decodeURIComponent(url.searchParams.get('text') || ''));
      const detailsRaw = decodeURIComponent(url.searchParams.get('details') || '');
      const details = cleanText(detailsRaw);
      const dates = cleanText(url.searchParams.get('dates') || '');
      const productUrl = (details.match(/https:\/\/www\.books\.com\.tw\/products\/E[0-9A-Z]+/) || [''])[0];
      const price = numberFromText(text.match(/NT\$?\s*([0-9]+)/)?.[1] || text);
      const startDate = dates ? `${dates.slice(0, 4)}-${dates.slice(4, 6)}-${dates.slice(6, 8)}` : '';
      const endRaw = dates.includes('/') ? dates.split('/')[1] : '';
      const endDate = endRaw ? `${endRaw.slice(0, 4)}-${endRaw.slice(4, 6)}-${endRaw.slice(6, 8)}` : startDate;
      const detailLines = detailsRaw.split(/\r?\n/).map(cleanText).filter(Boolean);
      const title = detailLines.find(line => !/^商品連結：?https?:\/\//.test(line))
        || text.replace(/^.*?元[-－]/, '').replace(/\s*NT\$?.*$/, '');
      if (productUrl) rows.push({ title, productUrl, price, startDate, endDate });
    } catch {
      // Ignore malformed calendar links.
    }
  });
  return rows;
}

export async function fetchBooksTwDeals() {
  let html;
  try {
    html = await fetchHtml(CONFIG.sourcePage);
  } catch {
    const markdown = await fetchOfficialMarkdown(CONFIG.sourcePage);
    return parseBooksMarkdown(markdown);
  }
  const $ = cheerio.load(html);
  const today = taipeiToday();
  const byUrl = new Map();

  for (const row of parseCalendarLinks($)) {
    byUrl.set(stripTracking(row.productUrl), {
      platform: CONFIG.platform,
      campaignType: '每日e書99',
      title: row.title,
      salePrice: row.price || '',
      startDate: row.startDate || today,
      endDate: row.endDate || row.startDate || today,
      url: stripTracking(row.productUrl),
      sourcePage: CONFIG.sourcePage,
      fetchMethod: CONFIG.method,
      confidence: 'high'
    });
  }

  $('a[href*="/products/E"]').each((_, node) => {
    const href = stripTracking(absoluteUrl($(node).attr('href'), CONFIG.sourcePage));
    const card = $(node).closest('li, .mod, .item, .box, div');
    const text = cleanText(card.text() || $(node).text());
    const img = card.find('img').first();
    const coverUrl = absoluteUrl(img.attr('src') || img.attr('data-src'), CONFIG.sourcePage);
    const title = cleanText($(node).attr('title') || $(node).text() || text.split('作者')[0]);
    const prices = [...text.matchAll(/\$?\s*([0-9]{2,5})/g)].map(match => Number(match[1]));
    const originalPrice = prices.length > 1 ? prices[0] : '';
    const salePrice = prices.length ? prices[prices.length - 1] : '';
    const dateText = text.match(/(\d{1,2}\/\d{1,2})/)?.[1] || '';
    const startDate = isoDateFromTaiwanMonthDay(dateText) || today;

    if (!href || !title || !/E\d+/.test(href)) return;
    const existing = byUrl.get(href) || {};
    const existingTitleLooksLikeCalendar = /加入行事曆|\d{1,2}\/\d{1,2}/.test(existing.title || '');
    byUrl.set(href, {
      platform: CONFIG.platform,
      campaignType: existing.campaignType || '活動頁電子書',
      title: !existing.title || existingTitleLooksLikeCalendar ? title : existing.title,
      author: cleanText(text.match(/作者[:：]?\s*([^$優惠價]+)/)?.[1] || ''),
      originalPrice: existing.originalPrice || originalPrice,
      salePrice: existing.salePrice || salePrice,
      startDate: existing.startDate || startDate,
      endDate: existing.endDate || startDate,
      url: href,
      coverUrl,
      sourcePage: CONFIG.sourcePage,
      fetchMethod: CONFIG.method,
      confidence: existing.confidence || 'medium'
    });
  });

  return [...byUrl.values()].filter(row => [66, 99].includes(Number(row.salePrice)));
}

function parseBooksMarkdown(markdown) {
  const rows = [];
  const calendarLinks = [...markdown.matchAll(/\[加入行事曆]\((https:\/\/www\.google\.com\/calendar\/render\?[^)]+)\)/g)];
  for (const match of calendarLinks) {
    try {
      const calendar = new URL(match[1].replaceAll('&amp;', '&'));
      const text = cleanText(calendar.searchParams.get('text') || '');
      const details = decodeURIComponent(calendar.searchParams.get('details') || '');
      const dates = calendar.searchParams.get('dates') || '';
      const productUrl = (details.match(/https:\/\/www\.books\.com\.tw\/products\/E[0-9A-Z]+/) || [''])[0];
      const title = cleanText(details.split('\n').slice(1).join(' ')) || text.replace(/^.*?元[-－]/, '');
      const price = numberFromText((text.match(/(?:66|99)元/) || [''])[0]);
      const [startRaw = '', endRaw = ''] = dates.split('/');
      const startDate = startRaw ? `${startRaw.slice(0, 4)}-${startRaw.slice(4, 6)}-${startRaw.slice(6, 8)}` : '';
      const endDate = endRaw ? `${endRaw.slice(0, 4)}-${endRaw.slice(4, 6)}-${endRaw.slice(6, 8)}` : startDate;
      if (!productUrl || ![66, 99].includes(price)) continue;
      rows.push({
        platform: CONFIG.platform,
        campaignType: price === 66 ? '週末e書66' : '每日e書99',
        title,
        salePrice: price,
        startDate,
        endDate,
        url: stripTracking(productUrl),
        sourcePage: CONFIG.sourcePage,
        fetchMethod: 'official-markdown-proxy',
        confidence: 'high'
      });
    } catch {
      // Ignore malformed calendar records.
    }
  }
  return rows;
}
