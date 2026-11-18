'use strict';
// 手机遥控与访客同屏服务：绑 0.0.0.0，局域网内的手机/电脑浏览器扫码即可遥控或同步看大屏。
//   GET  /              遥控页（?t=令牌 免输配对码；?v=访客令牌 进入访客大屏）
//   POST /api/pair      提交 6 位配对码，换设备 cookie
//   GET  /api/events    SSE，推送放映状态与实时画面同步事件（光标、划线、灯箱、data-sync）
//   POST /api/cmd       next / prev / goto / black（仅遥控端可用）
//   GET  /deck/*        当前放映稿子的只读舞台资源（已鉴权设备可用；访客端自动屏蔽 notes.js 台词）
//   GET  /_deckstage/*  放映内核资源
// 安全：默认关闭；每次开启生成新令牌和配对码；每台设备独立 cookie，可单独断开；配对码按 IP 限速。
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { makeHandler, serveFile, send } = require('./server');
const { kernelFile } = require('./kernel');
const { lanAddresses, uaLabel } = require('./util');

const ASSET_DIR = path.join(__dirname, 'remote');
const ASSETS = {
  '/remote.css': 'remote.css', '/remote.js': 'remote.js',
  '/visitor.css': 'visitor.css', '/visitor.js': 'visitor.js'
};
const PREFERRED_PORT = 18899;
const COOKIE = 'ds_dev';
const MAX_FAILS = 5;
const LOCK_MS = 60 * 1000;

const rand = (n) => crypto.randomBytes(n).toString('base64url');
const code6 = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2048) { req.destroy(); return resolve(null); }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

function json(res, code, obj, headers = {}) {
  send(res, code, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers));
}

function stripNotesForVisitor(state) {
  if (!state || typeof state !== 'object' || !state.slide || !('text' in state.slide)) return state;
  const { text: _text, ...slide } = state.slide;
  return { ...state, slide };
}

class RemoteServer {
  constructor({ onCommand, onInteraction, onChange, getDeckRoot }) {
    this.onCommand = onCommand;
    this.onInteraction = onInteraction || (() => ({ ok: false, error: '互动暂不可用' }));
    this.onChange = onChange;
    this.getDeckRoot = getDeckRoot || (() => null);
    this.srv = null;
    this.port = 0;
    this.token = '';
    this.visitorToken = '';
    this.code = '';
    this.devices = new Map(); // sid -> { ua, ip, at, role }
    this.conns = new Set();   // SSE 连接 { res, sid }
    this.fails = new Map();   // ip -> { n, until }
    this.lastState = null;
    this.keepAlive = null;
    this.cachedDeck = { root: null, handle: null };
  }

  get enabled() { return !!this.srv; }

