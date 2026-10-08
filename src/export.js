'use strict';
// 导出：稿库里直接把一份稿子导出成 ZIP 或 PPTX（逐页截图）。
// ZIP = 稿子目录 + 一份「浏览器打开.html」（内核拷进 _deckstage/、片段已展开），没装 DeckStage 的人也能用浏览器放。
// PPTX 复用内核的导出逻辑：在后台隐藏窗口里加载稿子，调 window.__deckExport()，读进度，拿到下载。
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { BrowserWindow, app, session, shell } = require('electron');
const { startServer } = require('./server');
const { KERNEL_DIR, KERNEL_PREFIX, readPage } = require('./kernel');
const { deckLabel } = require('./util');

const SKIP_NAMES = new Set(['.DS_Store', '.git', 'node_modules', 'Thumbs.db']);
const EXPORT_TIMEOUT_MS = 10 * 60 * 1000;

// 稿子内核导出时每页存成 PNG，几十页能到几十 MB。导出前把页面里 canvas 的 PNG 输出改成 JPEG：
// 幻灯片以纯色和渐变为主，JPEG 体积小一个数量级。html2canvas 带了底色，不会有透明区域。
const JPEG_QUALITY = 0.85;
const JPEG_PATCH_JS = `(function(){
  if (HTMLCanvasElement.prototype.__dsJpeg) return;
  var orig = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.__dsJpeg = true;
  HTMLCanvasElement.prototype.toDataURL = function(type, q){
    return (!type || type === 'image/png') ? orig.call(this, 'image/jpeg', ${JPEG_QUALITY}) : orig.apply(this, arguments);
  };
})()`;

// 调内核的导出；返回 false 说明页面里没有内核
const START_EXPORT_JS = "(function(){if(typeof window.__deckExport!=='function')return false;window.__deckExport();return true;})()";

// 后台导出窗口的下载要存到用户选的路径；放映中的「导出 PPTX」不在这里登记，走默认的下载目录
const downloadTargets = new Map(); // webContents.id -> { dest, done(err) }

function installDownloadHandler() {
  session.defaultSession.on('will-download', (_e, item, wc) => {
    const job = downloadTargets.get(wc.id);
    if (job) {
      item.setSavePath(job.dest);
      item.once('done', (_ev, state) => job.done(state === 'completed' ? null : new Error('下载失败：' + state)));
      return;
    }
    const target = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(target);
    item.once('done', (_ev, state) => { if (state === 'completed') shell.showItemInFolder(target); });
  });
}

const STANDALONE = '浏览器打开.html';
const STANDALONE_README = `这份稿子有两种放法：

1. 装了 DeckStage：把整个文件夹加进 DeckStage 的稿库（或拖进去），双击放映。
2. 没装 DeckStage：用 Chrome / Edge 打开「${STANDALONE}」。
   F 全屏 · P 打开演讲者视图（台词、计时）· ← → 翻页
`;

async function exportZip(root, dest) {
  const zip = new AdmZip();
  const base = deckLabel(root);
  zip.addLocalFolder(root, base, (name) => !name.split('/').some((part) => SKIP_NAMES.has(part)));
  // 浏览器版：片段展开、内核改成相对路径，内核拷进 _deckstage/（导出 PPTX 的库用不到，不带）
  const page = readPage(path.join(root, 'index.html'), root).split(KERNEL_PREFIX).join('_deckstage/');
  zip.addFile(`${base}/${STANDALONE}`, Buffer.from(page, 'utf8'));
  for (const f of ['deck.css', 'deck.js']) zip.addLocalFile(path.join(KERNEL_DIR, f), `${base}/_deckstage`);
  zip.addFile(`${base}/打开方式.txt`, Buffer.from(STANDALONE_README, 'utf8'));
  await zip.writeZipPromise(dest);
}

async function exportPptx(root, dest, onProgress) {
  const server = await startServer(root, 0);
  const win = new BrowserWindow({
    show: false,
    width: 1600,
    height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, spellcheck: false }
  });
  const wc = win.webContents;
  const downloaded = new Promise((resolve, reject) => { downloadTargets.set(wc.id, { dest, done: (err) => (err ? reject(err) : resolve()) }); });
  downloaded.catch(() => {}); // 失败由下面的轮询统一抛出，避免未处理的 rejection

  try {
    await win.loadURL(`${server.origin}/index.html`);
    await new Promise((r) => setTimeout(r, 800)); // 等素材装载
    await wc.executeJavaScript(JPEG_PATCH_JS);
    const started = await wc.executeJavaScript(START_EXPORT_JS);
    if (!started) throw new Error('稿子没有加载出内核（index.html 要引用 /_deckstage/deck.js）');

    const deadline = Date.now() + EXPORT_TIMEOUT_MS;
    for (;;) {
      if (Date.now() > deadline) throw new Error('导出超时');
      const text = await wc.executeJavaScript("(document.getElementById('toast')||{}).textContent||''");
      if (text) onProgress(text.replace(/[…\s]+$/, ''));
      if (/导出失败/.test(text)) throw new Error(text);
      if (/导出完成/.test(text)) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    await downloaded;
  } finally {
    downloadTargets.delete(wc.id);
    if (!win.isDestroyed()) win.destroy();
    await server.close();
  }
}

module.exports = { exportZip, exportPptx, installDownloadHandler, JPEG_PATCH_JS, START_EXPORT_JS };
