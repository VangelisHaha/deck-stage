'use strict';
// 注入到观众/演讲者窗口的预加载脚本（沙箱内只能用 electron 的 ipcRenderer）。
// 只做「去浏览器痕迹」：隐藏稿子工具条、鼠标自动隐藏、黑屏、窗口模式下的拖动条。不改稿子文件。
const { ipcRenderer } = require('electron');

const CSS = `
body.stage-audience #tools, body.stage-audience #toast { display: none !important; }
html.stage-idle, html.stage-idle * { cursor: none !important; }
#stage-drag { position: fixed; top: 0; left: 30%; right: 30%; height: 18px; z-index: 2147483000; -webkit-app-region: drag; }
html.stage-fs #stage-drag { display: none; }
#stage-black { position: fixed; inset: 0; background: #000; z-index: 2147483646; display: none; }
#stage-black.on { display: block; }
`;
const IDLE_MS = 2000;

window.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  const isPresenter = /[?&]notes\b/.test(location.search);

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  if (isPresenter) return; // 演讲者窗口保持原样，只有观众窗口需要「干净」
  document.body.classList.add('stage-audience');

  const drag = document.createElement('div');
  drag.id = 'stage-drag';
  document.body.appendChild(drag);

  const black = document.createElement('div');
  black.id = 'stage-black';
  document.body.appendChild(black);

  let timer;
  const wake = () => {
    root.classList.remove('stage-idle');
    clearTimeout(timer);
    timer = setTimeout(() => root.classList.add('stage-idle'), IDLE_MS);
  };
  window.addEventListener('mousemove', wake, true);
  wake();

  ipcRenderer.on('stage:blackout', (_e, on) => black.classList.toggle('on', !!on));
  ipcRenderer.on('stage:fullscreen', (_e, on) => root.classList.toggle('stage-fs', !!on));
});