  start() {
    if (this.srv) return Promise.resolve();
    this.renew();
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this.handle(req, res));
      const listen = (port) => {
        const onError = (e) => {
          srv.removeListener('listening', onListening);
          if (e.code === 'EADDRINUSE' && port !== 0) return listen(0);
          reject(e);
        };
        const onListening = () => {
          srv.removeListener('error', onError);
          this.srv = srv;
          this.port = srv.address().port;
          this.keepAlive = setInterval(() => this.write(': ping\n\n'), 15000);
          resolve();
        };
        srv.once('error', onError);
        srv.once('listening', onListening);
        srv.listen(port, '0.0.0.0');
      };
      listen(PREFERRED_PORT);
    });
  }

  async stop() {
    if (!this.srv) return;
    clearInterval(this.keepAlive);
    for (const c of this.conns) c.res.end();
    this.conns.clear();
    this.devices.clear();
    const srv = this.srv;
    this.srv = null;
    srv.closeAllConnections();
    await new Promise((r) => srv.close(() => r()));
    this.onChange();
  }

  renew() {
    this.token = rand(16);
    this.visitorToken = rand(16);
    this.code = code6();
  }

  // 重置配对：新令牌 + 新配对码，所有已连设备掉线，要重新扫码
  reset() {
    this.renew();
    for (const c of this.conns) c.res.end();
    this.conns.clear();
    this.devices.clear();
    this.onChange();
  }

  kick(sid) {
    this.devices.delete(sid);
    for (const c of [...this.conns]) if (c.sid === sid) { c.res.end(); this.conns.delete(c); }
    this.onChange();
  }

  async info() {
    if (!this.enabled) return { enabled: false, devices: [] };
    const urls = lanAddresses().map((ip) => `http://${ip}:${this.port}`);
    const base = urls[0] || `http://127.0.0.1:${this.port}`;
    const link = `${base}/?t=${this.token}`;
    const visitorLink = `${base}/?v=${this.visitorToken}`;
    const svg = await QRCode.toString(link, { type: 'svg', margin: 1, color: { dark: '#121212', light: '#FAF8F3' } });
    const visitorSvg = await QRCode.toString(visitorLink, { type: 'svg', margin: 1, color: { dark: '#121212', light: '#FAF8F3' } });
    const online = new Set([...this.conns].map((c) => c.sid));
    return {
      enabled: true,
      base,
      urls,
      code: this.code,
      qr: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg),
      visitorQr: 'data:image/svg+xml;utf8,' + encodeURIComponent(visitorSvg),
      visitorUrl: visitorLink,
      devices: [...this.devices].map(([id, d]) => ({ id, label: uaLabel(d.ua), ip: d.ip, role: d.role || 'remote', online: online.has(id) }))
    };
  }

  // 给列表用的轻量摘要，不含二维码
  summary() {
    const online = new Set([...this.conns].map((c) => c.sid));
    const devices = [...this.devices].map(([id, d]) => ({ id, role: d.role || 'remote', online: online.has(id) }));
    return {
      enabled: this.enabled,
      devices: this.devices.size,
      online: online.size,
      visitors: devices.filter((d) => d.role === 'visitor' && d.online).length,
      remotes: devices.filter((d) => d.role === 'remote' && d.online).length
    };
  }

  roleOf(sid) {
    const d = this.devices.get(sid);
    return (d && d.role) || 'remote';
  }

  broadcast(state) {
    this.lastState = state;
    if (!this.conns.size) return;
    let remoteChunk = null;
    let visitorChunk = null;
    for (const c of this.conns) {
      const isVisitor = this.roleOf(c.sid) === 'visitor';
      if (isVisitor) {
        if (!visitorChunk) visitorChunk = `event: state\ndata: ${JSON.stringify(stripNotesForVisitor(state))}\n\n`;
        this.writeOne(c, visitorChunk);
      } else {
        if (!remoteChunk) remoteChunk = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
        this.writeOne(c, remoteChunk);
      }
    }
  }

  broadcastEvent(event, payload, roleFilter = null) {
    if (!this.conns.size) return;
    const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const c of this.conns) {
      if (roleFilter && this.roleOf(c.sid) !== roleFilter) continue;
      this.writeOne(c, chunk);
    }
  }

  writeOne(conn, chunk) {
    try { conn.res.write(chunk); } catch (e) { this.conns.delete(conn); }
  }

  write(chunk) {
    for (const c of this.conns) this.writeOne(c, chunk);
  }

  deckHandlerFor(root) {
    if (this.cachedDeck.root !== root) {
      this.cachedDeck = { root, handle: makeHandler(root) };
    }
    return this.cachedDeck.handle;
  }

  // ---------- 请求处理 ----------

  sidOf(req) {
    const m = new RegExp(`(?:^|; )${COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
    return m && this.devices.has(m[1]) ? m[1] : null;
  }

  newDevice(req, role = 'remote') {
    const sid = rand(12);
    this.devices.set(sid, { ua: req.headers['user-agent'] || '', ip: (req.socket.remoteAddress || '').replace('::ffff:', ''), at: Date.now(), role });
    this.onChange();
    return `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
  }

  async handle(req, res) {
    let u;
    try { u = new URL(req.url, 'http://x'); } catch (e) { return send(res, 400, 'Bad request'); }
    const p = u.pathname;

    if (req.method === 'GET' && p === '/') {
      const t = u.searchParams.get('t');
      const v = u.searchParams.get('v');
      if (t || v) {
        const visitor = !!v;
        if (!same(visitor ? v : t, visitor ? this.visitorToken : this.token)) return send(res, 403, '二维码已失效，请在电脑上重新生成。', { 'Content-Type': 'text/plain; charset=utf-8' });
        return send(res, 302, '', { Location: visitor ? '/visitor.html' : '/', 'Set-Cookie': this.newDevice(req, visitor ? 'visitor' : 'remote') });
      }
      return serveFile(req, res, path.join(ASSET_DIR, 'index.html'));
    }
    if (req.method === 'GET' && p === '/visitor.html') return serveFile(req, res, path.join(ASSET_DIR, 'visitor.html'));
    if (req.method === 'GET' && ASSETS[p]) return serveFile(req, res, path.join(ASSET_DIR, ASSETS[p]));
    if ((req.method === 'GET' || req.method === 'HEAD') && p.startsWith('/_deckstage/')) {
      let decoded;
      try { decoded = decodeURIComponent(p); } catch (e) { return send(res, 400, 'Bad request'); }
      const kf = kernelFile(decoded);
      if (kf) return serveFile(req, res, kf);
    }

    if (req.method === 'GET' && p === '/api/visitor-info') {
      if (!this.enabled) return json(res, 404, { error: 'disabled' });
      const base = lanAddresses().map((ip) => `http://${ip}:${this.port}`)[0] || `http://127.0.0.1:${this.port}`;
      const svg = await QRCode.toString(`${base}/?v=${this.visitorToken}`, { type: 'svg', margin: 1, color: { dark: '#121212', light: '#FAF8F3' } });
      return json(res, 200, { qr: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), url: `${base}/?v=${this.visitorToken}` });
    }
    if (req.method === 'GET' && p === '/api/me') {
      const sid = this.sidOf(req);
      return sid ? json(res, 200, { ok: true, role: this.roleOf(sid) }) : json(res, 401, { error: 'auth' });
    }

    if (req.method === 'POST' && p === '/api/pair') {
      const ip = req.socket.remoteAddress;
      const f = this.fails.get(ip) || { n: 0, until: 0 };
      if (f.until > Date.now()) return json(res, 429, { error: 'locked' });
      const body = await readJson(req);
      if (!body || !same(String(body.code || ''), this.code)) {
        f.n += 1;
        if (f.n >= MAX_FAILS) { f.n = 0; f.until = Date.now() + LOCK_MS; }
        this.fails.set(ip, f);
        return json(res, 403, { error: 'code' });
      }
      this.fails.delete(ip);
      return json(res, 200, { ok: true }, { 'Set-Cookie': this.newDevice(req) });
    }

    const sid = this.sidOf(req);
    if (!sid) return json(res, 401, { error: 'auth' });

    if ((req.method === 'GET' || req.method === 'HEAD') && (p === '/deck' || p.startsWith('/deck/'))) {
      if (p === '/deck') return send(res, 302, '', { Location: '/deck/index.html' });
      const root = this.getDeckRoot();
      if (!root) return send(res, 404, '等待放映', { 'Content-Type': 'text/plain; charset=utf-8' });
      let sub;
      try { sub = decodeURIComponent(p.slice('/deck'.length)) || '/index.html'; } catch (e) { return send(res, 400, 'Bad request'); }
      if (this.roleOf(sid) === 'visitor' && (sub === '/notes.js' || sub.startsWith('/notes/'))) {
        return send(res, 200, req.method === 'HEAD' ? '' : 'window.__NOTES = {};\n', { 'Content-Type': 'text/javascript; charset=utf-8' });
      }
      req.url = p.slice('/deck'.length) + u.search;
      return this.deckHandlerFor(root)(req, res);
    }

    if (req.method === 'GET' && p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      const conn = { res, sid };
      this.conns.add(conn);
      if (this.lastState) {
        const payload = this.roleOf(sid) === 'visitor' ? stripNotesForVisitor(this.lastState) : this.lastState;
        res.write(`event: state\ndata: ${JSON.stringify(payload)}\n\n`);
      }
      req.on('close', () => { this.conns.delete(conn); this.onChange(); });
      this.onChange();
      return;
    }

    if (req.method === 'POST' && p === '/api/cmd') {
      if (this.roleOf(sid) === 'visitor') return json(res, 403, { error: 'visitor_readonly' });
      const body = await readJson(req);
      if (!body || typeof body.cmd !== 'string') return json(res, 400, { error: 'bad' });
      const ok = await this.onCommand(body);
      return json(res, 200, { ok: ok !== false });
    }

    if (req.method === 'POST' && p === '/api/interaction') {
      const body = await readJson(req);
      if (!body || typeof body.id !== 'string' || typeof body.type !== 'string') return json(res, 400, { error: 'bad' });
      const result = await this.onInteraction({ ...body, sid, role: this.roleOf(sid) });
      return json(res, result && result.ok === false ? 400 : 200, result || { ok: true });
    }

    return send(res, 404, 'Not found');
  }
}

module.exports = { RemoteServer, stripNotesForVisitor };
