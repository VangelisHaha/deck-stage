'use strict';

const RELEASES_URL = 'https://github.com/VangelisHaha/deck-stage/releases/latest';

function showMessage(dialog, parent, options) {
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

function createUpdateManager({ app, dialog, shell, getWindow, toast = () => {}, autoUpdater: suppliedUpdater, logger = console }) {
  const autoUpdater = suppliedUpdater || require('electron-updater').autoUpdater;
  let checking = false;
  let downloading = false;
  let manualCheck = false;
  let reportingError = false;
  let started = false;
  let lastProgress = -1;

  const parentWindow = () => {
    const win = getWindow && getWindow();
    return win && !win.isDestroyed() ? win : undefined;
  };

  const openReleasePage = () => shell.openExternal(RELEASES_URL);

  const fail = async (error) => {
    const message = error && error.message ? error.message : String(error || '未知错误');
    logger.warn('DeckStage 自动更新失败：', message);
    const shouldNotify = manualCheck || downloading;
    checking = false;
    downloading = false;
    manualCheck = false;
    if (!shouldNotify || reportingError) return;
    reportingError = true;
    try {
      const result = await showMessage(dialog, parentWindow(), {
        type: 'warning',
        buttons: ['打开发布页', '稍后再试'],
        defaultId: 1,
        cancelId: 1,
        title: '检查更新失败',
        message: '暂时无法完成自动更新',
        detail: `${message}\n\n可以打开 GitHub 发布页手动下载安装包。`
      });
      if (result.response === 0) await openReleasePage();
    } finally {
      reportingError = false;
    }
  };

  const wireEvents = () => {
    if (started) return;
    started = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      checking = true;
      if (manualCheck) toast('正在检查更新…');
    });
    autoUpdater.on('update-available', (info) => {
      checking = false;
      downloading = true;
      manualCheck = false;
      toast(`发现 DeckStage v${info.version}，正在下载…`);
    });
    autoUpdater.on('update-not-available', () => {
      checking = false;
      downloading = false;
      const shouldNotify = manualCheck;
      manualCheck = false;
      if (shouldNotify) showMessage(dialog, parentWindow(), {
        type: 'info',
        buttons: ['好'],
        title: 'DeckStage 已是最新版',
        message: `当前版本 v${app.getVersion()} 已是最新版`
      });
    });
    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.max(0, Math.min(100, Math.floor(progress.percent || 0)));
      if (percent === 100 || percent - lastProgress >= 5) {
        lastProgress = percent;
        toast(`正在下载更新… ${percent}%`);
      }
    });
    autoUpdater.on('update-downloaded', async (info) => {
      downloading = false;
      lastProgress = -1;
      toast(`DeckStage v${info.version} 已下载`);
      const result = await showMessage(dialog, parentWindow(), {
        type: 'info',
        buttons: ['立即重启并安装', '稍后'],
        defaultId: 0,
        cancelId: 1,
        title: '更新已准备好',
        message: `DeckStage v${info.version} 已下载完成`,
        detail: '重启应用即可完成安装。选择“稍后”时，将在退出应用后自动安装。'
      });
      if (result.response === 0) autoUpdater.quitAndInstall(false, true);
    });
    autoUpdater.on('error', (error) => { fail(error); });
  };

  const check = async ({ manual = true } = {}) => {
    wireEvents();
    if (!app.isPackaged) {
      if (manual) await showMessage(dialog, parentWindow(), {
        type: 'info',
        buttons: ['好'],
        title: '开发模式',
        message: '自动更新只在安装版中启用',
        detail: `当前开发版本为 v${app.getVersion()}。`
      });
      return false;
    }
    if (checking) {
      if (manual) toast('已经在检查更新…');
      return false;
    }
    manualCheck = manual;
    checking = true;
    try {
      await autoUpdater.checkForUpdates();
      return true;
    } catch (error) {
      await fail(error);
      return false;
    }
  };

  const start = () => {
    wireEvents();
    if (!app.isPackaged) return;
    const timer = setTimeout(() => { check({ manual: false }); }, 3000);
    if (timer.unref) timer.unref();
  };

  return { start, check, openReleasePage, releasesUrl: RELEASES_URL };
}

module.exports = { createUpdateManager, RELEASES_URL };
