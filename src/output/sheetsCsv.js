import fs from 'node:fs/promises';
import path from 'node:path';
import { taipeiToday } from '../utils/date.js';

export const SHEETS_HEADERS = [
  ['platform', '平台'],
  ['campaign_type', '活動類型'],
  ['category', '分類'],
  ['title', '書名'],
  ['author', '作者'],
  ['publisher', '出版社'],
  ['original_price_twd', '原價_TWD'],
  ['sale_price_twd', '特價_TWD'],
  ['saved_twd', '省下_TWD'],
  ['discount_pct', '折扣率_%'],
  ['start_date', '特價開始'],
  ['end_date', '特價結束'],
  ['days_left', '剩餘天數'],
  ['status', '狀態'],
  ['url', '購買連結'],
  ['canonical_url', '乾淨連結'],
  ['cover_url', '封面圖'],
  ['source_page', '來源頁'],
  ['fetch_method', '抓取方式'],
  ['confidence', '信心等級'],
  ['fetched_at', '抓取時間']
];

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export async function writeSheetsCsv(rows, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const filename = `ebook_deals_${taipeiToday()}.csv`;
  const filePath = path.join(outputDir, filename);
  const lines = [
    SHEETS_HEADERS.map(([, label]) => csvEscape(label)).join(','),
    ...rows.map(row => SHEETS_HEADERS.map(([key]) => csvEscape(row[key])).join(','))
  ];
  await fs.writeFile(filePath, `\uFEFF${lines.join('\n')}`, 'utf8');
  return filePath;
}

export function rowsForGoogleSheets(rows) {
  return [
    SHEETS_HEADERS.map(([, label]) => label),
    ...rows.map(row => SHEETS_HEADERS.map(([key]) => row[key] ?? ''))
  ];
}
