'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');

const Sync = require('../kernel/stage-sync');
const IframeSync = require('../src/iframe-sync');
const { RemoteServer } = require('../src/remote');
const { lanInterfaces, lanAddresses } = require('../src/util');

test('isEditableTarget 识别输入框、下拉框与富文本，放行普通按钮与容器', () => {
  const mk = (tag, extra = {}) => ({ nodeType: 1, tagName: tag, ...extra });
  assert.equal(Sync.isEditableTarget(mk('INPUT', { type: 'text' })), true);
  assert.equal(Sync.isEditableTarget(mk('INPUT', { type: 'search' })), true);
  assert.equal(Sync.isEditableTarget(mk('TEXTAREA')), true);
  assert.equal(Sync.isEditableTarget(mk('SELECT')), true);
  assert.equal(Sync.isEditableTarget(mk('DIV', { isContentEditable: true })), true);
  assert.equal(Sync.isEditableTarget(mk('SPAN', {
    closest: (sel) => (sel === '[contenteditable]' ? { getAttribute: () => 'true' } : null)
  })), true);

  assert.equal(Sync.isEditableTarget(mk('INPUT', { type: 'button' })), false);
  assert.equal(Sync.isEditableTarget(mk('INPUT', { type: 'submit' })), false);
  assert.equal(Sync.isEditableTarget(mk('BUTTON')), false);
  assert.equal(Sync.isEditableTarget(mk('DIV')), false);
  assert.equal(Sync.isEditableTarget(null), false);
});

test('applyDomSync 同步属性、文本和 HTML 并打上 data-mirror 标记', () => {
  const attrs = new Map([['class', 'tab']]);
  const textNode = { nodeType: 3, data: '旧文案' };
  const btn = {
    nodeType: 1,
    childNodes: [textNode],
    innerHTML: '',
    attributes: [{ name: 'class', value: 'tab' }, { name: 'data-old', value: '1' }],
    setAttribute(k, v) { attrs.set(k, v); },
    removeAttribute(k) { attrs.delete(k); }
  };
  const zone = { nodeType: 1, childNodes: [btn] };
  let mirrored = false;
  const doc = {
    documentElement: { setAttribute(k) { if (k === 'data-mirror') mirrored = true; } },
    querySelectorAll: (sel) => (sel === '#slides [data-sync]' ? [zone] : [])
  };

  Sync.applyDomSync(doc, { zi: 0, path: [0], op: 'attr', name: 'class', value: 'tab is-active' });
  assert.equal(mirrored, true);
  assert.equal(attrs.get('class'), 'tab is-active');

  Sync.applyDomSync(doc, { zi: 0, path: [0, 0], op: 'text', value: '新文案' });
  assert.equal(textNode.data, '新文案');

  Sync.applyDomSync(doc, { zi: 0, path: [0], op: 'attrs', attrs: { class: 'tab done' } });
  assert.equal(attrs.has('data-old'), false);
  assert.equal(attrs.get('class'), 'tab done');
});

