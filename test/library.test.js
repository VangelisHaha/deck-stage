'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { windowsRuntime } = require('./helpers/runtime');

test('Windows 稿库完整流程：读取旧配置、去重、扫描和移除同一目录', (t) => {
  const w = windowsRuntime(t);
  const store = w.load(require.resolve('../src/store'));
  const { scanRoots } = w.load(require.resolve('../src/library'));
  const { isRemote } = require('../src/ssh');
  const root = String.raw`C:\Users\Test\Documents\DeckStage`;
  const deck = root + String.raw`\季度总结\slides`;
  w.fs.mkdirSync(deck, { recursive: true });
  w.fs.writeFileSync(deck + '\\index.html', '<title>季度总结</title>');
  w.fs.writeFileSync(deck + '\\notes.js', 'window.__NOTES = {};');
  store.write({ roots: [root, 'c:/users/test/documents/deckstage/', '', null], recent: [] });
  store.addRoot(String.raw`~\Documents\DeckStage`);
  assert.equal(store.read().roots.length, 1);
  const decks = scanRoots(store.read().roots.filter((r) => !isRemote(r)));
  assert.equal(decks.length, 1);
  assert.equal(decks[0].title, '季度总结');
  assert.equal(decks[0].rel, '季度总结');
  assert.equal(scanRoots([root, root.toLowerCase()]).length, 1);
  store.touchRecent(deck);
  store.touchRecent(deck.toLowerCase().replace(/\\/g, '/'));
  assert.equal(store.read().recent.length, 1);
  store.removeRoot('c:/users/test/documents/deckstage/');
  assert.deepEqual(store.read().roots, []);
});

test('Windows 默认稿库和示例稿识别使用同一套路径规则', (t) => {
  const w = windowsRuntime(t);
  const defaults = w.load(require.resolve('../src/defaults'));
  const demo = w.load(require.resolve('../src/demo'));
  const store = w.load(require.resolve('../src/store'));
  const root = defaults.rootDir().toLowerCase().replace(/\\/g, '/') + '/';
  store.addRoot(root);
  defaults.ensure();
  assert.equal(store.read().roots.length, 1);
  assert.equal(defaults.isDefaultRoot(root), true);
  assert.equal(demo.isDemoRoot(demo.rootDir().toLowerCase().replace(/\\/g, '/') + '/'), true);
  defaults.markRemoved();
  defaults.ensure();
  assert.deepEqual(store.read().roots, []);
  defaults.noteAdded(root);
  defaults.ensure();
  assert.equal(store.read().roots.length, 1);
});

test('SSH 根目录保持原地址，不按 Windows 本地路径规范化', (t) => {
  const w = windowsRuntime(t);
  const store = w.load(require.resolve('../src/store'));
  store.addRoot('user@server:/data/decks');
  store.addRoot('ssh://user@server/data/decks');
  assert.deepEqual(store.read().roots, ['user@server:/data/decks']);
  store.removeRoot('ssh://user@server/data/decks');
  assert.deepEqual(store.read().roots, []);
});
