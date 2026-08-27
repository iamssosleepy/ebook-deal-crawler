import fs from 'node:fs/promises';
import path from 'node:path';

function statePath(stateDir, date) {
  return path.join(stateDir, `discord-${date}.json`);
}

export async function readDiscordReceipt(stateDir, date) {
  if (!stateDir) return null;
  try {
    return JSON.parse(await fs.readFile(statePath(stateDir, date), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeDiscordReceipt(stateDir, date, receipt) {
  if (!stateDir) return;
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  const target = statePath(stateDir, date);
  const temporary = `${target}.tmp-${process.pid}`;
  const payload = {
    date,
    message_id: receipt.id || '',
    channel_id: receipt.channel_id || '',
    recorded_at: new Date().toISOString()
  };
  await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await fs.rename(temporary, target);
}