test('iframe 同步：重放点击、受控输入与比例滚动，并跳过 data-no-sync 元素', () => {
  let clicked = 0;
  let skippedClicked = 0;
  const events = [];

  class FakeEvent {
    constructor(type, opts = {}) { this.type = type; Object.assign(this, opts); }
  }

  let protoSetterValue = '';
  class FakeHTMLInputElement {}
  Object.defineProperty(FakeHTMLInputElement.prototype, 'value', {
    get() { return protoSetterValue; },
    set(v) { protoSetterValue = v; }
  });

  const actionBtn = {
    nodeType: 1,
    tagName: 'BUTTON',
    id: '',
    closest: () => null,
    dispatchEvent(ev) { events.push(ev.type); },
    click() { clicked += 1; }
  };
  const writeBtn = {
    nodeType: 1,
    tagName: 'BUTTON',
    id: 'dangerBtn',
    closest: (sel) => (sel === '[data-no-sync]' ? {} : null),
    dispatchEvent() {},
    click() { skippedClicked += 1; }
  };
  const searchInput = Object.assign(new FakeHTMLInputElement(), {
    nodeType: 1,
    tagName: 'INPUT',
    type: 'text',
    id: 'caseQuery',
    closest: () => null,
    dispatchEvent(ev) { events.push(ev.type); }
  });
  const scrollBox = {
    nodeType: 1,
    tagName: 'DIV',
    scrollWidth: 1000,
    clientWidth: 500,
    scrollHeight: 2000,
    clientHeight: 400,
    scrollLeft: 0,
    scrollTop: 0,
    closest: () => null
  };

  const body = {
    nodeType: 1,
    children: [actionBtn, writeBtn, searchInput, scrollBox]
  };
  for (const child of body.children) child.parentElement = body;

  const doc = {
    body,
    getElementById: (id) => body.children.find((c) => c.id === id) || null
  };
  const win = {
    innerWidth: 1200,
    innerHeight: 800,
    Event: FakeEvent,
    InputEvent: FakeEvent,
    MouseEvent: FakeEvent,
    PointerEvent: FakeEvent,
    HTMLInputElement: FakeHTMLInputElement
  };

  const path0 = IframeSync.domPathOf(doc, actionBtn);
  assert.deepEqual(path0, [0]);
  assert.equal(IframeSync.applyClickSync(win, doc, { op: 'click', path: path0, hint: { tag: 'button' }, rx: 0.2, ry: 0.3 }), true);
  assert.equal(clicked, 1);

  // 标记了 data-no-sync 的写操作按钮不会重放点击
  assert.equal(IframeSync.applyClickSync(win, doc, { op: 'click', path: [1], hint: { tag: 'button', id: 'dangerBtn' }, rx: 0.5, ry: 0.5 }), false);
  assert.equal(skippedClicked, 0);

  // 受控输入框走原型 setter 并触发 input + change
  events.length = 0;
  assert.equal(IframeSync.applyControlValue(win, searchInput, { eventType: 'change', value: 'BCC-2026' }), true);
  assert.equal(protoSetterValue, 'BCC-2026');
  assert.deepEqual(events, ['input', 'change']);

  // 滚动按可滚比例换算
  assert.equal(IframeSync.applyScrollSync(doc, { isDoc: false, path: [3], sx: 0.5, sy: 0.25 }), true);
  assert.equal(scrollBox.scrollLeft, 250);
  assert.equal(scrollBox.scrollTop, 400);
});

