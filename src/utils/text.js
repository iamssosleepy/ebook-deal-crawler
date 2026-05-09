export function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

export function stripTracking(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url, url.startsWith('/') ? 'https://example.com' : undefined);
    ['loc', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'rec', 'rec_sid', 'rec_mid', 'rec_id', 'rec_pid'].forEach(key => parsed.searchParams.delete(key));
    const clean = parsed.toString();
    return clean.replace('https://example.com', '');
  } catch {
    return url.split('?')[0];
  }
}

export function absoluteUrl(url, base) {
  if (!url) return '';
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

export function numberFromText(value) {
  const match = String(value || '').replace(/,/g, '').match(/\d+/);
  return match ? Number(match[0]) : '';
}

export function classifyTitle(title) {
  const rules = [
    ['財經投資', ['投資', '理財', '財富', '存股', '金融', '報酬', '致富', '財報', '股息', '飆股']],
    ['商管職場', ['企劃', '經營', '談判', '工作', '成交', '職場', '動機', '靠譜', '空服員']],
    ['語言學習', ['英文', '日文', '韓文', '雅思', 'IELTS', 'VOCA', '英語', '日語']],
    ['心理成長', ['心理', '情緒', '憂鬱', '敏感', '倦怠', '界線', '自己', '媽媽']],
    ['小說文學', ['小說', '殺人', '末世', '武林', '靈首村', '蘇東坡', '聖誕夜', '故事']],
    ['生活健康', ['健康', '腸', '腹脹', '食療', '精油', '芳療', '身體', '雞', '食物']],
    ['藝術設計', ['設計', '水彩', '調色', '樂高', '符號學', '電影', '侍酒師', '餐酒']],
    ['社會文化', ['歷史', '愛沙尼亞', '中國', '未來', '革命', '市場學', '母愛', '移動']]
  ];
  for (const [label, keywords] of rules) {
    if (keywords.some(keyword => title.includes(keyword))) return label;
  }
  return '其他';
}
