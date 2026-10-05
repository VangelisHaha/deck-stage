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
.stage-end { margin-left: 12px; height: 32px; padding: 0 14px; border: 1px solid #F1EEE6; background: transparent; color: #F1EEE6; font: 12px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing: 1px; cursor: pointer; white-space: nowrap; }
.stage-end.confirm { background: #FF4F1F; border-color: #FF4F1F; color: #121212; }
.stage-end.float { position: fixed; top: 10px; right: 10px; z-index: 2147483000; }
`;
const IDLE_MS = 2000;

// 演讲者窗口的「结束放映」：点一次变橙色要求确认，3 秒内再点才真正结束，防止讲到一半误触
function addEndButton() {
  const btn = document.createElement('button');
  btn.className = 'stage-end';
  btn.type = 'button';
  btn.textContent = '结束放映';
  const host = document.querySelector('#pv .pvtop');
  if (host) host.appendChild(btn); else { btn.classList.add('float'); document.body.appendChild(btn); }
  let timer;
  btn.addEventListener('click', () => {
    if (btn.classList.contains('confirm')) { ipcRenderer.send('stage:end'); return; }
    btn.classList.add('confirm');
    btn.textContent = '再点一次结束';
    timer = setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = '结束放映'; }, 3000);
  });
  btn.addEventListener('blur', () => { clearTimeout(timer); btn.classList.remove('confirm'); btn.textContent = '结束放映'; });
}

window.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  const isPresenter = /[?&]notes\b/.test(location.search);

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  if (isPresenter) {
    addEndButton(); // 演讲者窗口保持原样，只多一个「结束放映」
    return;
  }
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
