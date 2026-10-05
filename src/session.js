'use strict';
// 一次放映：内置服务 + 观众窗口 + 演讲者窗口 + 投屏布局 + 防息屏 + 可选热刷新。
const fs = require('fs');
const path = require('path');
const { BrowserWindow, Notification, app, powerSaveBlocker, screen, session, shell } = require('electron');
const { startServer } = require('./server');
const { fitWindow16x9, stablePort } = require('./util');

const PRELOAD = path.join(__dirname, 'deck-preload.js');
const sameRect = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const BG = { audience: '#000000', presenter: '#0F0F0E' };

class Presentation {
  constructor(root, { onEnd, onChange }) {
    this.root = root;
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
  }

  async start(hotReload) {
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
        if (this.target.mode === 'screen') {
          e.preventDefault();
          this.applyTarget({ mode: 'window', displayId: this.target.displayId });
        }
        break;
      default: break;
    }
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
    this.audience.webContents.executeJavaScript(
      "(function(){var b=document.getElementById('btnPptx');if(b){b.click();return true;}return false;})()"
    ).then((ok) => { if (!ok) this.notify('这份稿子没有导出按钮'); });
  }

  notify(body) {
    if (Notification.isSupported()) new Notification({ title: 'DeckStage', body, silent: true }).show();
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
    this.onEnd();
  }
}

// 导出 PPTX 等下载：直接存到「下载」目录，完成后在 Finder 里定位
function installDownloadHandler() {
  session.defaultSession.on('will-download', (_e, item) => {
    const target = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(target);
    item.once('done', (_ev, state) => { if (state === 'completed') shell.showItemInFolder(target); });
  });
}

module.exports = { Presentation, installDownloadHandler };
