'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, screen, shell } = require('electron');
const store = require('./store');
const { scanRoots } = require('./library');
const { Presentation, installDownloadHandler } = require('./session');
const { buildMenu } = require('./menu');
const skill = require('./skill');
const { RemoteServer } = require('./remote');
const { isDir, resolveDeckRoot } = require('./util');

app.setName('DeckStage');
if (!app.requestSingleInstanceLock()) app.quit();

let library = null;
let presentation = null;
let selectedDir = null;
let toastText = '';
const pendingUrls = [];

// 手机遥控：默认关闭，需要时在稿库里手动开启。放映状态变化时广播给所有已连手机。
const remote = new RemoteServer({
  onCommand: (cmd) => (presentation ? presentation.remoteCommand(cmd) : false),
  onChange: () => pushState()
});

function remoteBroadcast() {
  if (remote.enabled) remote.broadcast(presentation ? presentation.remoteState() : { live: false });
}

// ---------- 状态：稿库窗口每次都从这里拉 ----------

function planInfo() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const external = displays.find((d) => d.id !== primary.id);
  return external
    ? { screens: displays.length, text: `观众 → ${external.label || '外接显示器'}，演讲者 → 本机` }
    : { screens: 1, text: '单屏：观众为窗口模式，飞书里共享这个窗口' };
}

function buildState() {
  const cfg = store.read();
  return {
    roots: cfg.roots.map((dir) => ({ dir, label: path.basename(dir), exists: isDir(dir) })),
    decks: scanRoots(cfg.roots.filter(isDir)),
    recent: cfg.recent.map((r) => r.dir),
    selected: selectedDir,
    plan: planInfo(),
    presenting: !!presentation,
    remote: remote.summary(),
    toast: toastText,
    skills: {
      dir: skill.skillDir(),
      prompt: skill.installPrompt({ roots: cfg.roots }),
      agents: cfg.skillAgents
    }
  };
}

function pushState() {
  if (library && !library.isDestroyed()) library.webContents.send('stage:changed');
}

function toast(text) {
  toastText = text;
  pushState();
  setTimeout(() => { if (toastText === text) { toastText = ''; pushState(); } }, 4000);
}

function rebuildMenu() {
  Menu.setApplicationMenu(buildMenu({
    presentation,
    hotReload: store.read().hotReload,
    actions
  }));
}

// ---------- 动作 ----------

