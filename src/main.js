'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, screen, shell } = require('electron');
const store = require('./store');
const { scanRoots } = require('./library');
const { Presentation } = require('./session');
const { exportZip, exportPptx, installDownloadHandler } = require('./export');
const { buildMenu } = require('./menu');
const skill = require('./skill');
const { RemoteServer } = require('./remote');
const { isDir, isDeckDir, resolveDeckRoot, readDeckTitle, safeName } = require('./util');
const ssh = require('./ssh');
const connections = require('./connections');
const { RemoteDecks } = require('./remote-decks');
const { createUpdateManager } = require('./updater');
const { normalizePointer, pointerCatalog } = require('./pointer');
const demo = require('./demo');
const defaults = require('./defaults');
const { Previews } = require('./preview');

app.setName('DeckStage');
if (!app.requestSingleInstanceLock()) app.quit();

let library = null;
let presentation = null;
let selectedDir = null;
let updateManager = null;
let toastText = '';
const exporting = new Map(); // 稿子目录 -> 正在导出的状态文字
const pendingUrls = [];

// 远端稿库（SSH）：列表来自扫描缓存，放映 / 导出前再把那一份同步到本机
const remoteDecks = new RemoteDecks({
  onChange: () => pushState(),
  passwordFor: (r) => connections.password(r)
});
const remoteRoots = (roots) => roots.filter(ssh.isRemote);

// 稿库里的预览：放映中不画（占 CPU），其余时候在屏幕外渲染，画好一张推一次给稿库窗口
const previews = new Previews({
  canRender: () => !presentation,
  onUpdate: (dir) => { if (library && !library.isDestroyed()) library.webContents.send('stage:preview-update', dir); }
});

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
    roots: cfg.roots.map((dir) => (ssh.isRemote(dir)
      ? { dir, label: ssh.label(ssh.parseRemote(dir)), exists: true, remote: remoteDecks.rootInfo(dir) }
      : { dir, label: path.basename(dir), exists: isDir(dir), demo: demo.isDemoRoot(dir), default: defaults.isDefaultRoot(dir) })),
    decks: [
      ...scanRoots(cfg.roots.filter((r) => !ssh.isRemote(r) && isDir(r))),
      ...remoteRoots(cfg.roots).flatMap((spec) => remoteDecks.decks(spec))
    ].map((d) => (demo.isDemoRoot(d.root) ? { ...d, demo: true } : d)).sort((a, b) => b.mtime - a.mtime),
    demo: { installed: demo.installed() },
    defaultRoot: defaults.rootDir(),
    recent: cfg.recent.map((r) => r.dir),
    selected: selectedDir,
    plan: planInfo(),
    version: app.getVersion(),
    presenting: !!presentation,
    exporting: Object.fromEntries(exporting),
    remote: remote.summary(),
    toast: toastText,
    pointer: { value: cfg.pointer, ...pointerCatalog() },
    skills: {
      dir: skill.skillDir(),
      prompt: skill.installPrompt({ roots: cfg.roots, defaultRoot: defaults.rootDir() }),
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
    defaults.noteAdded(r.filePaths[0]);
    pushState();
  },
  // 添加远端稿库。input 是表单对象 { host, port, user, password, path }，或 ssh 地址字符串（Agent 通过 deckstage:// 来的）。
  // 流程：首次连接确认主机指纹 → 连一次确认能连上、目录在 → 保存连接和稿库
  async addRemote(input) {
    let r;
    if (typeof input === 'string') {
      r = ssh.parseRemote(input);
      if (!r) return { ok: false, error: '地址格式不对，应为 user@host:/路径 或 ssh://user@host/路径' };
    } else {
      const host = String(input.host || '').trim();
      if (!host || /[\s/]/.test(host)) return { ok: false, error: '主机地址不对，只填主机名或 IP（路径填在下面的目录里）' };
      const port = String(input.port || '').trim();
      if (port && !/^\d{1,5}$/.test(port)) return { ok: false, error: '端口应该是数字' };
      const user = String(input.user || '').trim();
      if (input.password && !user) return { ok: false, error: '用密码登录需要填用户名' };
      let dir = String(input.path || '').trim() || '~';
      if (!/^[/~]/.test(dir)) dir = '~/' + dir;
      if (dir.length > 1) dir = dir.replace(/\/+$/, '') || '/';
      r = { user, host, port: port === '22' ? '' : port, path: dir };
    }
    const spec = ssh.canonical(r);
    const typed = typeof input === 'object' && input.password ? String(input.password) : '';
    r.password = typed || connections.password(r) || '';
    try {
      const hk = await ssh.hostKey(r);
      if (!hk.known && !hk.unreachable) {
        const fp = hk.fingerprints.length ? hk.fingerprints.join('\n') : '（取不到指纹）';
        const ans = await dialog.showMessageBox(library && !library.isDestroyed() ? library : undefined, {
          type: 'question',
          buttons: ['信任并继续', '取消'],
          defaultId: 1,
          cancelId: 1,
          title: '首次连接这台机器',
          message: `首次连接 ${r.host}${r.port ? ':' + r.port : ''}，确认主机指纹`,
          detail: `${fp}\n\n如果不确定这是不是你要连的机器，选取消。选「信任并继续」后，指纹会记入 ${hk.file}。`
        });
        if (ans.response !== 0) return { ok: false, error: '已取消：没有信任这台机器的指纹' };
        ssh.trustHostKey(hk);
      }
      const count = await ssh.probe(r);
      if (r.user || r.password) connections.save({ user: r.user, host: r.host, port: r.port, password: typed });
      store.addRoot(spec);
      remoteDecks.refresh(spec);
      pushState();
      return { ok: true, count };
    } catch (e) {
      return { ok: false, error: e.message };
    }
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
  checkForUpdates() { return updateManager && updateManager.check({ manual: true }); },
  openReleases() { return updateManager && updateManager.openReleasePage(); },
  setHotReload(on) {
    store.update((c) => { c.hotReload = on; });
    if (presentation) presentation.setHotReload(on);
  }
};

