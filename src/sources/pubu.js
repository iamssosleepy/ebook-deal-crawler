import * as cheerio from 'cheerio';
import { SOURCES } from '../../config/sources.js';
import { fetchHtml } from '../utils/http.js';
import { absoluteUrl, cleanText, numberFromText, stripTracking } from '../utils/text.js';
import { isoDateFromTaiwanMonthDay, taipeiToday } from '../utils/date.js';

const CONFIG = SOURCES.pubu;

function parseCampaignType($, node) {
  const text = cleanText($(node).text());
  const untilMatch = text.match(/[〜~]\s*\d{1,2}\/\d{1,2}\s*限時\s*([0-9]+)/);
  if (untilMatch) return `限時${untilMatch[1]}`;
  const publisherCampaign = text.match(/^(.{0,18}?限時\s*[0-9]+)\s*[~〜]\s*\d{1,2}\/\d{1,2}/);
  if (publisherCampaign) return cleanText(publisherCampaign[1]);
  if (/^\d{1,2}\/\d{1,2}\([^)]+\)/.test(text)) return '一日限時';
  const block = $(node).closest('.js-products-block, .in_sale, .products-div');
  const heading = cleanText(block.find('h2, h3, .title, .products-title').first().text());
  if (heading) return heading;
  return 'Pubu限時活動';
}

function parseDatesAndPrice(text, today) {
  const untilMatch = text.match(/[〜~]\s*(\d{1,2}\/\d{1,2})\s*限時\s*([0-9]+)/);
  if (untilMatch) {
    return {
      startDate: today,
      endDate: isoDateFromTaiwanMonthDay(untilMatch[1]),
      salePrice: Number(untilMatch[2]),
      campaignType: `限時${untilMatch[2]}`
    };
  }

  const reverseUntilMatch = text.match(/限時\s*([0-9]+)\s*[~〜]\s*(\d{1,2}\/\d{1,2})/);
  if (reverseUntilMatch) {
    const prices = [...text.matchAll(/NT\$\s*([0-9,]+)/g)].map(match => numberFromText(match[1]));
    return {
      startDate: today,
      endDate: isoDateFromTaiwanMonthDay(reverseUntilMatch[2]),
      originalPrice: prices.length > 1 ? prices[0] : '',
      salePrice: Number(reverseUntilMatch[1]),
      campaignType: `限時${reverseUntilMatch[1]}`
    };
  }

  const oneDayMatch = text.match(/(\d{1,2}\/\d{1,2})\s*\([^)]+\)/);
  const prices = [...text.matchAll(/NT\$\s*([0-9,]+)/g)].map(match => numberFromText(match[1]));
  return {
    startDate: oneDayMatch ? isoDateFromTaiwanMonthDay(oneDayMatch[1]) : today,
    endDate: oneDayMatch ? isoDateFromTaiwanMonthDay(oneDayMatch[1]) : today,
    originalPrice: prices.length > 1 ? prices[0] : '',
    salePrice: prices.length ? prices[prices.length - 1] : '',
    campaignType: oneDayMatch ? '一日限時' : ''
  };
}

export async function fetchPubuDeals() {
  const html = await fetchHtml(CONFIG.sourcePage);
  const $ = cheerio.load(html);
  const today = taipeiToday();
  const deals = [];

  $('li.in_book').each((_, node) => {
    const card = $(node);
    const text = cleanText(card.text());
    const link = card.find('a[href*="/ebook/"]').first();
    const href = stripTracking(absoluteUrl(link.attr('href'), CONFIG.sourcePage));
    if (!href) return;

    const titleLink = card.find('a[href*="/ebook/"]').filter((_, a) => cleanText($(a).text()).length > 2).first();
    const img = card.find('img').first();
    const imageAlt = cleanText(img.attr('alt'));
    const rawTitle = cleanText(titleLink.text()) || cleanText(card.find('.title, .book-title, h3').first().text());
    const fallbackTitle = cleanText(text
      .replace(/^(\d{1,2}\/\d{1,2}\([^)]+\)|[〜~]\d{1,2}\/\d{1,2}限時\d+)\s*/, '')
      .replace(/NT\$.*$/, ''));
    const title = imageAlt && imageAlt.length > rawTitle.length ? imageAlt : rawTitle || fallbackTitle;
    if (!title) return;

    const parsed = parseDatesAndPrice(text, today);
    const coverUrl = absoluteUrl(img.attr('src') || img.attr('data-src'), CONFIG.sourcePage);
    const downDate = text.match(/\[(\d{1,2}\/\d{1,2})下架\]/)?.[1];

    deals.push({
      platform: CONFIG.platform,
      campaignType: parsed.campaignType || (Number(parsed.salePrice) === 99 ? '限時99' : parseCampaignType($, node)),
      title,
      originalPrice: parsed.originalPrice || '',
      salePrice: parsed.salePrice || '',
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      shelfEndDate: downDate ? isoDateFromTaiwanMonthDay(downDate) : '',
      url: href,
      coverUrl,
      sourcePage: CONFIG.sourcePage,
      fetchMethod: CONFIG.method,
      confidence: parsed.salePrice ? 'high' : 'medium'
    });
  });

  return deals;
}
