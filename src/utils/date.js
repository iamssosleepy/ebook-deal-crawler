const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

export function taipeiToday() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date());
}

export function isoDateFromTaiwanMonthDay(monthDay, year = new Date().getFullYear()) {
  if (!monthDay) return '';
  const match = String(monthDay).match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (!match) return '';
  const month = match[1].padStart(2, '0');
  const day = match[2].padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const start = new Date(`${startIso}T00:00:00+08:00`);
  const end = new Date(`${endIso}T00:00:00+08:00`);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

export function statusFor(todayIso, startIso, endIso) {
  if (startIso && todayIso < startIso) return '即將開始';
  if (endIso && todayIso > endIso) return '已結束';
  return '進行中';
}

export function formatTwDate(isoDate) {
  if (!isoDate) return '未標示';
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${month}/${day}（${WEEKDAY[date.getUTCDay()]}）`;
}

export function nowIsoTaipei() {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  return formatter.format(new Date()).replace(' ', 'T') + '+08:00';
}
