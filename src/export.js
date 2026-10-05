'use strict';
// 导出：稿库里直接把一份稿子导出成 ZIP（整个稿子目录）或 PPTX（逐页截图）。
// PPTX 复用稿子内核自带的导出逻辑：在后台隐藏窗口里加载稿子，点它的「导出 PPTX」按钮，读进度，拿到下载。
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { BrowserWindow, app, session, shell } = require('electron');
const { startServer } = require('./server');

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

async function exportZip(root, dest) {
  const zip = new AdmZip();
  const base = path.basename(root) === 'slides' ? path.basename(path.dirname(root)) : path.basename(root);
  zip.addLocalFolder(root, base, (name) => !name.split('/').some((part) => SKIP_NAMES.has(part)));
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
    const started = await wc.executeJavaScript(
      "(function(){var b=document.getElementById('btnPptx');if(!b)return false;b.click();return true;})()"
    );
    if (!started) throw new Error('这份稿子没有导出按钮');

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

module.exports = { exportZip, exportPptx, installDownloadHandler, JPEG_PATCH_JS };
