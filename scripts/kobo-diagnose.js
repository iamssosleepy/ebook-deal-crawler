// Read-only Kobo reachability probe for workflow_dispatch. Two page loads total (article + one
// book). Logs only HTTP status, a 40-char title, parsed count/dates and a price marker.
// No Sheets, no Discord, no secrets, no files written.
import { execFileSync } from 'node:child_process';
import { parseKoboHtml } from '../src/sources/kobo.js';
import { campaignWeek } from '../src/sources/koboValidation.js';
import { openHeaded, withHeadedBrowser } from '../src/utils/headedBrowser.js';

function requireDeps() {
  const missing = [];
  if (!process.env.DISPLAY) {
    try { execFileSync('which', ['Xvfb'], { stdio: 'ignore' }); } catch { missing.push('Xvfb (sudo apt-get install -y xvfb)'); }
  }
  try { execFileSync('npx', ['playwright', '--version'], { stdio: 'ignore' }); } catch { missing.push('playwright (npm ci)'); }
  if (missing.length) {
    console.error(`KOBO_DIAG_MISSING_DEPS ${missing.join('; ')}`);
    console.error('Install Chromium + system libs once on the runner: npx playwright install --with-deps chromium');
    process.exit(2);
  }
}

const short = text => String(text || '').replace(/\s+/g, ' ').slice(0, 40);

requireDeps();
const { year, week } = campaignWeek(new Date());
const articleUrl = `https://www.kobo.com/zh/blog/weekly-dd99-${year}-w${week}/`;
try {
  await withHeadedBrowser(async browser => {
    const article = await openHeaded(browser, articleUrl);
    const rows = article.status === 200 ? parseKoboHtml(article.html, articleUrl, year) : [];
    const dates = [...new Set(rows.map(row => row.startDate))];
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
    const books = rows.filter(row => /\/tw\/zh\/ebook\//.test(row.url));
    const book = books.find(row => row.startDate === today) || books[0];
    console.log(`KOBO_DIAG article week=W${week} status=${article.status} title="${short(article.title)}" parsed=${rows.length} dates=${dates.join(',')} bookLinks=${rows.filter(r => r.url !== articleUrl).length}`);
    if (!book) {
      console.log('KOBO_DIAG book skipped=no-parsed-book-link');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
    const page = await openHeaded(browser, book.url);
    console.log(`KOBO_DIAG book date=${book.startDate} status=${page.status} title="${short(page.title)}" price99=${/"price"\s*:\s*99\b/.test(page.html)}`);
  });
} catch (error) {
  console.error(`KOBO_DIAG_FAILED ${error.code || error.name}`);
  if (error.code === 'XVFB_UNAVAILABLE') console.error('Xvfb could not start; install xvfb on the runner.');
  else if (/Executable doesn't exist|browserType\.launch/.test(String(error.message))) console.error('Chromium missing; run: npx playwright install --with-deps chromium');
  process.exit(1);
}
