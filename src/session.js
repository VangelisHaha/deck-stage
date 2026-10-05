'use strict';
// 一次放映：内置服务 + 观众窗口 + 演讲者窗口 + 投屏布局 + 防息屏 + 可选热刷新。
const fs = require('fs');
const path = require('path');
const { BrowserWindow, Notification, powerSaveBlocker, screen, session } = require('electron');
const { startServer } = require('./server');
const { JPEG_PATCH_JS } = require('./export');
const { Services } = require('./services');
const { fitWindow16x9, stablePort, readDeckTitle } = require('./util');

const PRELOAD = path.join(__dirname, 'deck-preload.js');
const sameRect = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const BG = { audience: '#000000', presenter: '#0F0F0E' };

class Presentation {
  constructor(root, { onEnd, onChange, confirmServices }) {
    this.root = root;
    this.services = new Services(root, { confirm: confirmServices, notify: (m) => this.notify(m) });
    this.onEnd = onEnd;
    this.onChange = onChange;
    this.server = null;
    this.audience = null;
    this.presenter = null;
    this.target = null;     // { mode: 'screen' | 'window', displayId }
    this.manual = false;    // 用户手动选过投屏位置后，热插拔不再自动改
    this.blackout = false;
    this.ending = false;
    this.blocker = null;
    this.watcher = null;
    this.watchTimer = null;
    this.windowBounds = null;
    this.screenHandlers = [];
    this.displayTimer = null;
    this.lastApply = 0;
    this.lastEsc = 0;
    // 遥控端要用的稿子信息：每页标题、台词、建议用时，以及当前页和计时起点
    this.title = readDeckTitle(root);
    this.slides = [];
    this.cur = 0;
    this.t0 = 0;        // 离开封面开始总计时，和稿子自带的演讲者视图口径一致
    this.pageAt = Date.now();
  }

  async start(hotReload) {
    await this.services.start(); // 稿子自带的后台服务（deckstage.json），先于窗口启动，页面一进来就能连上
    this.server = await startServer(this.root, stablePort(this.root));
    await session.defaultSession.clearCache();
    this.blocker = powerSaveBlocker.start('prevent-display-sleep');

    this.target = this.defaultTarget();
    this.audience = this.makeWindow('audience', `${this.server.origin}/index.html`);
    this.presenter = this.makeWindow('presenter', `${this.server.origin}/index.html?notes=1`);
    this.audience.on('closed', () => this.end());
    this.presenter.on('closed', () => { this.presenter = null; this.onChange(); });

    this.applyTarget(this.target, { manual: false });
    this.audience.once('ready-to-show', () => this.audience.show());
    this.presenter.once('ready-to-show', () => { this.presenter.show(); this.presenter.focus(); });

    this.watchDisplays();
    this.setHotReload(hotReload);
  }

  // ---------- 窗口 ----------

