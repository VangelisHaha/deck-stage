'use strict';
// 菜单栏。投屏位置是动态的，每次放映状态变化都重建。
// 单字母快捷键（F/D/B/P）由放映窗口自己的 before-input-event 处理，菜单里只展示，不注册（registerAccelerator: false）。
const { Menu, app } = require('electron');

function buildMenu({ presentation, hotReload, actions }) {
  const live = !!presentation;
  const shown = (label, accelerator, click) => ({ label, accelerator, registerAccelerator: false, enabled: live, click });

  const stageMenu = [
    {
      label: '投屏到',
      enabled: live,
      submenu: live
        ? presentation.targets().map((t) => ({
            label: t.label, type: 'radio', checked: t.checked, click: () => presentation.applyTarget(t)
          }))
        : []
    },
    shown('全屏 / 窗口切换', 'F', () => presentation.toggleFullscreen()),
    shown('换到下一块屏幕', 'D', () => presentation.nextDisplay()),
    shown('黑屏', 'B', () => presentation.toggleBlackout()),
    shown('聚焦演讲者窗口', 'P', () => presentation.focusPresenter()),
    { type: 'separator' },
    { label: '清缓存并重载', accelerator: 'CmdOrCtrl+R', enabled: live, click: () => presentation.reload() },
    {
      label: '文件变更自动刷新', type: 'checkbox', checked: !!hotReload,
      click: (item) => actions.setHotReload(item.checked)
    },
    { label: '导出 PPTX…', enabled: live, click: () => presentation.exportPptx() },
    { type: 'separator' },
    { label: '手机遥控…', accelerator: 'CmdOrCtrl+K', click: actions.showRemote }
  ];

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: '关于 DeckStage' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 DeckStage' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: '退出 DeckStage' }
      ]
    },
    {
      label: '文件',
      submenu: [
        { label: '打开稿子文件夹…', accelerator: 'CmdOrCtrl+O', click: actions.openDeckDialog },
        { label: '添加稿库目录…', click: actions.addRootDialog },
        { type: 'separator' },
        { label: '结束放映', accelerator: 'CmdOrCtrl+W', enabled: live, click: () => presentation.end() }
      ]
    },
    { label: '编辑', role: 'editMenu' },
    { label: '放映', submenu: stageMenu },
    { label: '窗口', role: 'windowMenu' },
    {
      label: '帮助',
      submenu: [
        { label: '检查更新…', click: actions.checkForUpdates },
        { label: 'GitHub 发布页', click: actions.openReleases },
        { type: 'separator' },
        { label: '新建 / 编辑（安装 skill）…', click: actions.showSkills },
        { label: '打开配置文件夹', click: actions.openConfigDir }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
