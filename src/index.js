import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchReadmooDeals } from './sources/readmoo.js';
import { fetchKoboDeals } from './sources/kobo.js';
import { fetchBooksTwDeals } from './sources/booksTw.js';
import { fetchPubuDeals } from './sources/pubu.js';
import { normalizeDeals } from './normalize.js';
import { writeSheetsCsv } from './output/sheetsCsv.js';
import { buildDiscordPayload, postDiscord, writeDiscordPayload } from './output/discord.js';
import { writeGoogleSheet } from './integrations/googleSheets.js';
import { taipeiToday } from './utils/date.js';
import { readDiscordReceipt, writeDiscordReceipt } from './utils/deliveryState.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');

const FETCHERS = {
  readmoo: fetchReadmooDeals,
  kobo: fetchKoboDeals,
  booksTw: fetchBooksTwDeals,
  pubu: fetchPubuDeals
};

function selectedSources() {
  const value = process.env.SOURCES || process.argv.find(arg => arg.startsWith('--sources='))?.split('=')[1];
  if (!value) return Object.keys(FETCHERS);
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

async function runFetcher(name) {
  const fetcher = FETCHERS[name];
  if (!fetcher) throw new Error(`Unknown source: ${name}`);
  const startedAt = Date.now();
  try {
    const rows = await fetcher();
    console.log(`✅ ${name}: ${rows.length} raw deals (${Date.now() - startedAt}ms)`);
    if (rows.length === 0) {
      console.warn(`⚠️ ${name}: parsed 0 deals; source may be blocked or page structure may have changed.`);
    }
    return { name, rows, error: null };
  } catch (error) {
    console.error(`⚠️ ${name}: ${error.message}`);
    return { name, rows: [], error };
  }
}

async function main() {
  const sources = selectedSources();
  console.log(`Crawling sources: ${sources.join(', ')}`);

  const results = await Promise.all(sources.map(runFetcher));
  const incomplete = results.filter(result => result.error || result.rows.length === 0);
  if (process.env.REQUIRE_ALL_SOURCES === '1' && incomplete.length) {
    throw new Error(`Refusing to publish incomplete crawl: ${incomplete.map(result => result.name).join(', ')}`);
  }
  const rawDeals = results.flatMap(result => result.rows);
  const rows = normalizeDeals(rawDeals);
  const minDeals = Number(process.env.MIN_DEALS || 0);
  if (minDeals > 0 && rows.length < minDeals) {
    throw new Error(`Only ${rows.length} normalized deals parsed; MIN_DEALS=${minDeals}. Refusing to post potentially broken output.`);
  }

  const csvPath = await writeSheetsCsv(rows, OUTPUT_DIR);
  const discordPath = await writeDiscordPayload(rows, OUTPUT_DIR);
  const payload = buildDiscordPayload(rows);

  console.log(`\nNormalized deals: ${rows.length}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Discord payload: ${discordPath}`);

  const dryRun = process.env.DRY_RUN === '1';

  if (process.env.GOOGLE_SHEET_ID && !dryRun) {
    await writeGoogleSheet(rows, process.env.GOOGLE_SHEET_ID, process.env.GOOGLE_SHEET_TAB);
    console.log(`✅ Google Sheets updated (${process.env.GOOGLE_SHEET_TAB || '電子書特價日報'})`);
  } else if (process.env.GOOGLE_SHEET_ID && dryRun) {
    console.log('DRY_RUN=1, skipped Google Sheets update');
  }

  if (process.env.DISCORD_WEBHOOK_URL && !dryRun) {
    const deliveryDate = taipeiToday();
    const stateDir = process.env.DELIVERY_STATE_DIR || '';
    const forceDelivery = process.env.FORCE_DISCORD_DELIVERY === '1';
    const previousReceipt = forceDelivery ? null : await readDiscordReceipt(stateDir, deliveryDate);
    if (previousReceipt) {
      console.log(`⏭️ Discord digest already delivered for ${deliveryDate}; skipped duplicate post`);
    } else {
      const receipt = await postDiscord(payload, process.env.DISCORD_WEBHOOK_URL);
      await writeDiscordReceipt(stateDir, deliveryDate, receipt);
      console.log(`✅ Discord digest posted message_id=${receipt.id || 'unavailable'}`);
    }
  } else if (process.env.DISCORD_WEBHOOK_URL && dryRun) {
    console.log('DRY_RUN=1, skipped Discord post');
  }

  const failed = results.filter(result => result.error);
  if (failed.length) {
    console.error(`\nCompleted with ${failed.length} source error(s): ${failed.map(result => result.name).join(', ')}`);
    if (process.env.FAIL_ON_SOURCE_ERROR === '1') {
      process.exitCode = 1;
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