const actions = {
  async openDeckDialog() {
    const r = await dialog.showOpenDialog({ title: '选择稿子文件夹', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return;
    const root = resolveDeckRoot(r.filePaths[0]);
    if (!root) return dialog.showErrorBox('不是稿子目录', '稿子目录里要有 index.html 和 deck.config.js（或 notes.js）。');
    startPresentation(root);
  },
  async addRootDialog() {
    const r = await dialog.showOpenDialog({ title: '添加稿库目录', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return;
    store.addRoot(r.filePaths[0]);
    pushState();
  },
  showSkills() {
    showLibrary();
    library.webContents.send('stage:show-skills');
  },
  showRemote() {
    showLibrary();
    library.webContents.send('stage:show-remote');
  },
  openConfigDir() { shell.showItemInFolder(store.file()); },
  setHotReload(on) {
    store.update((c) => { c.hotReload = on; });
    if (presentation) presentation.setHotReload(on);
  }
};

async function startPresentation(dir) {
  if (presentation) return presentation.notify('正在放映，先结束当前放映');
  const root = resolveDeckRoot(dir);
  if (!root) return dialog.showErrorBox('不是稿子目录', `${dir}\n里面要有 index.html 和 deck.config.js（或 notes.js）。`);
  store.touchRecent(root);
  presentation = new Presentation(root, {
    onChange: () => { rebuildMenu(); pushState(); remoteBroadcast(); },
    onEnd: () => {
      presentation = null;
      rebuildMenu();
      showLibrary();
      pushState();
      remoteBroadcast();
    }
  });
  try {
    await presentation.start(store.read().hotReload);
    if (library && !library.isDestroyed()) library.hide();
    rebuildMenu();
  } catch (e) {
    const p = presentation;
    presentation = null;
    if (p) p.end();
    dialog.showErrorBox('放映启动失败', String(e && e.message ? e.message : e));
  }
}

// ---------- deckstage:// 协议：Agent 通过 `open "deckstage://…"` 和本应用互动 ----------

function handleUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return; }
  if (u.protocol !== 'deckstage:') return;
  const target = u.searchParams.get('path');
  switch (u.hostname) {
    case 'add-root': {
      if (!target || !isDir(target)) return toast('Agent 请求登记的目录不存在');
      store.addRoot(path.resolve(target));
      toast(`已登记稿库目录：${path.basename(target)}`);
      break;
    }
    case 'open': {
      const root = target && resolveDeckRoot(target);
      if (!root) return toast('Agent 请求打开的稿子不存在');
      selectedDir = root; // 只选中，不自动开始放映，避免突然投到大屏
      showLibrary();
      toast('Agent 刚更新了一份稿子，已为你选中');
      if (u.searchParams.get('play') === '1' && !presentation) startPresentation(root);
      break;
    }
    case 'skill-installed': {
      const agent = (u.searchParams.get('agent') || 'agent').slice(0, 40);
      store.recordAgent(agent);
      toast(`skill 已安装 · ${agent}`);
      break;
    }
    default: break;
  }
}

function handleArgv(argv) {
  for (const a of argv.slice(app.isPackaged ? 1 : 2)) {
    if (a.startsWith('deckstage://')) handleUrl(a);
    else if (fs.existsSync(a)) {
      const root = resolveDeckRoot(a);
      if (root) startPresentation(root);
    }
  }
}

// ---------- 稿库窗口 ----------

function showLibrary() {
  if (library && !library.isDestroyed()) { library.show(); library.focus(); return; }
  library = new BrowserWindow({
    width: 1120, height: 700, minWidth: 900, minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: '#F1EEE6',
    show: false,
    title: 'DeckStage',
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'library-preload.js'),
      contextIsolation: true,
      sandbox: true
    }
  });
  library.loadFile(path.join(__dirname, 'renderer', 'library.html'));
  library.once('ready-to-show', () => library.show());
  library.on('focus', pushState); // 回到窗口时重新扫描，skill 刚生成的稿子会自动出现
  library.on('closed', () => { library = null; if (!presentation) app.quit(); });
}

// 演讲者窗口里的「结束放映」按钮（只认放映自己的演讲者窗口发来的消息）
ipcMain.on('stage:end', (e) => {
  if (presentation && presentation.presenter && e.sender === presentation.presenter.webContents) presentation.end();
});
ipcMain.handle('stage:get-state', () => buildState());
ipcMain.handle('stage:add-root', () => actions.addRootDialog());
ipcMain.handle('stage:remove-root', (_e, dir) => { store.removeRoot(dir); pushState(); });
ipcMain.handle('stage:select', (_e, dir) => { selectedDir = dir; });
ipcMain.handle('stage:open', (_e, dir) => startPresentation(dir));
ipcMain.handle('stage:reveal', (_e, dir) => shell.showItemInFolder(dir));
ipcMain.handle('stage:reveal-skill', () => shell.showItemInFolder(skill.skillDir()));
ipcMain.handle('stage:remote-get', () => remote.info());
ipcMain.handle('stage:remote-toggle', async (_e, on) => {
  if (on) { await remote.start(); remoteBroadcast(); } else await remote.stop();
  pushState();
});
ipcMain.handle('stage:remote-reset', () => remote.reset());
ipcMain.handle('stage:remote-kick', (_e, sid) => remote.kick(sid));
ipcMain.handle('stage:copy', (_e, text) => { clipboard.writeText(String(text)); });

// ---------- 生命周期 ----------

app.on('open-url', (e, url) => {
  e.preventDefault();
  if (app.isReady()) handleUrl(url); else pendingUrls.push(url);
});
app.on('second-instance', (_e, argv) => handleArgv(argv));
app.on('before-quit', () => { remote.stop(); });
app.on('activate', () => { if (!presentation) showLibrary(); });
app.on('window-all-closed', () => { if (!presentation) app.quit(); });

app.whenReady().then(() => {
  if (app.isPackaged) app.setAsDefaultProtocolClient('deckstage');
  // 开发模式没有打包图标，手动设置 dock 图标
  if (!app.isPackaged && app.dock) app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
  installDownloadHandler();
  rebuildMenu();
  showLibrary();
  handleArgv(process.argv);
  for (const u of pendingUrls.splice(0)) handleUrl(u);
});