  makeWindow(kind, url) {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      backgroundColor: BG[kind],
      frame: kind !== 'audience',
      title: kind === 'audience' ? '观众视图' : '演讲者视图',
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false
      }
    });
    if (kind === 'audience') win.setAspectRatio(16 / 9);
    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e, u) => {
      if (new URL(u).origin !== this.server.origin) e.preventDefault();
    });
    wc.on('before-input-event', (e, input) => this.onKey(e, input));
    wc.on('did-finish-load', () => this.loadDeckInfo());
    wc.on('did-navigate-in-page', () => this.syncCur());
    win.loadURL(url);
    return win;
  }

  reopenPresenter() {
    if (this.presenter) return this.presenter.focus();
    this.presenter = this.makeWindow('presenter', `${this.server.origin}/index.html?notes=1`);
    this.presenter.on('closed', () => { this.presenter = null; this.onChange(); });
    this.placePresenter();
    this.presenter.once('ready-to-show', () => { this.presenter.show(); this.presenter.focus(); });
    this.onChange();
  }

  focusPresenter() {
    if (!this.presenter) return this.reopenPresenter();
    this.presenter.show();
    this.presenter.focus();
  }

  // ---------- 投屏布局 ----------

  displays() { return screen.getAllDisplays(); }

  displayById(id) { return this.displays().find((d) => d.id === id) || null; }

  defaultTarget() {
    const primary = screen.getPrimaryDisplay();
    const external = this.displays().find((d) => d.id !== primary.id);
    return external
      ? { mode: 'screen', displayId: external.id }
      : { mode: 'window', displayId: primary.id };
  }

  // 菜单和稿库底栏用：可选的投屏位置，windowMode 永远是最后一项
  targets() {
    const list = this.displays().map((d, i) => ({
      id: String(d.id),
      mode: 'screen',
      displayId: d.id,
      label: `屏幕 ${i + 1} · ${d.label || (d.id === screen.getPrimaryDisplay().id ? '内置显示器' : '外接显示器')} ${d.size.width}×${d.size.height}`,
      checked: this.target.mode === 'screen' && this.target.displayId === d.id
    }));
    list.push({
      id: 'window',
      mode: 'window',
      displayId: this.target.displayId,
      label: '窗口模式（共享窗口用）',
      checked: this.target.mode === 'window'
    });
    return list;
  }

  applyTarget(target, { manual = true } = {}) {
    if (manual) this.manual = true;
    const win = this.audience;
    if (!win || win.isDestroyed()) return;
    const display = this.displayById(target.displayId) || screen.getPrimaryDisplay();
    this.target = { mode: target.mode, displayId: display.id };
    this.lastApply = Date.now();

    if (win.isSimpleFullScreen()) win.setSimpleFullScreen(false);
    if (this.target.mode === 'screen') {
      win.setAspectRatio(0);
      win.setBounds(display.bounds);
      win.setSimpleFullScreen(true);
    } else {
      win.setAspectRatio(16 / 9);
      win.setBounds(fitWindow16x9(display.workArea));
    }
    win.webContents.send('stage:fullscreen', this.target.mode === 'screen');
    this.placePresenter();
    this.onChange();
  }

  placePresenter() {
    const win = this.presenter;
    if (!win || win.isDestroyed()) return;
    const audienceDisplay = this.displayById(this.target.displayId) || screen.getPrimaryDisplay();
    if (this.target.mode === 'screen') {
      const other = this.displays().find((d) => d.id !== audienceDisplay.id);
      if (other) {
        const wa = other.workArea;
        return win.setBounds({ x: wa.x + 24, y: wa.y + 24, width: wa.width - 48, height: wa.height - 48 });
      }
    }
    const wa = audienceDisplay.workArea;
    const width = Math.min(960, Math.floor(wa.width * 0.5));
    const height = Math.min(640, Math.floor(wa.height * 0.7));
    win.setBounds({ x: wa.x + wa.width - width - 24, y: wa.y + wa.height - height - 24, width, height });
  }

  toggleFullscreen() {
    if (!this.audience) return;
    const here = screen.getDisplayMatching(this.audience.getBounds());
    this.applyTarget({ mode: this.target.mode === 'screen' ? 'window' : 'screen', displayId: here.id });
  }

  nextDisplay() {
    const list = this.displays();
    if (list.length < 2) return this.notify('只检测到一块屏幕');
    const i = list.findIndex((d) => d.id === this.target.displayId);
    this.applyTarget({ mode: this.target.mode, displayId: list[(i + 1) % list.length].id });
  }

  // 全屏、隐藏菜单栏本身就会触发 display-metrics-changed，所以：
  // 1) 防抖；2) 只在「屏幕数量变了 / 目标屏消失 / 观众窗口位置已偏离目标」时才重排，避免自己触发自己。
  watchDisplays() {
    const handle = () => {
      if (this.ending || !this.audience || this.audience.isDestroyed()) return;
      if (Date.now() - this.lastApply < 1500) return; // 刚排完布局，这批事件是自己引起的
      const display = this.displayById(this.target.displayId);
      if (!display) {
        this.applyTarget({ mode: 'window', displayId: screen.getPrimaryDisplay().id }, { manual: false });
        this.notify('外接屏已断开，观众窗口退回窗口模式');
        return;
      }
      if (!this.manual && this.target.mode === 'window') {
        const next = this.defaultTarget();
        if (next.mode === 'screen') {
          this.applyTarget(next, { manual: false });
          this.notify('检测到外接屏，观众窗口已全屏到外接屏');
          return;
        }
      }
      if (this.target.mode === 'screen' && !sameRect(this.audience.getBounds(), display.bounds)) {
        this.applyTarget(this.target, { manual: false }); // 分辨率变了，按新尺寸重排
      }
    };
    const handler = () => {
      clearTimeout(this.displayTimer);
      this.displayTimer = setTimeout(handle, 400);
    };
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(ev, handler);
      this.screenHandlers.push([ev, handler]);
    }
  }

  // ---------- 快捷键 ----------

  onKey(e, input) {
    if (input.type !== 'keyDown' || input.meta || input.control || input.alt) return;
    switch (input.key.toLowerCase()) {
      case 'f': e.preventDefault(); this.toggleFullscreen(); break;
      case 'd': e.preventDefault(); this.nextDisplay(); break;
      case 'b': e.preventDefault(); this.toggleBlackout(); break;
      case 'p': e.preventDefault(); this.focusPresenter(); break;
      case 'escape':
        e.preventDefault();
        if (this.target.mode === 'screen') {
          this.applyTarget({ mode: 'window', displayId: this.target.displayId });
        } else if (Date.now() - this.lastEsc < 1500) {
          this.end(); // 窗口模式下连按两次 Esc 结束放映
        } else {
          this.lastEsc = Date.now();
          this.notify('再按一次 Esc 结束放映');
        }
        break;
      default: break;
    }
  }

  // 演讲者窗口的光点 / 划线消息转给观众窗口
  relayPointer(msg) {
    if (this.audience && !this.audience.isDestroyed()) this.audience.webContents.send('stage:pointer', msg);
  }

  toggleBlackout() {
    this.blackout = !this.blackout;
    if (this.audience) this.audience.webContents.send('stage:blackout', this.blackout);
    this.onChange();
  }

  // ---------- 重载 / 热刷新 / 导出 ----------

  reload() {
    for (const win of [this.audience, this.presenter]) {
      if (win && !win.isDestroyed()) win.webContents.reloadIgnoringCache();
    }
  }

  setHotReload(on) {
    if (this.watcher) { this.watcher.close(); this.watcher = null; }
    if (!on) return;
    try {
      this.watcher = fs.watch(this.root, { recursive: true }, (_ev, name) => {
        if (name && /(^|\/)(lib|node_modules|\.git)(\/|$)/.test(name)) return;
        clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(() => this.reload(), 300);
      });
    } catch (e) { /* 监听失败不影响放映 */ }
  }

  exportPptx() {
    if (!this.audience) return;
    const wc = this.audience.webContents;
    wc.executeJavaScript(JPEG_PATCH_JS)
      .then(() => wc.executeJavaScript(
        "(function(){var b=document.getElementById('btnPptx');if(b){b.click();return true;}return false;})()"
      ))
      .then((ok) => { if (!ok) this.notify('这份稿子没有导出按钮'); });
  }

  notify(body) {
    if (Notification.isSupported()) new Notification({ title: 'DeckStage', body, silent: true }).show();
  }

  // ---------- 遥控端 ----------

  // 读稿子里已有的数据：data-t 是标题，__NOTES[data-t] 是台词，__cur() 是当前页
  controlWindow() {
    for (const w of [this.presenter, this.audience]) if (w && !w.isDestroyed()) return w;
    return null;
  }

  async loadDeckInfo() {
    const win = this.controlWindow();
    if (!win) return;
    try {
      const raw = await win.webContents.executeJavaScript(`(function(){
        var N = window.__NOTES || {}, S = window.__slides || [];
        return JSON.stringify({
          cur: window.__cur ? window.__cur() : 0,
          slides: Array.prototype.map.call(S, function(x){
            var k = x.dataset.t || '', n = N[k] || {};
            return { t: k, sec: n.sec || 0, text: n.text || '' };
          })
        });
      })()`);
      const info = JSON.parse(raw);
      this.slides = info.slides;
      this.cur = info.cur;
      this.pageAt = Date.now();
      this.onChange();
    } catch (e) { /* 页面还没就绪，下一次加载完成会再读 */ }
  }

  async syncCur() {
    const win = this.controlWindow();
    if (!win) return;
    try {
      const n = await win.webContents.executeJavaScript('window.__cur ? window.__cur() : 0');
      if (n === this.cur) return;
      this.cur = n;
      if (!this.t0 && n > 0) this.t0 = Date.now();
      this.pageAt = Date.now();
      this.onChange();
    } catch (e) { /* 窗口正在关闭 */ }
  }

  remoteState() {
    const cur = this.slides[this.cur] || { t: '', sec: 0, text: '' };
    const next = this.slides[this.cur + 1];
    return {
      live: true,
      deck: this.title,
      page: this.cur,
      total: this.slides.length,
      titles: this.slides.map((x) => x.t),
      slide: cur,
      next: next ? next.t : '',
      t0: this.t0,
      pageAt: this.pageAt,
      now: Date.now(),
      blackout: this.blackout
    };
  }

  // 遥控指令。翻页走稿子自己的 __go，两个窗口靠它原有的同步机制保持一致
  async remoteCommand({ cmd, n }) {
    if (cmd === 'black') { this.toggleBlackout(); return true; }
    const win = this.controlWindow();
    if (!win) return false;
    let expr;
    if (cmd === 'next') expr = 'window.__go(window.__cur() + 1)';
    else if (cmd === 'prev') expr = 'window.__go(window.__cur() - 1)';
    else if (cmd === 'goto' && Number.isInteger(n)) expr = `window.__go(${n})`;
    else return false;
    await win.webContents.executeJavaScript(`(function(){ if (window.__go) { ${expr}; } })()`);
    return true;
  }

  // ---------- 结束 ----------

  async end() {
    if (this.ending) return;
    this.ending = true;
    clearTimeout(this.displayTimer);
    for (const [ev, fn] of this.screenHandlers) screen.removeListener(ev, fn);
    this.setHotReload(false);
    if (this.blocker !== null) powerSaveBlocker.stop(this.blocker);
    for (const win of [this.audience, this.presenter]) {
      if (win && !win.isDestroyed()) { win.removeAllListeners('closed'); win.destroy(); }
    }
    if (this.server) await this.server.close();
    await this.services.stop();
    this.onEnd();
  }
}

module.exports = { Presentation };
