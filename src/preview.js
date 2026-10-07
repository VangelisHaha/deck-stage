'use strict';
// 稿库里的「预览」：放映之前，把稿子在屏幕外渲染一遍，取出目录（每页标题）和每页缩略图。
// 缩略图和目录缓存在 userData/preview/<稿子哈希>/<修改时间>/，稿子没改就直接读缓存，改了才重画。
// 只在稿库里用：不启动稿子的后台服务，也不占放映用的端口（单独起一个临时静态服务）。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { BrowserWindow, app } = require('electron');
const { startServer } = require('./server');
const { latestMtime } = require('./util');

const THUMB_W = 1280; // 够放大看清；列表里的小图是同一张缩小显示
const CACHE_V = 'v2'; // 渲染方式改了就加一，旧缓存自然失效
const PAGE_W = 1600;
const PAGE_H = 900;
const HIDE_CSS = `
#tools, #toast, #dots, #stage .footer { display: none !important; }
.an, .an * { animation: none !important; transition: none !important; }
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Previews {
  constructor({ onUpdate, canRender }) {
    this.onUpdate = onUpdate || (() => {});
    this.canRender = canRender || (() => true);
    this.jobs = new Map(); // 稿子目录 → 正在跑的任务
    this.failed = new Map(); // 稿子目录 → { key: 缓存目录, message }，同一版本失败后不再反复重试
    this.queue = Promise.resolve();
  }

  cacheDir(dir) {
    const key = crypto.createHash('sha1').update(dir).digest('hex').slice(0, 12);
    return path.join(app.getPath('userData'), 'preview', key, `${CACHE_V}-${Math.floor(latestMtime(dir))}`);
  }

  read(dir) {
    const base = this.cacheDir(dir);
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(path.join(base, 'meta.json'), 'utf8')); } catch (e) { return null; }
    const slides = meta.slides.map((title, i) => {
      const f = path.join(base, `${String(i + 1).padStart(3, '0')}.jpg`);
      return { i, title, thumb: fs.existsSync(f) ? `file://${f.split('/').map(encodeURIComponent).join('/')}` : null };
    });
    return { title: meta.title, total: slides.length, minutes: meta.minutes, slides, done: slides.every((s) => s.thumb) };
  }

  // 给界面用：有缓存就返回缓存，没有（或没画完）就排队去画
  get(dir) {
    const cached = this.read(dir);
    if (cached && cached.done) return { state: 'ready', ...cached };
    const fail = this.failed.get(dir);
    if (fail && fail.key === this.cacheDir(dir)) return { state: 'error', message: fail.message, ...(cached || {}) };
    if (!this.canRender()) return { state: 'busy', ...(cached || {}) };
    this.start(dir);
    return { state: 'working', ...(cached || {}) };
  }

  start(dir) {
    if (this.jobs.has(dir)) return;
    const job = this.queue.then(() => { this.failed.delete(dir); return this.render(dir); }).catch((e) => { this.failed.set(dir, { key: this.cacheDir(dir), message: (e && e.message) || '渲染失败' }); }).then(() => { this.jobs.delete(dir); this.onUpdate(dir); });
    this.jobs.set(dir, job);
    this.queue = job;
  }

  async render(dir) {
    const base = this.cacheDir(dir);
    fs.mkdirSync(base, { recursive: true });
    let server = null;
    let win = null;
    try {
      server = await startServer(dir, 0);
      win = new BrowserWindow({
        show: false, width: PAGE_W, height: PAGE_H, useContentSize: true, frame: false, enableLargerThanScreen: true,
        webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
      });
      const wc = win.webContents;
      wc.setFrameRate(8);
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
      await wc.loadURL(`${server.origin}/index.html`);
      await wc.insertCSS(HIDE_CSS);
      await wc.executeJavaScript("document.body.classList.add('exporting')"); // 和导出 PPTX 一样直接显示每页的终态（动效不用等）
      // 等稿子的脚本把页面搭起来
      let info = null;
      for (let i = 0; i < 40 && !info; i += 1) {
        info = await wc.executeJavaScript(`(() => {
          const s = [...document.querySelectorAll('#slides > .slide')];
          if (!s.length || typeof window.__go !== 'function') return null;
          const notes = window.__NOTES || {};
          const secs = Object.values(notes).reduce((a, n) => a + ((n && n.sec) || 0), 0);
          return { title: document.title, slides: s.map((x, i) => x.dataset.t || ('第 ' + (i + 1) + ' 页')), secs };
        })()`).catch(() => null);
        if (!info) await sleep(150);
      }
      if (!info) throw new Error('稿子没有加载出来');
      fs.writeFileSync(path.join(base, 'meta.json'), JSON.stringify({
        title: info.title, slides: info.slides, minutes: info.secs ? Math.round(info.secs / 60) : 0
      }));
      this.onUpdate(dir);
      await sleep(400); // 图位、字体装载
      for (let i = 0; i < info.slides.length; i += 1) {
        const out = path.join(base, `${String(i + 1).padStart(3, '0')}.jpg`);
        if (fs.existsSync(out)) continue;
        await wc.executeJavaScript(`window.__go(${i}, true)`);
        await sleep(160);
        const img = await wc.capturePage();
        if (img.isEmpty()) continue;
        fs.writeFileSync(out, img.resize({ width: THUMB_W, quality: 'good' }).toJPEG(78));
        this.onUpdate(dir);
      }
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
      if (server) await server.close();
      this.prune(dir);
    }
  }

  // 同一份稿子只留当前这一版缓存，旧版本（修改时间不同）删掉
  prune(dir) {
    try {
      const parent = path.dirname(this.cacheDir(dir));
      const keep = path.basename(this.cacheDir(dir));
      for (const name of fs.readdirSync(parent)) {
        if (name !== keep) fs.rmSync(path.join(parent, name), { recursive: true, force: true });
      }
    } catch (e) { /* 清不掉就留着 */ }
  }
}

module.exports = { Previews };
