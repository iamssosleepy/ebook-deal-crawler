import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cleanText, stripTracking } from '../utils/text.js';
import { campaignWeek, validateKoboCampaign } from './koboValidation.js';

// User-approved public data snapshot; never pretend a secondary source was
// directly verified against Kobo. No HTTP or publication occurs in this module.
export const SNAPSHOT_PATH = fileURLToPath(new URL('../../data/kobo-helloruru.json', import.meta.url));
export const SNAPSHOT_SOURCE = 'https://tools.helloruru.com/ebook-deals/';

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
    throw new Error('KOBO_SNAPSHOT_INVALID');
  }
  const rows = source.deals.map(book => {
    if (book?.platform !== 'kobo' || book.dealPrice !== 99 ||
        typeof book.title !== 'string' || typeof book.bookUrl !== 'string') {
      throw new Error('KOBO_SNAPSHOT_INVALID_ROW');
    }
    return {
      platform: 'Kobo', campaignType: '每日99書單', title: cleanText(book.title),
      author: typeof book.author === 'string' ? cleanText(book.author) : '', publisher: '',
      originalPrice: Number.isFinite(book.originalPrice) && book.originalPrice > 0 ? book.originalPrice : '',
      salePrice: book.dealPrice, startDate: book.date, endDate: book.date,
      url: stripTracking(book.bookUrl), coverUrl: typeof book.coverUrl === 'string' ? book.coverUrl : '',
      sourcePage: SNAPSHOT_SOURCE,
      upstreamSourcePage: `https://www.kobo.com/zh/blog/weekly-dd99-${year}-w${week}/`,
      sourceFetchedAt: source.fetchedAt,
      fetchMethod: 'helloruru-public-api-snapshot', confidence: 'medium'
    };
  });
  return validateKoboCampaign(rows, year, week, { allowHelloRuru: true });
}

export async function loadKoboSnapshot(now = new Date(), filePath = SNAPSHOT_PATH) {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > 1024 * 1024) throw new Error('KOBO_SNAPSHOT_TOO_LARGE');
    return parseKoboSnapshot(JSON.parse(await fs.readFile(filePath, 'utf8')), now);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
