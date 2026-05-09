import { classifyTitle, stripTracking } from './utils/text.js';
import { daysBetween, nowIsoTaipei, statusFor, taipeiToday } from './utils/date.js';

export function normalizeDeals(rawDeals) {
  const today = taipeiToday();
  const fetchedAt = nowIsoTaipei();
  const seen = new Set();
  const rows = [];

  for (const deal of rawDeals) {
    if (!deal.title || !deal.url) continue;

    const canonicalUrl = stripTracking(deal.url);
    const startDate = deal.startDate || today;
    const endDate = deal.endDate || startDate;
    const salePrice = deal.salePrice || '';
    const originalPrice = deal.originalPrice || '';
    const hasRealDiscount = originalPrice && salePrice && Number(originalPrice) > Number(salePrice);
    const savedAmount = hasRealDiscount ? Number(originalPrice) - Number(salePrice) : '';
    const discountPct = hasRealDiscount ? Math.round((1 - Number(salePrice) / Number(originalPrice)) * 1000) / 10 : '';
    const key = `${deal.platform}|${canonicalUrl}|${startDate}`;

    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      platform: deal.platform,
      campaign_type: deal.campaignType || '限時特價',
      category: deal.category || classifyTitle(deal.title),
      title: deal.title,
      author: deal.author || '',
      publisher: deal.publisher || '',
      original_price_twd: originalPrice,
      sale_price_twd: salePrice,
      saved_twd: savedAmount,
      discount_pct: discountPct,
      start_date: startDate,
      end_date: endDate,
      days_left: daysBetween(today, endDate),
      status: statusFor(today, startDate, endDate),
      url: deal.url,
      canonical_url: canonicalUrl,
      cover_url: deal.coverUrl || '',
      source_page: deal.sourcePage || '',
      fetch_method: deal.fetchMethod || '',
      confidence: deal.confidence || 'medium',
      fetched_at: fetchedAt
    });
  }

  return rows.sort((a, b) => {
    const statusOrder = { '進行中': 0, '即將開始': 1, '已結束': 2 };
    return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)
      || String(a.end_date).localeCompare(String(b.end_date))
      || Number(a.sale_price_twd || 999999) - Number(b.sale_price_twd || 999999)
      || String(a.platform).localeCompare(String(b.platform));
  });
}