test('buildSubframeScript 只采集真实事件并校验观众窗消息来源', () => {
  const posted = [];
  const presenterListeners = new Map();
  const topProxy = { postMessage: (msg) => posted.push(msg) };
  const presenterCtx = {
    window: null,
    document: { activeElement: null, addEventListener() {}, body: { children: [] } },
    location: { href: 'http://192.168.162.9:19736/cases' },
    history: { pushState() {}, replaceState() {} },
    innerWidth: 1000,
    innerHeight: 800,
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout() {},
    requestAnimationFrame: (fn) => { fn(); return 1; },
    addEventListener: (ev, fn) => presenterListeners.set(ev, fn)
  };
  presenterCtx.window = presenterCtx;
  presenterCtx.top = topProxy;
  vm.runInNewContext(IframeSync.buildSubframeScript('presenter'), presenterCtx);

  const btn = { nodeType: 1, tagName: 'BUTTON', parentElement: presenterCtx.document.body, closest: () => null, getAttribute: () => '' };
  presenterCtx.document.body.children.push(btn);

  // 非真实点击（isTrusted = false）忽略
  presenterListeners.get('click')({ isTrusted: false, button: 0, target: btn, type: 'click', clientX: 200, clientY: 400 });
  const clickMsgs1 = posted.filter((m) => m.op === 'click');
  assert.equal(clickMsgs1.length, 0);

  // 真实点击正常上报归一化坐标和路径
  presenterListeners.get('click')({ isTrusted: true, button: 0, target: btn, type: 'click', clientX: 250, clientY: 400 });
  const clickMsgs2 = posted.filter((m) => m.op === 'click');
  assert.equal(clickMsgs2.length, 1);
  assert.deepEqual(Array.from(clickMsgs2[0].path), [0]);
  assert.equal(clickMsgs2[0].rx, 0.25);
  assert.equal(clickMsgs2[0].ry, 0.5);

  // 子帧焦点防困：普通元素按 ArrowRight / PageDown 透传翻页，按 Escape 回收焦点；输入框内按 ArrowRight 不误触翻页
  presenterListeners.get('keydown')({ key: 'ArrowRight', target: btn, preventDefault() {} });
  presenterListeners.get('keydown')({ key: 'Escape', target: btn, preventDefault() {} });
  const inputNode = { nodeType: 1, tagName: 'INPUT', type: 'text', blur() {} };
  presenterListeners.get('keydown')({ key: 'ArrowRight', target: inputNode, preventDefault() {} });
  const navMsgs = posted.filter((m) => m.op === 'nav-key');
  assert.equal(navMsgs.length, 1);
  assert.equal(navMsgs[0].dir, 1);
  assert.equal(posted.some((m) => m.op === 'refocus'), true);

  // 观众窗口子帧忽略非 window.top 发来的伪造消息
  let audienceClicked = 0;
  const audienceListeners = new Map();
  const audienceBtn = {
    nodeType: 1, tagName: 'BUTTON', closest: () => null,
    dispatchEvent() {}, click() { audienceClicked += 1; }
  };
  const audienceBody = { nodeType: 1, children: [audienceBtn] };
  audienceBtn.parentElement = audienceBody;
  class Ev { constructor(type) { this.type = type; } }
  const audienceTop = {};
  const audienceCtx = {
    window: null,
    top: audienceTop,
    document: { body: audienceBody, getElementById: () => null },
    location: { href: 'http://192.168.162.9:19736/cases', replace() {} },
    innerWidth: 1000,
    innerHeight: 800,
    Event: Ev, InputEvent: Ev, MouseEvent: Ev, PointerEvent: Ev,
    setTimeout, clearTimeout,
    addEventListener: (ev, fn) => audienceListeners.set(ev, fn)
  };
  audienceCtx.window = audienceCtx;
  vm.runInNewContext(IframeSync.buildSubframeScript('audience'), audienceCtx);

  audienceListeners.get('message')({ source: {}, data: { __dsReplay: 1, op: 'click', path: [0], rx: 0.1, ry: 0.1 } });
  assert.equal(audienceClicked, 0);

  audienceListeners.get('message')({ source: audienceTop, data: { __dsReplay: 1, op: 'click', path: [0], rx: 0.1, ry: 0.1 } });
  assert.equal(audienceClicked, 1);
});

