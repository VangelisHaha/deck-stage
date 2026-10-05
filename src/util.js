'use strict';
// 公共工具：路径、稿子识别、时间格式。主进程各模块共用，不要在别处重复实现。
const fs = require('fs');
const os = require('os');
const path = require('path');

function expandHome(p) {
  if (!p) return p;
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

// 稿子目录的判据：有 index.html，且有 deck.config.js 或 notes.js（deck-html 骨架的固定文件；早期稿子只有 notes.js）
function isDeckDir(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  return has('index.html') && (has('deck.config.js') || has('notes.js'));
}

// 用户可能选稿子目录，也可能选它的上一层（里面有 slides/）
function resolveDeckRoot(input) {
  const dir = path.resolve(expandHome(input || ''));
  if (!isDir(dir)) return null;
  if (isDeckDir(dir)) return dir;
  const sub = path.join(dir, 'slides');
  return isDeckDir(sub) ? sub : null;
}

function readDeckTitle(root) {
  try {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const m = /<title>([\s\S]*?)<\/title>/i.exec(html);
    if (m && m[1].trim()) return m[1].trim();
  } catch (e) { /* 读不到就用目录名 */ }
  return deckLabel(root);
}

// 目录名是 slides / deck 这类通用名时，用上一层当稿子名
function deckLabel(dir) {
  const base = path.basename(dir);
  return /^(slides|deck|dist)$/i.test(base) ? path.basename(path.dirname(dir)) : base;
}

// 稿子由 acts/、notes/ 拆分，只看 index.html 的修改时间会漏，这里取关键位置里最新的
function latestMtime(root) {
  let t = 0;
  for (const name of ['index.html', 'deck.config.js', 'notes.js', 'acts', 'notes', 'css']) {
    try {
      const p = path.join(root, name);
      const st = fs.statSync(p);
      t = Math.max(t, st.mtimeMs);
      if (st.isDirectory()) {
        for (const f of fs.readdirSync(p)) t = Math.max(t, fs.statSync(path.join(p, f)).mtimeMs);
      }
    } catch (e) { /* 缺哪个跳哪个 */ }
  }
  return t;
}

// 同一份稿子每次落在同一个端口，浏览器侧的 localStorage（计时等）才能延续
function stablePort(seed, base = 18000, span = 1000) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return base + (h % span);
}

const pad2 = (n) => String(n).padStart(2, '0');

function formatTime(ms, now = new Date()) {
  if (!ms) return '';
  const d = new Date(ms);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return `昨天 ${hm}`;
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 16:9 窗口放进某块屏幕的可用区域，左上角留 inset
function fitWindow16x9(workArea, { maxWidth = 1280, widthRatio = 0.62, inset = 40 } = {}) {
  let width = Math.min(maxWidth, Math.floor(workArea.width * widthRatio));
  let height = Math.round((width * 9) / 16);
  const maxH = Math.floor(workArea.height * 0.9);
  if (height > maxH) { height = maxH; width = Math.round((height * 16) / 9); }
  return { x: workArea.x + inset, y: workArea.y + inset, width, height };
}

// 本机局域网 IPv4，私有网段优先（192.168 / 10 / 172.16-31），用来拼手机访问的地址
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  const rank = (ip) => (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(ip) ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

// 设备名：只用于「已连接设备」列表，一眼看出是哪台
function uaLabel(ua = '') {
  if (/iPhone|iPad/.test(ua)) return 'iPhone / iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return '其他设备';
}

module.exports = {
  lanAddresses, uaLabel,
  expandHome, isDir, isDeckDir, resolveDeckRoot, readDeckTitle, deckLabel,
  latestMtime, stablePort, formatTime, fitWindow16x9
};
