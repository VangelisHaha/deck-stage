'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { windowsRuntime } = require('./helpers/runtime');

test('Windows 协议打开与最近放映匹配已扫描稿子，不重复登记不同写法的根目录', (t) => {
  const w = windowsRuntime(t);
  const root = String.raw`C:\Users\Test\Documents\DeckStage`;
  const target = root + String.raw`\季度总结\slides`;
  w.fs.mkdirSync(target, { recursive: true });
  w.fs.writeFileSync(target + '\\index.html', '<title>季度总结</title>');
  w.fs.writeFileSync(target + '\\notes.js', 'window.__NOTES = {};');
  const store = w.load(require.resolve('../src/store'));
  store.write({ roots: [root + '\\'], recent: [{ dir: target.toLowerCase(), at: Date.now() }] });

  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: false, setName() {}, requestSingleInstanceLock: () => true,
    isReady: () => true, whenReady: () => new Promise(() => {}),
    getPath: (key) => w.locations[key], getVersion: () => '0.5.1', getAppPath: () => 'C:/DeckStageApp'
  });
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = { send() {} }; }
    isDestroyed() { return false; }
    loadFile() {}
    show() {}
    focus() {}
  }
  const handlers = new Map();
  const display = { id: 1 };
  w.load(require.resolve('../src/main'), {
    electron: {
      app, BrowserWindow: Window, Menu: {}, dialog: {}, shell: {}, clipboard: {},
      ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
      screen: { getAllDisplays: () => [display], getPrimaryDisplay: () => display }
    },
    './session': {}, './export': {}, './menu': {}, './updater': {}, './preview': { Previews: class {} },
    './remote-decks': { RemoteDecks: class { decks() { return []; } } },
    './remote': { RemoteServer: class { summary() { return {}; } } }
  }, { setTimeout: () => 0 });

  const url = 'deckstage://open?path=' + encodeURIComponent(target.toLowerCase().replace(/\\/g, '/'));
  app.emit('open-url', { preventDefault() {} }, url);
  const state = handlers.get('stage:get-state')();
  assert.equal(state.roots.length, 1);
  assert.equal(state.roots[0].default, true);
  assert.equal(state.decks.length, 1);
  assert.equal(state.selected, state.decks[0].dir);
  assert.deepEqual(state.recent, [state.decks[0].dir]);
  assert.equal(store.read().roots.length, 1);

  const added = 'deckstage://add-root?path=' + encodeURIComponent(String.raw`~\Documents\DeckStage`);
  app.emit('open-url', { preventDefault() {} }, added);
  assert.equal(store.read().roots.length, 1);
});