test('访客大屏服务：开放真实幻灯资源、对访客屏蔽演讲台词、转发实时光标事件', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckstage-visitor-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>大屏测试</title><section class="slide" data-t="首页">正文</section><script src="notes.js"></script><script src="/_deckstage/deck.js"></script>');
  fs.writeFileSync(path.join(dir, 'notes.js'), 'window.__NOTES = { "首页": { text: "机密演讲台词不能给访客看" } };');

  const server = new RemoteServer({
    onCommand: async () => true,
    onChange() {},
    getDeckRoot: () => dir
  });
  await server.start();

  const request = (reqPath, { cookie, waitEvent = '' } = {}) => new Promise((resolve, reject) => {
    const headers = { Connection: 'close' };
    if (cookie) headers.Cookie = cookie;
    const req = http.request({
      hostname: '127.0.0.1', port: server.port, path: reqPath, method: 'GET',
      headers, agent: new http.Agent({ keepAlive: false })
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => {
        text += chunk;
        if (waitEvent && text.includes(`event: ${waitEvent}`)) {
          resolve({ status: res.statusCode, headers: res.headers, text });
          req.destroy();
        }
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('timeout: ' + reqPath)));
    req.on('error', reject);
    req.end();
  });

  try {
    // 未鉴权不能读稿子
    assert.equal((await request('/deck/index.html')).status, 401);

    const vRes = await request('/?v=' + server.visitorToken);
    assert.equal(vRes.status, 302);
    const visitorCookie = vRes.headers['set-cookie'][0].split(';')[0];

    const rRes = await request('/?t=' + server.token);
    const remoteCookie = rRes.headers['set-cookie'][0].split(';')[0];

    // 访客能加载真实幻灯片与内核脚本
    const deckHtml = await request('/deck/index.html?visitor=1', { cookie: visitorCookie });
    assert.equal(deckHtml.status, 200);
    assert.match(deckHtml.text, /大屏测试/);
    assert.equal((await request('/_deckstage/deck.js', { cookie: visitorCookie })).status, 200);
    assert.equal((await request('/_deckstage/stage-sync.js')).status, 200);

    // 访客拉取 notes.js 时台词被清空，遥控端不受影响
    const visitorNotes = await request('/deck/notes.js', { cookie: visitorCookie });
    assert.equal(visitorNotes.status, 200);
    assert.doesNotMatch(visitorNotes.text, /机密演讲台词/);
    const remoteNotes = await request('/deck/notes.js', { cookie: remoteCookie });
    assert.match(remoteNotes.text, /机密演讲台词/);

    // SSE 状态推送：遥控端保留台词，访客端剥离台词且能收到实时 pointer 事件
    server.broadcast({ live: true, deckId: '1:0', page: 0, total: 1, slide: { t: '首页', text: '机密演讲台词不能给访客看' } });
    const visitorState = await request('/api/events', { cookie: visitorCookie, waitEvent: 'state' });
    assert.match(visitorState.text, /首页/);
    assert.doesNotMatch(visitorState.text, /机密演讲台词/);

    const remoteState = await request('/api/events', { cookie: remoteCookie, waitEvent: 'state' });
    assert.match(remoteState.text, /机密演讲台词/);

    const pointerStreamPromise = request('/api/events', { cookie: visitorCookie, waitEvent: 'pointer' });
    setTimeout(() => server.broadcastEvent('pointer', { k: 'm', x: 0.4, y: 0.6 }, 'visitor'), 40);
    const pointerStream = await pointerStreamPromise;
    assert.match(pointerStream.text, /"x":0\.4/);
  } finally {
    await server.stop();
  }
});

test('lanAddresses 过滤 Clash Fake-IP 与 VPN 虚拟网卡，物理网卡优先且纯虚拟网兜底可用', () => {
  const mixed = {
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    utun3: [
      { family: 'IPv4', internal: false, address: '198.18.0.1' },
      { family: 'IPv4', internal: false, address: '10.8.0.5' }
    ],
    docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
    en5: [{ family: 'IPv4', internal: false, address: '169.254.12.3' }, { family: 'IPv4', internal: false, address: '10.20.30.40' }],
    en0: [{ family: 'IPv4', internal: false, address: '192.168.31.88' }]
  };
  assert.deepEqual(lanAddresses(mixed), ['192.168.31.88', '10.20.30.40']);
  assert.deepEqual(lanInterfaces(mixed).map((x) => x.name), ['en0', 'en5']);

  // 仅存在 Tailscale/VPN 虚拟网卡时保留非 Fake-IP 地址兜底
  const vpnOnly = {
    utun2: [{ family: 'IPv4', internal: false, address: '198.18.0.1' }, { family: 'IPv4', internal: false, address: '100.90.1.2' }]
  };
  assert.deepEqual(lanAddresses(vpnOnly), ['100.90.1.2']);
});
