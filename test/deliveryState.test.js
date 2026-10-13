import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deliverDiscordDigest, readDiscordReceipt, writeDiscordReceipt } from '../src/utils/deliveryState.js';

async function temporaryState(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ebook-delivery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('persists a daily Discord delivery receipt', async t => {
  const directory = await temporaryState(t);

  assert.equal(await readDiscordReceipt(directory, '2026-08-27'), null);
  await writeDiscordReceipt(directory, '2026-08-27', {
    id: 'message-123',
    channel_id: 'channel-456'
  });
  const receipt = await readDiscordReceipt(directory, '2026-08-27');
  assert.equal(receipt.message_id, 'message-123');
  assert.equal(receipt.channel_id, 'channel-456');
});

test('test mode posts without writing an official delivery receipt', async t => {
  const directory = await temporaryState(t);
  const post = t.mock.fn(async () => ({ id: 'test-message' }));
  const writeReceipt = t.mock.fn(writeDiscordReceipt);
  const result = await deliverDiscordDigest({
    env: { DISCORD_TEST_MODE: '1' }, stateDir: directory, date: '2026-10-13', post, writeReceipt
  });

  assert.equal(result.skipped, false);
  assert.equal(post.mock.callCount(), 1);
  assert.equal(writeReceipt.mock.callCount(), 0);
  assert.equal(await readDiscordReceipt(directory, '2026-10-13'), null);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('official mode posts and writes the daily delivery receipt', async t => {
  const directory = await temporaryState(t);
  const post = t.mock.fn(async () => ({ id: 'official-message', channel_id: 'official-channel' }));
  const result = await deliverDiscordDigest({
    env: { DISCORD_TEST_MODE: '0' }, stateDir: directory, date: '2026-10-13', post
  });

  assert.equal(result.skipped, false);
  assert.equal(post.mock.callCount(), 1);
  const receipt = await readDiscordReceipt(directory, '2026-10-13');
  assert.equal(receipt.message_id, 'official-message');
  assert.equal(receipt.channel_id, 'official-channel');
});

test('official mode skips posting when an official receipt exists', async t => {
  const directory = await temporaryState(t);
  await writeDiscordReceipt(directory, '2026-10-13', { id: 'previous-message' });
  const post = t.mock.fn();
  const writeReceipt = t.mock.fn(writeDiscordReceipt);
  const result = await deliverDiscordDigest({
    env: {}, stateDir: directory, date: '2026-10-13', post, writeReceipt
  });

  assert.equal(result.skipped, true);
  assert.equal(post.mock.callCount(), 0);
  assert.equal(writeReceipt.mock.callCount(), 0);
  assert.equal((await readDiscordReceipt(directory, '2026-10-13')).message_id, 'previous-message');
});

test('force delivery bypasses the receipt read and records the official send', async t => {
  const directory = await temporaryState(t);
  await writeDiscordReceipt(directory, '2026-10-13', { id: 'previous-message' });
  const readReceipt = t.mock.fn(async () => { throw new Error('receipt must not be read'); });
  const post = t.mock.fn(async () => ({ id: 'forced-message' }));
  const result = await deliverDiscordDigest({
    env: { FORCE_DISCORD_DELIVERY: '1' }, stateDir: directory, date: '2026-10-13', post, readReceipt
  });

  assert.equal(result.skipped, false);
  assert.equal(readReceipt.mock.callCount(), 0);
  assert.equal(post.mock.callCount(), 1);
  assert.equal((await readDiscordReceipt(directory, '2026-10-13')).message_id, 'forced-message');
});

test('test mode keeps the existing official receipt duplicate check', async t => {
  const directory = await temporaryState(t);
  await writeDiscordReceipt(directory, '2026-10-13', { id: 'official-message' });
  const post = t.mock.fn();
  const result = await deliverDiscordDigest({
    env: { DISCORD_TEST_MODE: '1' }, stateDir: directory, date: '2026-10-13', post
  });

  assert.equal(result.skipped, true);
  assert.equal(post.mock.callCount(), 0);
  assert.equal((await readDiscordReceipt(directory, '2026-10-13')).message_id, 'official-message');
});

test('a forced test send preserves the existing official receipt', async t => {
  const directory = await temporaryState(t);
  const target = path.join(directory, 'discord-2026-10-13.json');
  await writeDiscordReceipt(directory, '2026-10-13', { id: 'official-message' });
  const previous = await fs.readFile(target, 'utf8');
  const post = t.mock.fn(async () => ({ id: 'forced-test-message' }));
  const writeReceipt = t.mock.fn(writeDiscordReceipt);
  const result = await deliverDiscordDigest({
    env: { DISCORD_TEST_MODE: '1', FORCE_DISCORD_DELIVERY: '1' },
    stateDir: directory, date: '2026-10-13', post, writeReceipt
  });

  assert.equal(result.skipped, false);
  assert.equal(post.mock.callCount(), 1);
  assert.equal(writeReceipt.mock.callCount(), 0);
  assert.equal(await fs.readFile(target, 'utf8'), previous);
  assert.deepEqual(await fs.readdir(directory), ['discord-2026-10-13.json']);
});
