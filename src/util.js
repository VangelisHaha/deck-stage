'use strict';
// 公共工具：路径、稿子识别、时间格式。主进程各模块共用，不要在别处重复实现。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { includesOf } = require('./kernel');
const { expandHome, resolveLocalPath } = require('./paths');

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

// 稿子目录的判据：有 index.html，且有 notes.js 或 deck.config.js
function isDeckDir(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  return has('index.html') && (has('deck.config.js') || has('notes.js'));
}

// 用户可能选稿子目录，也可能选它的上一层（里面有 slides/）
function resolveDeckRoot(input) {
  const dir = resolveLocalPath(input || '');
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

// 稿子由 include 片段、notes/ 等拆分，只看 index.html 的修改时间会漏，这里取关键位置里最新的
function latestMtime(root) {
  let t = 0;
  const names = ['index.html', 'deck.config.js', 'notes.js', 'acts', 'notes', 'css', 'js'];
  for (const p of [...names.map((n) => path.join(root, n)), ...includesOf(path.join(root, 'index.html'), root)]) {
    try {
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

// 标题转文件名：去掉系统不允许的字符
function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'deck';
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

// 从 Finder / Dock 启动的 App 只有最小的 PATH，找不到 lark-cli、node 之类。
// 用用户的登录 shell 跑一次 env 拿到终端里的环境，启动稿子的后台服务时使用。结果缓存。
let shellEnvPromise = null;
function loginShellEnv() {
  if (process.platform === 'win32') return Promise.resolve(process.env);
  if (!shellEnvPromise) {
    shellEnvPromise = new Promise((resolve) => {
      const BEGIN = '__DECKSTAGE_ENV_BEGIN__';
      const END = '__DECKSTAGE_ENV_END__';
      const shell = process.env.SHELL || '/bin/zsh';
      execFile(shell, ['-ilc', `echo ${BEGIN}; env; echo ${END}`], { timeout: 8000, maxBuffer: 1 << 20 }, (err, out) => {
        const body = !err && out && out.split(BEGIN)[1] ? out.split(BEGIN)[1].split(END)[0] : '';
        const env = {};
        for (const line of body.split('\n')) {
          const i = line.indexOf('=');
          if (i > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0, i))) env[line.slice(0, i)] = line.slice(i + 1);
        }
        resolve(Object.keys(env).length ? Object.assign({}, process.env, env) : process.env);
      });
    });
  }
  return shellEnvPromise;
}

// 识别虚拟网卡 / VPN / 代理隧道（Clash TUN、utun、Docker、虚拟机等），优先把真实局域网 Wi-Fi / 有线网卡排在前面
const VIRTUAL_IFACE_RE = /^(utun|tun|tap|ppp|ipsec|gif|stf|awdl|llw|anpi|lo|docker|br-|veth|virbr|vmnet|vboxnet|wg|tailscale|zt|clash|mihomo)/i;
const VIRTUAL_WIN_RE = /(loopback|vethernet|wsl|hyper-v|clash|mihomo|tun|tap|vpn|tailscale|wireguard|zerotier|vmware|virtualbox)/i;
const PHYSICAL_IFACE_RE = /^(en\d+|eth\d+|wlan\d+|wi-?fi|wlan|ethernet)/i;

function isIgnoredLanIp(ip) {
  // 169.254.x.x 链路本地地址；198.18.0.0/15 是 Clash/Surge 等透明代理 Fake-IP 网段，手机扫了必定连不上
  return /^169\.254\./.test(ip) || /^198\.1[89]\./.test(ip);
}

function isVirtualInterface(name = '') {
  return VIRTUAL_IFACE_RE.test(name) || VIRTUAL_WIN_RE.test(name);
}

function ipSubnetRank(ip) {
  if (/^192\.168\./.test(ip)) return 0;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 1;
  if (/^10\./.test(ip)) return 2;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return 4; // CGNAT / Tailscale
  return 3;
}

function lanInterfaces(interfaces = os.networkInterfaces()) {
  const items = [];
  const seen = new Set();
  for (const [name, list] of Object.entries(interfaces || {})) {
    for (const i of list || []) {
      const family = i.family === 4 ? 'IPv4' : i.family;
      if (family !== 'IPv4' || i.internal || !i.address || isIgnoredLanIp(i.address)) continue;
      if (seen.has(i.address)) continue;
      seen.add(i.address);
      const virtual = isVirtualInterface(name);
      const preferred = !virtual && PHYSICAL_IFACE_RE.test(name);
      items.push({ name, address: i.address, virtual, preferred });
    }
  }
  items.sort((a, b) => {
    if (a.virtual !== b.virtual) return a.virtual ? 1 : -1;
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    const ra = ipSubnetRank(a.address);
    const rb = ipSubnetRank(b.address);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
  // 有真实物理网卡时过滤掉虚拟隧道网卡，避免下拉框里出现一堆连不上的 VPN 地址；只有虚拟网卡时保留兜底
  const hasReal = items.some((x) => !x.virtual);
  return hasReal ? items.filter((x) => !x.virtual) : items;
}

function lanAddresses(interfaces = os.networkInterfaces()) {
  return lanInterfaces(interfaces).map((x) => x.address);
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
  loginShellEnv, lanInterfaces, lanAddresses, uaLabel, safeName,
  expandHome, isDir, isDeckDir, resolveDeckRoot, readDeckTitle, deckLabel,
  latestMtime, stablePort, formatTime, fitWindow16x9
};