// 稿子要启动后台程序时的确认：首次、或命令/脚本内容变化时才问，同意并记住后不再打扰
async function confirmServices({ root, services, fingerprint }) {
  const cfg = store.read();
  if (cfg.trusted && cfg.trusted[root] === fingerprint) return true;
  const own = remoteDecks.owner(root);
  const origin = own ? `来源：远端主机 ${own.host}（${own.remoteDir}），内容已同步到本机，程序会在本机运行。\n\n` : '';
  const detail = origin + services.map((s) => `• ${s.name}\n   ${s.command.join(' ')}`).join('\n');
  const r = await dialog.showMessageBox(library && !library.isDestroyed() ? library : undefined, {
    type: 'question',
    buttons: ['允许并记住', '仅本次允许', '不启动'],
    defaultId: 1,
    cancelId: 2,
    title: '稿子要启动后台程序',
    message: `《${readDeckTitle(root)}》放映时要启动后台程序`,
    detail: `${detail}\n\n程序会以你的身份在这台电脑上运行，放映结束时自动关闭。只有信任这份稿子的来源时才选择允许。`
  });
  if (r.response === 0) store.update((c) => { c.trusted = c.trusted || {}; c.trusted[root] = fingerprint; });
  return r.response !== 2;
}

// 远端稿子：用之前先同步到本机。同步失败但本机已有上次的镜像时，问一句要不要用旧的。返回能不能继续
async function syncRemoteDeck(dir, purpose) {
  if (!remoteDecks.owner(dir)) return true;
  exporting.set(dir, '同步远端…');
  pushState();
  try {
    await remoteDecks.sync(dir);
    return true;
  } catch (e) {
    if (isDeckDir(dir)) {
      const r = await dialog.showMessageBox(library && !library.isDestroyed() ? library : undefined, {
        type: 'warning',
        buttons: [`用本机上次的副本${purpose}`, '取消'],
        defaultId: 1,
        cancelId: 1,
        title: '远端同步失败',
        message: '没能从远端同步最新内容',
        detail: `${e.message}\n\n本机还有上次同步的副本，但可能不是最新的。`
      });
      return r.response === 0;
    }
    dialog.showErrorBox('没能同步远端稿子', e.message);
    return false;
  } finally {
    exporting.delete(dir);
    pushState();
  }
}

