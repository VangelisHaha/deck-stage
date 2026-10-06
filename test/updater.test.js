'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateManager, RELEASES_URL } = require('../src/updater');

function fixture({ packaged = true, response = 1 } = {}) {
  const autoUpdater = new EventEmitter();
  autoUpdater.checks = 0;
  autoUpdater.installs = 0;
  autoUpdater.checkForUpdates = async () => { autoUpdater.checks += 1; };
  autoUpdater.quitAndInstall = () => { autoUpdater.installs += 1; };
  const messages = [];
  const opened = [];
  const toasts = [];
  const manager = createUpdateManager({
    app: { isPackaged: packaged, getVersion: () => '0.3.1' },
    dialog: { showMessageBox: async (...args) => { messages.push(args.at(-1)); return { response }; } },
    shell: { openExternal: async (url) => opened.push(url) },
    getWindow: () => null,
    toast: (text) => toasts.push(text),
    autoUpdater,
    logger: { warn() {} }
  });
  return { manager, autoUpdater, messages, opened, toasts };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('开发模式不会访问更新服务，并给出明确提示', async () => {
  const f = fixture({ packaged: false });
  assert.equal(await f.manager.check(), false);
  assert.equal(f.autoUpdater.checks, 0);
  assert.equal(f.messages[0].title, '开发模式');
});

test('打包版手动检查调用 electron-updater，发现新版后展示下载状态', async () => {
  const f = fixture();
  assert.equal(await f.manager.check(), true);
  assert.equal(f.autoUpdater.checks, 1);
  f.autoUpdater.emit('update-available', { version: '0.4.0' });
  assert.match(f.toasts.at(-1), /v0\.4\.0/);
  assert.equal(f.autoUpdater.autoDownload, true);
  assert.equal(f.autoUpdater.autoInstallOnAppQuit, true);
});

test('更新下载完成后可立即重启安装', async () => {
  const f = fixture({ response: 0 });
  await f.manager.check();
  f.autoUpdater.emit('update-downloaded', { version: '0.4.0' });
  await nextTurn();
  assert.equal(f.messages.at(-1).title, '更新已准备好');
  assert.equal(f.autoUpdater.installs, 1);
});

test('手动检查失败可打开 GitHub 发布页', async () => {
  const f = fixture({ response: 0 });
  f.autoUpdater.checkForUpdates = async () => { throw new Error('offline'); };
  assert.equal(await f.manager.check(), false);
  assert.deepEqual(f.opened, [RELEASES_URL]);
});

test('自动发现更新后的下载失败会提示并可打开发布页', async () => {
  const f = fixture({ response: 0 });
  await f.manager.check({ manual: false });
  f.autoUpdater.emit('update-available', { version: '0.4.0' });
  f.autoUpdater.emit('error', new Error('download failed'));
  await nextTurn();
  assert.equal(f.messages.at(-1).title, '检查更新失败');
  assert.deepEqual(f.opened, [RELEASES_URL]);
});
