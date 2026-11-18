'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/runtime');

function sessionModule(platform = 'darwin', extra = {}, globals = {}) {
  return loadModule(require.resolve('../src/session'), {
    electron: {}, './services': {}, './export': {}, ...extra
  }, { process: { platform }, ...globals });
}

function session(platform, extra = {}, globals = {}) {
  const { Presentation } = sessionModule(platform, extra, globals);
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

test('输入框聚焦期间屏蔽 F / D / B / P 快捷键，按 Esc 仅让输入框失焦', () => {
  const p = session('darwin');
  const sent = [];
  let toggledFs = 0;
  let blacked = 0;
  const presenterWc = { send: (ch, data) => sent.push([ch, data]) };
  p.presenter = { isDestroyed: () => false, webContents: presenterWc };
  p.audience = { isDestroyed: () => false, webContents: { send() {} } };
  p.target = { mode: 'screen', displayId: 1 };
  p.lightbox = { audience: false, presenter: false };
  p.toggleFullscreen = () => { toggledFs += 1; };
  p.toggleBlackout = () => { blacked += 1; };

  p.setTyping(presenterWc, true);
  for (const key of ['f', 'd', 'b', 'p']) {
    let prevented = false;
    p.onKey({ preventDefault: () => { prevented = true; } }, { type: 'keyDown', key }, 'presenter');
    assert.equal(prevented, false, key);
  }
  assert.equal(toggledFs, 0);
  assert.equal(blacked, 0);

  let escPrevented = false;
  p.onKey({ preventDefault: () => { escPrevented = true; } }, { type: 'keyDown', key: 'Escape' }, 'presenter');
  assert.equal(escPrevented, true);
  assert.deepEqual(sent, [['stage:blur-editable', undefined]]);

  p.setTyping(presenterWc, false);
  p.onKey({ preventDefault() {} }, { type: 'keyDown', key: 'b' }, 'presenter');
  assert.equal(blacked, 1);
});

test('访客二维码三态切换与大屏状态实时转发', () => {
  const p = session('darwin');
  const audienceMsgs = [];
  const presenterMsgs = [];
  const liveEvents = [];
  p.audience = { isDestroyed: () => false, webContents: { send: (ch, d) => audienceMsgs.push([ch, d]) } };
  p.presenter = { isDestroyed: () => false, webContents: { send: (ch, d) => presenterMsgs.push([ch, d]) } };
  p.onLiveEvent = (ev, d) => liveEvents.push([ev, d]);

  p.toggleVisitorQr('corner', { visitorQr: 'qr-svg', visitorUrl: 'http://192.168.1.2:18899/?v=1' });
  assert.equal(p.visitorQrMode, 'corner');
  assert.equal(audienceMsgs[0][0], 'stage:visitor-qr');
  assert.equal(audienceMsgs[0][1].mode, 'corner');
  assert.equal(presenterMsgs[0][0], 'stage:visitor-qr-state');

  p.relayDom({ zi: 0, path: [1], op: 'attr', name: 'class', value: 'is-active' });
  p.relayIframe({ fi: 0, op: 'click', path: [0], rx: 0.5, ry: 0.5 });
  assert.equal(p.domSyncMap.size, 1);
  assert.equal(liveEvents.length, 1);
  assert.equal(liveEvents[0][0], 'dom');
  assert.equal(audienceMsgs.some(([ch]) => ch === 'stage:iframe-sync'), true);
});

test('computePlayTargets：单屏默认窗口模式，双屏默认观众投外接屏，热插拔改变屏幕数时自动切回智能默认', () => {
  const { computePlayTargets } = sessionModule('darwin');
  const builtin = { id: 1, label: 'Built-in', size: { width: 1440, height: 900 } };
  const external = { id: 2, label: 'DELL U2723QE', size: { width: 2560, height: 1440 } };

  const single = computePlayTargets([builtin], builtin, null);
  assert.equal(single.audience, 'window');
  assert.equal(single.presenter, '1');
  assert.equal(single.list.find((x) => x.id === 'window').checked, true);

  const dual = computePlayTargets([builtin, external], builtin, null);
  assert.equal(dual.audience, '2');
  assert.equal(dual.presenter, '1');
  assert.equal(dual.list.find((x) => x.id === '2').checked, true);

  // 单屏下保存过偏好，插上外接屏变成双屏后自动投外接屏，不沿用单屏的窗口偏好
  const pluggedIn = computePlayTargets([builtin, external], builtin, { audience: 'window', presenter: '1', screens: 1 });
  assert.equal(pluggedIn.audience, '2');

  // 相同屏幕数下的手动偏好正常保留
  const kept = computePlayTargets([builtin, external], builtin, { audience: '1', presenter: '2', screens: 2 });
  assert.equal(kept.audience, '1');
  assert.equal(kept.presenter, '2');
});

test('updatePointer 实时推送新光标配置到观众与演讲者窗口', () => {
  const p = session('darwin');
  const received = [];
  p.audience = { isDestroyed: () => false, webContents: { send: (ch, d) => received.push(['audience', ch, d.value.style]) } };
  p.presenter = { isDestroyed: () => false, webContents: { send: (ch, d) => received.push(['presenter', ch, d.value.style]) } };
  p.updatePointer({ value: { style: 'ring', size: 'medium' } });
  assert.deepEqual(received, [
    ['audience', 'stage:pointer-config', 'ring'],
    ['presenter', 'stage:pointer-config', 'ring']
  ]);
});
