// Pure validation. No fetching, state mutation, scheduling, or publishing.
const DAY = 86400000;

export function campaignWeek(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).map(part => [part.type, part.value]));
  const year = Number(parts.year);
  const day = Date.UTC(year, Number(parts.month) - 1, Number(parts.day));
  return { year, week: Math.floor((day - Date.UTC(year, 0, 1)) / DAY / 7) + 1 };
}

export function campaignDates(year, week) {
  if (!Number.isInteger(year) || year < 2000 || year > 9999 ||
      !Number.isInteger(week) || week < 1 || week > 53) {
    throw new RangeError('Invalid Kobo campaign year/week');
  }
  const first = Date.UTC(year, 0, 1) + (week - 1) * 7 * DAY;
  const end = Math.min(first + 7 * DAY, Date.UTC(year + 1, 0, 1));
  return Array.from({ length: (end - first) / DAY }, (_, i) =>
    new Date(first + i * DAY).toISOString().slice(0, 10));
}

export function isKoboUrl(value, pathname) {
  try {
    const url = new URL(value);
    return url.origin === 'https://www.kobo.com' && !url.username && !url.password &&
      pathname.test(url.pathname);
  } catch { return false; }
}

export function isCampaignSource(value, year, week) {
  return isKoboUrl(value, new RegExp(`^/zh/blog/weekly-dd99-${year}-w${week}/?$`));
}

export function isKoboBook(value) {
  return isKoboUrl(value, /^\/(tw|hk)\/zh\/ebook\/[^/]+\/?$/);
}

export function validateKoboCampaign(deals, year, week) {
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  if (!Array.isArray(deals) || !deals.length) fail('KOBO_EMPTY');
  const dates = campaignDates(year, week);
  const seen = new Set();
  for (const row of deals) {
    if (!row || !isCampaignSource(row.sourcePage, year, week)) fail('KOBO_INVALID_SOURCE');
    if (typeof row.title !== 'string' || !row.title.trim() ||
        !dates.includes(row.startDate) || row.endDate !== row.startDate ||
        !isKoboBook(row.url)) fail('KOBO_INVALID_ROW');
    seen.add(row.startDate);
  }
  // A few rows or seven duplicates do not prove a complete weekly list.
  if (dates.some(date => !seen.has(date))) fail('KOBO_INCOMPLETE_DATES');
  return deals;
}
