'use strict';
// 手机遥控服务：绑 0.0.0.0，局域网内的手机浏览器打开地址就能翻页、看台词。
//   GET  /            遥控页（?t=令牌 免输配对码，二维码用这个）
//   POST /api/pair    提交 6 位配对码，换设备 cookie
//   GET  /api/events  SSE，推送放映状态
//   POST /api/cmd     next / prev / goto / black
// 安全：默认关闭；每次开启生成新令牌和配对码；每台设备独立 cookie，可单独断开；配对码按 IP 限速。
// 局域网内是明文 HTTP，只适合可信 Wi-Fi。
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { serveFile, send } = require('./server');
const { lanAddresses, uaLabel } = require('./util');

const ASSET_DIR = path.join(__dirname, 'remote');
const ASSETS = { '/remote.css': 'remote.css', '/remote.js': 'remote.js' };
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

class RemoteServer {
  constructor({ onCommand, onChange }) {
    this.onCommand = onCommand;
    this.onChange = onChange;
    this.srv = null;
    this.port = 0;
    this.token = '';
    this.code = '';
    this.devices = new Map(); // sid -> { ua, ip, at }
    this.conns = new Set();   // SSE 连接 { res, sid }
    this.fails = new Map();   // ip -> { n, until }
    this.lastState = null;
    this.keepAlive = null;
  }

  get enabled() { return !!this.srv; }

  start() {
    if (this.srv) return Promise.resolve();
    this.renew();
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this.handle(req, res));
      const listen = (port) => {
        srv.once('error', (e) => {
          if (e.code === 'EADDRINUSE' && port !== 0) return listen(0);
          reject(e);
        });
        srv.listen(port, '0.0.0.0', () => {
          this.srv = srv;
          this.port = srv.address().port;
          this.keepAlive = setInterval(() => this.write(': ping\n\n'), 15000);
          resolve();
        });
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
    const svg = await QRCode.toString(link, { type: 'svg', margin: 1, color: { dark: '#121212', light: '#FAF8F3' } });
    const online = new Set([...this.conns].map((c) => c.sid));
    return {
      enabled: true,
      base,
      urls,
      code: this.code,
      qr: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg),
      devices: [...this.devices].map(([id, d]) => ({ id, label: uaLabel(d.ua), ip: d.ip, online: online.has(id) }))
    };
  }

  // 给列表用的轻量摘要，不含二维码
  summary() {
    const online = new Set([...this.conns].map((c) => c.sid));
    return { enabled: this.enabled, devices: this.devices.size, online: online.size };
  }

  broadcast(state) {
    this.lastState = state;
    this.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
  }

  write(chunk) {
    for (const c of this.conns) { try { c.res.write(chunk); } catch (e) { this.conns.delete(c); } }
  }

  // ---------- 请求处理 ----------

  sidOf(req) {
    const m = new RegExp(`(?:^|; )${COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
    return m && this.devices.has(m[1]) ? m[1] : null;
  }

  newDevice(req) {
    const sid = rand(12);
    this.devices.set(sid, { ua: req.headers['user-agent'] || '', ip: req.socket.remoteAddress.replace('::ffff:', ''), at: Date.now() });
    this.onChange();
    return `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
  }

  async handle(req, res) {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;

    if (req.method === 'GET' && p === '/') {
      const t = u.searchParams.get('t');
      if (t) {
        if (!same(t, this.token)) return send(res, 403, '二维码已失效，请在电脑上重新扫码或输入配对码。', { 'Content-Type': 'text/plain; charset=utf-8' });
        return send(res, 302, '', { Location: '/', 'Set-Cookie': this.newDevice(req) });
      }
      return serveFile(req, res, path.join(ASSET_DIR, 'index.html'));
    }
    if (req.method === 'GET' && ASSETS[p]) return serveFile(req, res, path.join(ASSET_DIR, ASSETS[p]));

    if (req.method === 'GET' && p === '/api/me') return this.sidOf(req) ? json(res, 200, { ok: true }) : json(res, 401, { error: 'auth' });

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

    if (req.method === 'GET' && p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      const conn = { res, sid };
      this.conns.add(conn);
      if (this.lastState) res.write(`event: state\ndata: ${JSON.stringify(this.lastState)}\n\n`);
      req.on('close', () => { this.conns.delete(conn); this.onChange(); });
      this.onChange();
      return;
    }

    if (req.method === 'POST' && p === '/api/cmd') {
      const body = await readJson(req);
      if (!body || typeof body.cmd !== 'string') return json(res, 400, { error: 'bad' });
      const ok = await this.onCommand(body);
      return json(res, 200, { ok: ok !== false });
    }

    return send(res, 404, 'Not found');
  }
}

module.exports = { RemoteServer };