async function startPresentation(dir) {
  if (presentation) return presentation.notify('正在放映，先结束当前放映');
  if (exporting.has(dir)) return;
  if (!(await syncRemoteDeck(dir, '放映'))) return;
  if (presentation) return;
  const root = resolveDeckRoot(dir);
  if (!root) return dialog.showErrorBox('不是稿子目录', `${dir}\n里面要有 index.html 和 deck.config.js（或 notes.js）。`);
  store.touchRecent(root);
  const own = remoteDecks.owner(root);
  presentation = new Presentation(root, {
    confirmServices,
    resync: own ? () => remoteDecks.sync(root) : null,
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

// ---------- 导出（稿库里每一行的 ZIP / PPTX） ----------

async function exportDeck(dir, kind) {
  if (exporting.has(dir)) return;
  if (!(await syncRemoteDeck(dir, '导出'))) return;
  const root = resolveDeckRoot(dir);
  if (!root) return toast('找不到这份稿子');
  const ext = kind === 'zip' ? 'zip' : 'pptx';
  const pick = await dialog.showSaveDialog(library, {
    title: kind === 'zip' ? '导出 ZIP' : '导出 PPTX',
    defaultPath: path.join(app.getPath('downloads'), `${safeName(readDeckTitle(root))}.${ext}`),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  });
  if (pick.canceled || !pick.filePath) return;

  const label = kind === 'zip' ? 'ZIP' : 'PPTX';
  const set = (text) => { exporting.set(dir, text); pushState(); };
  set(`导出 ${label}…`);
  try {
    if (kind === 'zip') await exportZip(root, pick.filePath);
    else await exportPptx(root, pick.filePath, (t) => set(t));
    shell.showItemInFolder(pick.filePath);
    toast(`已导出：${path.basename(pick.filePath)}`);
  } catch (e) {
    toast(`导出失败：${e && e.message ? e.message : e}`);
  } finally {
    exporting.delete(dir);
    pushState();
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
      if (target && ssh.isRemote(target)) {
        actions.addRemote(target).then((r) => toast(r.ok ? `已登记远端稿库：${ssh.label(ssh.parseRemote(target))}` : `远端稿库没登记上：${r.error}`));
        break;
      }
      if (!target || !isDir(target)) return toast('Agent 请求登记的目录不存在');
      store.addRoot(path.resolve(target));
      defaults.noteAdded(path.resolve(target));
      toast(`已登记稿库目录：${path.basename(target)}`);
      break;
    }
    case 'open': {
      const root = target && resolveDeckRoot(target);
      if (!root) return toast('Agent 请求打开的稿子不存在');
      // 稿子不在任何已登记的稿库里（比如 Agent 把稿子建在了别处）：把它所在的目录登记进来，否则稿库里找不到它
      if (!store.read().roots.some((r) => !ssh.isRemote(r) && (root === r || root.startsWith(r + path.sep)))) {
        store.addRoot(path.dirname(root));
        toast(`稿子不在稿库里，已登记它所在的目录：${path.basename(path.dirname(root))}`);
      } else {
        toast('Agent 刚更新了一份稿子，已为你选中');
      }
      selectedDir = root; // 只选中，不自动开始放映，避免突然投到大屏
      showLibrary();
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
    width: 1360, height: 760, minWidth: 980, minHeight: 600,
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
  library.on('focus', () => { // 回到窗口时重新扫描，skill 刚生成的稿子会自动出现；远端稿库超过 30 秒没刷新就顺便刷新
    pushState();
    remoteDecks.refreshAll(remoteRoots(store.read().roots), { onlyStale: true });
  });
  library.on('closed', () => { library = null; if (!presentation) app.quit(); });
}

// 演讲者窗口里的「结束放映」按钮（只认放映自己的演讲者窗口发来的消息）
ipcMain.on('stage:end', (e) => {
  if (presentation && presentation.presenter && e.sender === presentation.presenter.webContents) presentation.end();
});
// 演讲者窗口的光点 / 划线：只认放映自己的演讲者窗口，转给观众窗口画
const fromPresenter = (e) => presentation && presentation.presenter && !presentation.presenter.isDestroyed() && e.sender === presentation.presenter.webContents;
ipcMain.on('stage:pointer', (e, msg) => {
  if (fromPresenter(e)) presentation.relayPointer(msg);
});
// 演讲者窗口里正在搜索框打字：放映快捷键（F/D/B/P）先让位
ipcMain.on('stage:typing', (e, on) => { if (fromPresenter(e)) presentation.typing = !!on; });
ipcMain.on('stage:lb-sync', (e, msg) => { if (fromPresenter(e) && msg && typeof msg === 'object') presentation.relayLb(msg); });
ipcMain.on('stage:lightbox', (e, on) => { if (presentation) presentation.setLightbox(e.sender, on); });
ipcMain.on('stage:overlay', (e, on) => { if (fromPresenter(e)) presentation.overlay = !!on; });
// 投屏光标：放映窗口同步读取当前设置；稿库面板保存后，下次创建窗口立即生效
ipcMain.on('stage:pointer-prefs-get', (e) => { e.returnValue = { value: store.read().pointer, ...pointerCatalog() }; });
// 演讲者视图的布局偏好（布局档、分栏比例、台词字号）
ipcMain.on('stage:prefs-get', (e) => { e.returnValue = store.read().presenter || {}; });
ipcMain.on('stage:prefs-set', (e, p) => {
  if (!fromPresenter(e) || !p || typeof p !== 'object') return;
  const clean = { layout: String(p.layout || 'bal'), split: Number(p.split) || 62, font: Number(p.font) || 19 };
  store.update((c) => { c.presenter = clean; });
});
ipcMain.handle('stage:get-state', () => buildState());
ipcMain.handle('stage:pointer-set', (_e, prefs) => {
  const clean = normalizePointer(prefs);
  store.update((c) => { c.pointer = clean; });
  pushState();
  return clean;
});
ipcMain.handle('stage:add-root', () => actions.addRootDialog());
ipcMain.handle('stage:preview-get', (_e, dir, retry) => {
  if (remoteDecks.owner(dir) && !isDeckDir(dir)) return { state: 'remote-unsynced' };
  if (!isDeckDir(dir)) return { state: 'none' };
  if (retry) previews.failed.delete(dir);
  return previews.get(dir);
});
ipcMain.handle('stage:demo-install', () => { demo.install(); toast('已装回示例稿'); });
ipcMain.handle('stage:demo-remove', () => { demo.remove(); toast('示例稿已删除'); });
ipcMain.handle('stage:remove-root', (_e, dir) => { if (demo.isDemoRoot(dir)) { demo.remove(); toast('示例稿已删除'); return; } if (defaults.isDefaultRoot(dir)) { defaults.markRemoved(); pushState(); return; } store.removeRoot(dir); if (ssh.isRemote(dir)) remoteDecks.forget(dir); pushState(); });
ipcMain.handle('stage:add-remote', (_e, input) => actions.addRemote(input));
ipcMain.handle('stage:connections', () => connections.list());
ipcMain.handle('stage:forget-connection', (_e, id) => { connections.remove(id); });
ipcMain.handle('stage:refresh-remote', (_e, spec) => { remoteDecks.refreshAll(spec ? [spec] : remoteRoots(store.read().roots)); });
ipcMain.handle('stage:select', (_e, dir) => { selectedDir = dir; });
ipcMain.handle('stage:export', (_e, dir, kind) => exportDeck(dir, kind));
ipcMain.handle('stage:open', (_e, dir) => startPresentation(dir));
ipcMain.handle('stage:reveal', (_e, dir) => {
  if (remoteDecks.owner(dir) && !isDeckDir(dir)) return toast('这份远端稿子还没同步到本机，放映或导出一次就会同步');
  shell.showItemInFolder(dir);
});
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
app.on('activate', () => { if (presentation) presentation.bringFront(); else showLibrary(); });
app.on('window-all-closed', () => { if (!presentation) app.quit(); });

app.whenReady().then(() => {
  const firstRun = !fs.existsSync(store.file()); // 没有配置文件 = 第一次运行
  if (app.isPackaged) app.setAsDefaultProtocolClient('deckstage');
  // 开发模式没有打包图标，手动设置 dock 图标
  if (!app.isPackaged && app.dock) app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
  installDownloadHandler();
  updateManager = createUpdateManager({
    app,
    dialog,
    shell,
    getWindow: () => library,
    toast
  });
  demo.ensure({ firstRun });
  defaults.ensure();
  ssh.configure({ askpass: path.join(app.getPath('userData'), 'askpass.sh') });
  remoteDecks.load();
  rebuildMenu();
  showLibrary();
  updateManager.start();
  remoteDecks.refreshAll(remoteRoots(store.read().roots));
  handleArgv(process.argv);
  for (const u of pendingUrls.splice(0)) handleUrl(u);
});
