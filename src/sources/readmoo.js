import { chromium } from 'playwright';
import { SOURCES } from '../../config/sources.js';
import { isoDateFromTaiwanMonthDay, taipeiToday } from '../utils/date.js';
import { cleanText, numberFromText, stripTracking } from '../utils/text.js';

const CONFIG = SOURCES.readmoo;

function parseDateFromText(text) {
  return isoDateFromTaiwanMonthDay(text);
}

function parsePriceFromText(text) {
  const saleMatch = text.match(/(?:特惠售價|優惠價|NT\$)\s*\$?\s*([0-9,]+)/i);
  if (saleMatch) return numberFromText(saleMatch[1]);
  return '';
}

export async function fetchReadmooDeals() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei'
  });

  try {
    await page.goto(CONFIG.sourcePage, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => {
      return [...document.querySelectorAll('a[href*="/book/"]')]
        .some(anchor => /\/book\/\d+/.test(anchor.href));
    }, { timeout: 30000 });

    const raw = await page.$$eval('a[href*="/book/"]', anchors => {
      const rows = [];
      const seen = new Set();
      for (const anchor of anchors) {
        const href = anchor.href;
        if (!href || !/\/book\/\d+/.test(href) || seen.has(href)) continue;
        seen.add(href);
        const card = anchor.closest('li, article, .book, .item, .card, section, div') || anchor.parentElement;
        const text = (card?.innerText || anchor.innerText || '').replace(/\s+/g, ' ').trim();
        const img = card?.querySelector('img') || anchor.querySelector('img');
        rows.push({
          href,
          text,
          anchorText: (anchor.innerText || '').replace(/\s+/g, ' ').trim(),
          coverUrl: img?.src || img?.getAttribute('data-src') || ''
        });
      }
      return rows;
    });

    const today = taipeiToday();
    const deals = [];
    for (const item of raw) {
      const text = cleanText(item.text);
      if (!text || /推薦|電子書售價/.test(text) && !/特惠|優惠|一日|週限定|NT\$\s*99|NT\$\s*149|NT\$\s*199/.test(text)) {
        continue;
      }

      const title = cleanText(item.anchorText || text.split(' NT$')[0]).replace(/^加入行事曆|^前往購買/, '');
      if (!title || title.length < 2) continue;

      const date = parseDateFromText(text) || today;
      const salePrice = parsePriceFromText(text) || numberFromText((text.match(/NT\$\s*[0-9,]+/) || [''])[0]);
      const originalPrice = numberFromText((text.match(/(?:定價|原價|電子書定價)\s*NT\$?\s*([0-9,]+)/) || [])[1]);

      deals.push({
        platform: CONFIG.platform,
        campaignType: date === today ? '今日特惠' : '本週限定預告',
        title,
        originalPrice,
        salePrice,
        startDate: date,
        endDate: date,
        url: stripTracking(item.href),
        coverUrl: item.coverUrl,
        sourcePage: CONFIG.sourcePage,
        fetchMethod: CONFIG.method,
        confidence: salePrice ? 'medium' : 'low'
      });
    }

    return deals;
  } finally {
    await browser.close();
  }
}
