import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { prepareX11SocketDirectory, startVirtualDisplay } from '../src/utils/headedBrowser.js';

const socketFix = 'sudo mkdir -p /tmp/.X11-unix && sudo chmod 1777 /tmp/.X11-unix && sudo chown root:root /tmp/.X11-unix';
const readyFs = {
  statSync: () => ({ mode: 0o41777, isDirectory: () => true }),
  accessSync: () => {}
};

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kills = 0;
  child.kill = () => { child.kills += 1; };
  return child;
}

test('virtual display resolves on a complete display number and exposes stop', async () => {
  const child = fakeChild();
  const pending = startVirtualDisplay({
    fsImpl: readyFs,
    spawnImpl: (command, args, options) => {
      assert.equal(command, 'Xvfb');
      assert.deepEqual(args, ['-displayfd', '1', '-screen', '0', '1280x800x24', '-nolisten', 'tcp']);
      assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
      return child;
    }
  });
  child.stdout.write('12\n');
  const display = await pending;
  assert.equal(display.display, ':12');
  assert.equal(child.kills, 0);
  display.stop();
  assert.equal(child.kills, 1);
});

test('virtual display immediately rejects early exit with only the first 300 stderr characters', { timeout: 1000 }, async () => {
  const child = fakeChild();
  const pending = startVirtualDisplay({ fsImpl: readyFs, spawnImpl: () => child, timeoutMs: 10000 });
  const stderr = `Fatal server error: ${'x'.repeat(400)}`;
  child.stderr.write(stderr.slice(0, 150));
  child.stderr.write(stderr.slice(150));
  child.emit('exit', 1, null);
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'XVFB_UNAVAILABLE');
    assert.equal(error.stderr, stderr.slice(0, 300));
    assert.ok(error.message.includes(error.stderr));
    assert.match(error.message, /exited before display number \(code=1/);
    return true;
  });
  assert.equal(child.kills, 0);
});

test('virtual display timeout rejects with captured stderr and stops the child', async () => {
  const child = fakeChild();
  const pending = startVirtualDisplay({ fsImpl: readyFs, spawnImpl: () => child, timeoutMs: 10 });
  child.stderr.write('Could not create server lock file');
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'XVFB_UNAVAILABLE');
    assert.equal(error.stderr, 'Could not create server lock file');
    assert.ok(error.message.includes(error.stderr));
    assert.match(error.message, /no display number within 10ms/);
    return true;
  });
  assert.equal(child.kills, 1);
});

test('virtual display spawn error retains stderr and the original cause', async () => {
  const child = fakeChild();
  const pending = startVirtualDisplay({ fsImpl: readyFs, spawnImpl: () => child });
  const cause = Object.assign(new Error('spawn Xvfb ENOENT'), { code: 'ENOENT' });
  child.stderr.write('Unable to execute Xvfb');
  child.emit('error', cause);
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'XVFB_UNAVAILABLE');
    assert.equal(error.stderr, 'Unable to execute Xvfb');
    assert.ok(error.message.includes(error.stderr));
    assert.equal(error.cause, cause);
    return true;
  });
});

test('virtual display synchronous spawn failure truncates available stderr', async () => {
  const cause = Object.assign(new Error('spawn denied'), { code: 'EACCES', stderr: 'e'.repeat(400) });
  await assert.rejects(startVirtualDisplay({
    fsImpl: readyFs,
    spawnImpl: () => { throw cause; }
  }), error => {
    assert.equal(error.stderr, 'e'.repeat(300));
    assert.ok(error.message.includes(error.stderr));
    assert.equal(error.cause, cause);
    return true;
  });
});

test('missing X11 socket directory is created and explicitly chmodded to sticky 1777 before spawning', async () => {
  const calls = [];
  let exists = false;
  const fsImpl = {
    statSync: directory => {
      assert.equal(directory, '/tmp/.X11-unix');
      if (!exists) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return readyFs.statSync();
    },
    mkdirSync: (directory, options) => { calls.push(['mkdir', directory, options]); exists = true; },
    chmodSync: (directory, mode) => { calls.push(['chmod', directory, mode]); },
    accessSync: readyFs.accessSync
  };
  const child = fakeChild();
  const pending = startVirtualDisplay({
    fsImpl,
    spawnImpl: () => { calls.push(['spawn']); return child; }
  });
  child.stdout.write('20\n');
  (await pending).stop();
  assert.deepEqual(calls, [
    ['mkdir', '/tmp/.X11-unix', { mode: 0o1777 }],
    ['chmod', '/tmp/.X11-unix', 0o1777],
    ['spawn']
  ]);
});

test('X11 socket chmod EPERM is ignored with a repair hint', () => {
  let exists = false;
  const logs = [];
  prepareX11SocketDirectory({
    fsImpl: {
      statSync: () => {
        if (!exists) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return readyFs.statSync();
      },
      mkdirSync: () => { exists = true; },
      chmodSync: () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); },
      accessSync: readyFs.accessSync
    },
    log: message => logs.push(message)
  });
  assert.equal(logs.length, 1);
  assert.ok(logs[0].includes('EPERM'));
  assert.ok(logs[0].includes(socketFix));
});

test('existing X11 socket directory with wrong mode or no write access logs the sudo repair command', () => {
  for (const { mode, writable } of [{ mode: 0o40755, writable: true }, { mode: 0o41777, writable: false }]) {
    const logs = [];
    prepareX11SocketDirectory({
      fsImpl: {
        statSync: () => ({ mode, isDirectory: () => true }),
        accessSync: () => { if (!writable) throw Object.assign(new Error('denied'), { code: 'EACCES' }); }
      },
      log: message => logs.push(message)
    });
    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes(`mode=${(mode & 0o7777).toString(8)}`));
    assert.ok(logs[0].includes(`writable=${writable}`));
    assert.ok(logs[0].includes(socketFix));
  }
});
