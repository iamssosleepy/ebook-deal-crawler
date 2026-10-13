import fs from 'node:fs/promises';
import path from 'node:path';
import { validateKoboCampaign } from './koboValidation.js';

const MAX_BYTES = 1024 * 1024;

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

export function koboCacheDir() {
  return process.env.KOBO_CACHE_DIR || process.env.DELIVERY_STATE_DIR || '';
}

function cacheFileName(year, week) {
  return `kobo-week-${year}-w${String(week).padStart(2, '0')}.json`;
}

export async function writeKoboWeekCache({ year, week, rows, dir, now = new Date(), stage } = {}) {
  const cacheDir = dir === undefined ? koboCacheDir() : dir;
  if (!cacheDir) return;
  const name = cacheFileName(year, week);
  const target = path.join(cacheDir, name);
  const tmp = path.join(cacheDir, `.${name}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
    const savedAt = new Date(now).toISOString();
    const body = JSON.stringify({ version: 1, year, week, savedAt, stage, rows });
    await fs.writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
    await fs.chmod(tmp, 0o600);
    await fs.rename(tmp, target);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => {});
    fail('KOBO_CACHE_WRITE_FAILED');
  }
}

export async function readKoboWeekCache({ year, week, dir } = {}) {
  const cacheDir = dir === undefined ? koboCacheDir() : dir;
  if (!cacheDir) return null;
  const target = path.join(cacheDir, cacheFileName(year, week));
  let text;
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > MAX_BYTES) fail('KOBO_CACHE_INVALID');
    text = await fs.readFile(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error?.code === 'KOBO_CACHE_INVALID') throw error;
    fail('KOBO_CACHE_INVALID');
  }
  if (text.byteLength > MAX_BYTES) fail('KOBO_CACHE_INVALID');
  let data;
  try {
    data = JSON.parse(text.toString('utf8'));
  } catch {
    fail('KOBO_CACHE_INVALID');
  }
  if (!data || data.version !== 1 || data.year !== year || data.week !== week || !Array.isArray(data.rows)) {
    fail('KOBO_CACHE_INVALID');
  }
  if (data.rows.some(row => row?.fetchMethod === 'kobo-fallback')) fail('KOBO_CACHE_INVALID');
  try {
    return validateKoboCampaign(data.rows, year, week);
  } catch {
    fail('KOBO_CACHE_INVALID');
  }
}
