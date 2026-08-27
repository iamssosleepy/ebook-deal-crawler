import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readDiscordReceipt, writeDiscordReceipt } from '../src/utils/deliveryState.js';

test('persists a daily Discord delivery receipt', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ebook-delivery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  assert.equal(await readDiscordReceipt(directory, '2026-08-27'), null);
  await writeDiscordReceipt(directory, '2026-08-27', {
    id: 'message-123',
    channel_id: 'channel-456'
  });
  const receipt = await readDiscordReceipt(directory, '2026-08-27');
  assert.equal(receipt.message_id, 'message-123');
  assert.equal(receipt.channel_id, 'channel-456');
});
