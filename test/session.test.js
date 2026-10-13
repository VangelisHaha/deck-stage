'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/runtime');

function session(platform, extra = {}, globals = {}) {
  const { Presentation } = loadModule(require.resolve('../src/session'), {
    electron: {}, './services': {}, './export': {}, ...extra
  }, { process: { platform }, ...globals });
  return Object.create(Presentation.prototype);
}

test('Windows / Linux 全屏进入、换屏和退出使用受支持的接口，macOS 保留简易全屏', () => {
  for (const platform of ['win32', 'linux', 'darwin']) {
    const p = session(platform);
    const calls = [];
    let fullscreen = false;
    const method = platform === 'darwin' ? 'SimpleFullScreen' : 'FullScreen';
    p.audience = {
      isDestroyed: () => false,
      ['is' + method]: () => fullscreen,
      ['set' + method]: (on) => { fullscreen = on; calls.push(on); },
      setAspectRatio() {}, setBounds() {}, webContents: { send() {} }
    };
    p.displayById = () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } });
    p.placePresenter = () => {};
    p.onChange = () => {};
    p.applyTarget({ mode: 'screen', displayId: 1 });
    p.applyTarget({ mode: 'screen', displayId: 2 });
    p.applyTarget({ mode: 'window', displayId: 2 });
    assert.deepEqual(calls, [true, false, true, false], platform);
    assert.equal(fullscreen, false, platform);
  }
});

test('文件变更监听过滤 Windows 和 POSIX 依赖目录，内容修改仍触发刷新', () => {
  let onChange;
  let scheduled = 0;
  const p = session('win32', { fs: { watch: (_root, _options, fn) => { onChange = fn; return { close() {} }; } } }, {
    setTimeout: () => { scheduled += 1; return scheduled; }, clearTimeout() {}
  });
  p.root = 'C:/DeckStage';
  p.setHotReload(true);
  for (const file of [String.raw`node_modules\x\index.js`, String.raw`acts\.git\index`, 'lib/deck.js', '.git/index']) onChange('change', file);
  assert.equal(scheduled, 0);
  onChange('change', String.raw`acts\第一幕.html`);
  onChange('change', 'notes.js');
  assert.equal(scheduled, 2);
});
