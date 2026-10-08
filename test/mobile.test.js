'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAddress } = require('../mobile/www/connection');

test('手机连接支持裸 IP、端口、完整链接与 IPv6，保留显式标准端口', () => {
  assert.equal(normalizeAddress(' 192.168.1.2 '), 'http://192.168.1.2:18899/');
  assert.equal(normalizeAddress('192.168.1.2:19999'), 'http://192.168.1.2:19999/');
  assert.equal(normalizeAddress('http://192.168.1.2:80'), 'http://192.168.1.2/');
  assert.equal(normalizeAddress('192.168.1.2:80'), 'http://192.168.1.2/');
  assert.equal(normalizeAddress('https://computer.local'), 'https://computer.local/');
  assert.equal(normalizeAddress('[fd00::2]:18899'), 'http://[fd00::2]:18899/');
});

test('二维码链接保留配对令牌，舍弃无关参数', () => {
  assert.equal(normalizeAddress('http://192.168.1.2:18899/?t=abc&other=1'), 'http://192.168.1.2:18899/?t=abc');
});

test('拒绝本机地址、脚本协议、用户名和非遥控路径', () => {
  for (const input of ['', 'localhost:18899', '127.0.0.1', '[::1]', 'javascript://alert',
    'file:///tmp/foo', 'http://user:pass@computer.local', 'http://computer.local/admin', 'http://computer.local/#x']) {
    assert.throws(() => normalizeAddress(input), undefined, input);
  }
});

// 真正走 HTTP：验证手机复用的配对 cookie、状态流、控制和过期链接。
test('遥控服务支持配对、状态推送、命令与过期二维码拒绝', async () => {
  const http = require('node:http');
  const { RemoteServer } = require('../src/remote');
  const commands = [];
  const server = new RemoteServer({ onCommand: async (cmd) => { commands.push(cmd); return true; }, onChange() {} });
  await server.start();
  const request = (path, { cookie, body, stream = false } = {}) => new Promise((resolve, reject) => {
    const headers = { Connection: 'close' };
    if (cookie) headers.Cookie = cookie;
    const req = http.request({ hostname: '127.0.0.1', port: server.port, path,
      method: body ? 'POST' : 'GET', headers, agent: new http.Agent({ keepAlive: false }) }, (res) => {
      let text = '';
      res.on('data', (chunk) => {
        text += chunk;
        if (stream && text.includes('event: state')) {
          resolve({ status: res.statusCode, headers: res.headers, text });
          req.destroy();
        }
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('请求超时：' + path)));
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    assert.equal((await request('/api/me')).status, 401);
    assert.equal((await request('/?t=expired')).status, 403);
    assert.equal((await request('/api/pair', { body: { code: 'wrong' } })).status, 403);
    const paired = await request('/api/pair', { body: { code: server.code } });
    assert.equal(paired.status, 200);
    const cookie = paired.headers['set-cookie'][0].split(';')[0];
    assert.equal((await request('/api/me', { cookie })).status, 200);
    server.broadcast({ live: true, page: 0, total: 2, slide: { t: '第一页', text: '台词' } });
    const stream = await request('/api/events', { cookie, stream: true });
    assert.match(stream.text, /第一页/);
    await request('/api/cmd', { cookie, body: { cmd: 'next' } });
    assert.deepEqual(commands, [{ cmd: 'next' }]);
    const qr = await request('/?t=' + server.token);
    assert.equal(qr.status, 302);
    assert.ok(qr.headers['set-cookie']);
    server.reset();
    assert.equal((await request('/api/me', { cookie })).status, 401);
  } finally { await server.stop(); }
});

test('遥控默认端口被占用时只启动一个保活定时器，关闭后全部释放', async () => {
  const http = require('node:http');
  const { RemoteServer } = require('../src/remote');
  const occupied = http.createServer();
  const ownsPort = await new Promise((resolve) => {
    occupied.once('error', () => resolve(false));
    occupied.listen(18899, '0.0.0.0', () => resolve(true));
  });
  const originalSet = global.setInterval;
  const originalClear = global.clearInterval;
  const timers = new Set();
  global.setInterval = (...args) => { const handle = originalSet(...args); timers.add(handle); return handle; };
  global.clearInterval = (handle) => { timers.delete(handle); originalClear(handle); };
  const server = new RemoteServer({ onCommand() {}, onChange() {} });
  try {
    await server.start();
    assert.notEqual(server.port, 18899);
    assert.equal(timers.size, 1);
    await server.stop();
    assert.equal(timers.size, 0);
  } finally {
    if (server.enabled) await server.stop();
    for (const handle of timers) originalClear(handle);
    global.setInterval = originalSet;
    global.clearInterval = originalClear;
    if (ownsPort) await new Promise((resolve) => occupied.close(resolve));
  }
});

test('扫码仅接受带配对令牌的遥控链接，取消以外的无关二维码给中文提示', () => {
  const { normalizeScanResult } = require('../mobile/www/connection');
  assert.equal(normalizeScanResult('http://192.168.1.2:18899/?t=token'), 'http://192.168.1.2:18899/?t=token');
  for (const value of ['hello', 'https://example.com/', 'https://example.com/path?t=abc', 'javascript://foo?t=x']) {
    assert.throws(() => normalizeScanResult(value), /请扫描 DeckStage/);
  }
});

test('扫码成功走公共连接路径；取消不连接，无关码和权限失败显示中文错误', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const { normalizeAddress, normalizeScanResult } = require('../mobile/www/connection');
  async function scenario(result, scanError) {
    const elements = Object.fromEntries(['address', 'error', 'connect', 'scan', 'connectForm'].map(id => [id, { value: '', textContent: '', disabled: false, addEventListener() {} }]));
    const connections = [];
    const saved = new Map();
    const plugin = {
      scan: async () => { if (scanError) throw new Error(scanError); return result; },
      connect: async ({ url }) => connections.push(url)
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../mobile/www/app.js'), 'utf8'), {
      document: { getElementById: id => elements[id] },
      window: { Capacitor: { Plugins: { DeckStageRemote: plugin } } },
      DeckStageConnection: { normalizeAddress, normalizeScanResult }, URL,
      localStorage: { getItem: () => '', setItem: (k, v) => saved.set(k, v) }
    });
    await elements.scan.onclick();
    return { elements, connections, saved };
  }
  const success = await scenario({ url: 'http://192.168.1.2:18899/?t=abc', cancelled: false });
  assert.deepEqual(success.connections, ['http://192.168.1.2:18899/?t=abc']);
  assert.equal(success.saved.get('deckstage.computer'), 'http://192.168.1.2:18899');
  assert.equal(success.elements.scan.disabled, false);
  const cancel = await scenario({ cancelled: true });
  assert.equal(cancel.connections.length, 0);
  assert.equal(cancel.elements.error.textContent, '');
  const unrelated = await scenario({ cancelled: false, url: 'hello' });
  assert.match(unrelated.elements.error.textContent, /请扫描 DeckStage/);
  assert.equal(unrelated.connections.length, 0);
  const denied = await scenario(null, '相机权限未开启');
  assert.match(denied.elements.error.textContent, /相机权限未开启/);
  assert.equal(denied.elements.scan.disabled, false);
});
