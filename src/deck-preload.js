'use strict';
// 注入到观众/演讲者窗口的预加载脚本（沙箱内使用 electron 的 ipcRenderer，公共画面工具来自预注册的 stage-sync.js）。
// 放映内核（kernel/deck.js）负责翻页、台词、灯箱这些稿子本身的能力；这里只做和 App 相关的部分：
// 鼠标自动隐藏、黑屏、窗口模式下的拖动条；演讲者窗口的大画面布局、目录、光点与划线（经主进程转给观众窗口与访客大屏）；
// 灯箱、data-sync 区块以及内嵌网页（iframe）操作从演讲者窗口同步到观众窗口。
const { ipcRenderer } = require('electron');
const Sync = globalThis.DeckStageSync;

// 演讲者视图的样式开关尽早打上，避免先闪一帧观众视图（内核加载后也会再打一次）
if (/[?&]notes\b/.test(location.search) && document.documentElement) document.documentElement.classList.add('pv');

const CSS = `
body.stage-audience #toast { display: none !important; }
html.stage-idle, html.stage-idle * { cursor: none !important; }
#stage-drag { position: fixed; top: 0; left: 30%; right: 30%; height: 18px; z-index: 2147483000; -webkit-app-region: drag; }
html.stage-fs #stage-drag { display: none; }
#stage-black { position: fixed; inset: 0; background: #000; z-index: 2147483646; display: none; }
#stage-black.on { display: block; }
#stage-visitor-qr, #stage-remote-qr { position: fixed; inset: 0; z-index: 2147483645; display: none; align-items: center; justify-content: center; background: rgba(15,15,14,.94); color: #F1EEE6; }
#stage-visitor-qr.on, #stage-remote-qr.on { display: flex; }
#stage-visitor-qr .qr-card, #stage-remote-qr .qr-card { width: min(420px, 80vw); padding: 28px; background: #F1EEE6; color: #0F0F0E; text-align: center; box-shadow: 0 24px 64px rgba(0,0,0,.55); }
#stage-visitor-qr img, #stage-remote-qr img { width: 260px; height: 260px; display: block; margin: 18px auto; background: #FAF8F3; }
#stage-visitor-qr .qr-title, #stage-remote-qr .qr-title { font: 700 22px Georgia, "Songti SC", serif; }
#stage-visitor-qr .qr-hint, #stage-remote-qr .qr-hint { font: 12px "SF Mono", ui-monospace, Menlo, monospace; color: #666; line-height: 1.6; }
/* 访客二维码角标模式：挂在右下角，不遮挡大屏正文，晚到听众可随时补扫 */
#stage-visitor-qr.corner { display: flex; inset: auto 24px 52px auto; background: transparent; pointer-events: none; }
#stage-visitor-qr.corner .qr-card { width: 156px; padding: 10px 10px 8px; border: 2px solid #0F0F0E; box-shadow: 0 12px 32px rgba(0,0,0,.55); }
#stage-visitor-qr.corner img { width: 132px; height: 132px; margin: 6px auto; }
#stage-visitor-qr.corner .qr-title { font-size: 13px; letter-spacing: .03em; }
#stage-visitor-qr.corner .qr-hint { display: none; }
/* App chrome must win over any deck theme: never let a稿子的 button/reset rule hide the end control. */
#pv .pvtop .stage-end, body > .stage-end { position: fixed !important; top: 10px !important; right: 10px !important; z-index: 2147483647 !important; display: inline-flex !important; visibility: visible !important; opacity: 1 !important; align-items: center !important; justify-content: center !important; margin: 0 !important; height: 34px !important; min-width: 92px !important; padding: 0 14px !important; border: 1px solid #F1EEE6 !important; border-radius: 4px !important; background: #0F0F0E !important; color: #F1EEE6 !important; font: 12px "SF Mono", ui-monospace, Menlo, monospace !important; letter-spacing: 1px !important; line-height: 1 !important; cursor: pointer !important; white-space: nowrap !important; pointer-events: auto !important; }
#pv .pvtop .stage-end.confirm, body > .stage-end.confirm { background: #FF4F1F !important; border-color: #FF4F1F !important; color: #121212 !important; }
#stage-ink { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2147482000; pointer-events: none; }
.stage-end.float { position: fixed !important; top: 10px !important; right: 10px !important; z-index: 2147483647 !important; }
`;
const IDLE_MS = 2000;
const POINTER_DATA = ipcRenderer.sendSync('stage:pointer-prefs-get') || {};

function addQrLayer(id, title, hint) {
  const layer = document.createElement('div');
  layer.id = id;
  layer.innerHTML = `<div class="qr-card"><div class="qr-title">${title}</div><img alt="${title}二维码"><div class="qr-hint">${hint}</div></div>`;
  document.body.appendChild(layer);
  return layer;
}

// 演讲者窗口的「结束放映」：点一次变橙色要求确认，3 秒内再点才真正结束，防止讲到一半误触
function addEndButton() {
  const btn = document.createElement('button');
  btn.className = 'stage-end float';
  btn.type = 'button';
  btn.textContent = '结束放映';
  document.body.appendChild(btn);
  let timer;
  btn.addEventListener('click', () => {
    if (btn.classList.contains('confirm')) { ipcRenderer.send('stage:end'); return; }
    btn.classList.add('confirm');
    btn.textContent = '再点一次结束';
    timer = setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = '结束放映'; }, 3000);
  });
  btn.addEventListener('blur', () => { clearTimeout(timer); btn.classList.remove('confirm'); btn.textContent = '结束放映'; });
}

function blurActiveEditable() {
  const active = document.activeElement;
  if (!active) return;
  if (active.tagName === 'IFRAME' && active.contentWindow) {
    try { active.contentWindow.postMessage({ __dsBlur: 1 }, '*'); } catch (e) { /* 忽略 */ }
  }
  if (typeof active.blur === 'function') active.blur();
}

function initAudienceInk() {
  const canvas = document.createElement('canvas');
  canvas.id = 'stage-ink';
  document.body.appendChild(canvas);
  const stage = () => document.getElementById('stage');
  const ink = Sync.makeInk(canvas, () => (stage() || document.documentElement).getBoundingClientRect(), POINTER_DATA);
  const hover = Sync.makeHoverMirror(stage);
  ipcRenderer.on('stage:pointer', (_e, m) => {
    ink.apply(m);
    if (m.k === 'm') hover.move(m.x, m.y);
    else if (m.k === 'l') hover.clear();
  });
  ipcRenderer.on('stage:pointer-config', (_e, catalog) => {
    if (catalog) ink.setPointer(catalog);
  });
}

function initAudienceIframeReplay() {
  ipcRenderer.on('stage:iframe-sync', (_e, msg) => {
    if (!msg || typeof msg.fi !== 'number') return;
    const frames = Array.from(document.querySelectorAll('#slides iframe'));
    const target = frames[msg.fi];
    if (target && target.contentWindow) {
      try { target.contentWindow.postMessage(Object.assign({ __dsReplay: 1 }, msg), '*'); } catch (e) { /* 忽略已销毁子帧 */ }
    }
  });
}

// ---------- 演讲者窗口：大画面布局 ----------
const LAYOUTS = [
  { id: 'bal', name: '均衡', split: 62, font: 19 },
  { id: 'stage', name: '画面优先', split: 80, font: 16 },
  { id: 'notes', name: '台词优先', split: 40, font: 22 }
];
const FONT_MIN = 12;
const FONT_MAX = 40;

const PV_CSS = `
#pv .pvmain { display: none !important; }
#pv .pvtop { padding-right: 124px !important; }
#ps-main { flex: 1; min-height: 0; display: flex; }
#ps-left { flex: 0 0 calc(var(--ps-split, 62) * 1%); min-width: 0; display: flex; flex-direction: column; }
#ps-area { flex: 1; min-height: 0; position: relative; display: flex; align-items: center; justify-content: center; padding: 12px 6px 8px 14px; }
#ps-box { position: relative; flex: none; overflow: hidden; background: var(--bg0, #0F0F0E); border: 1px solid var(--line2, #333); cursor: crosshair; }
#ps-box #stage { transform: scale(var(--ps-k, .5)) !important; pointer-events: auto; }
#ps-ink { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 90; pointer-events: none; }
#ps-ink.pen { pointer-events: auto; cursor: cell; }
#ps-split { flex: none; width: 7px; cursor: col-resize; position: relative; }
#ps-split::after { content: ""; position: absolute; left: 3px; top: 0; bottom: 0; width: 1px; background: var(--line2, #333); }
#ps-split:hover::after, #ps-split.drag::after { width: 3px; left: 2px; background: #FF4F1F; }
#ps-right { flex: 1; min-width: 0; display: flex; flex-direction: column; }
#ps-right #pvBody { font-size: calc(var(--ps-font, 19) * 1px) !important; }
#ps-ix { flex: none; max-height: 180px; overflow-y: auto; padding: 10px 16px; border-top: 1px solid var(--line, #222); background: rgba(255,255,255,.02); }
#ps-ix[hidden] { display: none !important; }
#ps-ix .ix-hd { display: flex; justify-content: space-between; align-items: center; font: 11px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing: .06em; color: #FF4F1F; margin-bottom: 6px; }
#ps-ix .ix-item + .ix-item { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--line, #222); }
#ps-ix .ix-q { font-size: 13px; font-weight: 600; color: var(--ink, #eee); margin-bottom: 5px; }
#ps-ix .ix-empty { font: 12px "SF Mono", ui-monospace, Menlo, monospace; color: var(--ink4, #888); }
#ps-ix .ix-row { display: grid; grid-template-columns: minmax(72px, 1fr) 1.4fr auto; gap: 8px; align-items: center; font-size: 12px; color: var(--ink2, #ccc); margin-top: 4px; }
#ps-ix .ix-row span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#ps-ix .ix-bar { height: 6px; background: rgba(255,255,255,.08); overflow: hidden; }
#ps-ix .ix-bar i { display: block; height: 100%; background: #FF4F1F; }
#ps-ix .ix-cnt { font: 11px "SF Mono", ui-monospace, Menlo, monospace; color: var(--ink4, #888); }
#ps-next { flex: none; display: flex; gap: 12px; padding: 8px 16px 12px; border-top: 1px solid var(--line, #222); }
#ps-next .nb { flex: 1; min-width: 0; max-width: 300px; }
#ps-next .nb.can-jump { cursor: pointer; }
#ps-next .nb.can-jump:hover .box { border-color: #FF4F1F; }
#ps-next .nb.can-jump:hover .cap { color: var(--ink2, #ccc); }
#pv.lay-stage #ps-next { display: none; }
#ps-next .cap { cursor: inherit; font: 11px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing: .04em; color: var(--ink4, #888); margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#ps-next .box { position: relative; overflow: hidden; width: 100%; aspect-ratio: 16 / 9; border: 1px solid var(--line2, #333); background: var(--bg0, #0F0F0E); transition: border-color .15s; }
#ps-next .mini { position: absolute; left: 0; top: 0; width: var(--deck-w, 1600px); height: var(--deck-h, 900px); transform-origin: 0 0; pointer-events: none; }
#ps-next .mini > .slide { display: flex !important; }
#ps-next .mini .an { animation: none !important; }
#ps-next .ps-media-ph { display: flex !important; align-items: center; justify-content: center; min-height: 120px; border: 1px dashed var(--line2, #444); background: rgba(255,255,255,.03); color: var(--ink4, #888); font: 18px "SF Mono", ui-monospace, Menlo, monospace; padding: 16px; text-align: center; }
#ps-bar { flex: none; display: flex; gap: 8px; align-items: center; padding: 6px 6px 10px 14px; flex-wrap: wrap; }
#ps-bar button { height: 28px; padding: 0 11px; border: 1px solid var(--line2, #333); background: transparent; color: var(--ink3, #aaa); font: 12px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing: .04em; cursor: pointer; white-space: nowrap; }
#ps-bar button:hover { color: var(--ink, #eee); border-color: var(--ink3, #aaa); }
#ps-bar button.on { color: #121212; background: #FF4F1F; border-color: #FF4F1F; }
#ps-bar button.corner { color: #FF4F1F; border-color: #FF4F1F; background: rgba(255,79,31,.12); }
#ps-bar button:disabled { opacity: .4; cursor: default; }
#ps-bar button:disabled:hover { color: var(--ink3, #aaa); border-color: var(--line2, #333); }
#ps-hint { flex: none; padding: 0 8px 10px 14px; font: 12px/1.7 "SF Mono", ui-monospace, Menlo, monospace; letter-spacing: .03em; color: var(--ink4, #888); }
#ps-hint b { color: var(--ink2, #ccc); font-weight: 600; }
#ps-hint.toc { color: #FF4F1F; }
#ps-help { position: absolute; z-index: 130; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(560px, 92%); max-height: 92%; overflow-y: auto; display: none; background: #0F0F0E; border: 1px solid var(--line2, #333); box-shadow: 0 12px 40px rgba(0,0,0,.6); }
#ps-help.on { display: block; }
#ps-help .hd { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--line2, #333); font: 12px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing: .08em; color: var(--ink3, #aaa); }
#ps-help .hd button { border: 0; background: transparent; color: var(--ink3, #aaa); font-size: 13px; cursor: pointer; }
#ps-help h4 { margin: 12px 14px 4px; font: 11px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing: .1em; color: #FF4F1F; }
#ps-help dl { margin: 0; padding: 0 14px 8px; display: grid; grid-template-columns: 150px 1fr; row-gap: 5px; }
#ps-help dt { font: 12px "SF Mono", ui-monospace, Menlo, monospace; color: var(--ink, #eee); }
#ps-help dd { margin: 0; font-size: 13px; color: var(--ink3, #aaa); }
#ps-ptr { position: absolute; z-index: 125; left: 14px; bottom: 10px; width: min(500px, calc(100% - 24px)); display: none; background: #0F0F0E; border: 1px solid var(--line2, #333); box-shadow: 0 12px 40px rgba(0,0,0,.65); padding-bottom: 12px; }
#ps-ptr.on { display: block; }
#ps-ptr .hd { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--line2, #333); font: 11px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing: .08em; color: var(--ink4, #888); }
#ps-ptr .hd button { border: 0; background: transparent; color: var(--ink3, #aaa); font-size: 13px; cursor: pointer; }
#ps-ptr .ptr-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; padding: 10px 12px 8px; }
#ps-ptr .ptr-item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 4px; border: 1px solid var(--line2, #333); background: rgba(255,255,255,.03); color: var(--ink2, #ccc); font-size: 11px; cursor: pointer; }
#ps-ptr .ptr-item:hover { border-color: var(--ink3, #aaa); color: #fff; }
#ps-ptr .ptr-item.on { border-color: #FF4F1F; background: rgba(255,79,31,.15); color: #fff; }
#ps-ptr .ptr-item img { width: 32px; height: 32px; display: block; }
#ps-ptr .ptr-item span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
#ps-ptr .ptr-sizes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 0 12px; }
#ps-ptr .ptr-sz { height: 28px; border: 1px solid var(--line2, #333); background: transparent; color: var(--ink3, #aaa); font: 12px "SF Mono", ui-monospace, Menlo, monospace; cursor: pointer; }
#ps-ptr .ptr-sz.on { background: #FF4F1F; border-color: #FF4F1F; color: #121212; font-weight: 700; }
#ps-toc .tip { flex: none; margin: -2px 10px 8px; font: 11px/1.6 "SF Mono", ui-monospace, Menlo, monospace; color: var(--ink4, #888); }
#ps-bar kbd { opacity: .55; margin-left: 5px; font: inherit; }
#ps-bar .sp { flex: 1; }
#ps-hud { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 120; padding: 6px 14px; background: rgba(18,18,18,.92); border: 1px solid #FF4F1F; color: #F1EEE6; font: 13px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing: .06em; opacity: 0; pointer-events: none; transition: opacity .15s; white-space: nowrap; }
#ps-hud.on { opacity: 1; }
#ps-toc { position: absolute; z-index: 110; left: 14px; top: 12px; bottom: 8px; width: min(300px, 70%); display: none; flex-direction: column; background: #0F0F0E; border: 1px solid var(--line2, #333); box-shadow: 0 8px 28px rgba(0,0,0,.5); }
#ps-toc.on { display: flex; }
#ps-toc .hd { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 8px 12px; font: 11px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing: .08em; color: var(--ink4, #888); }
#ps-toc .hd button { border: 0; background: transparent; color: var(--ink3, #aaa); font-size: 13px; cursor: pointer; padding: 2px 6px; }
#ps-toc .hd button:hover { color: #FF4F1F; }
#ps-toc input { flex: none; margin: 0 10px 8px; height: 32px; padding: 0 10px; background: rgba(255,255,255,.05); border: 1px solid var(--line2, #333); border-radius: 0; color: var(--ink, #eee); font: 14px "SF Mono", ui-monospace, Menlo, monospace; outline: none; }
#ps-toc input:focus { border-color: #FF4F1F; }
#ps-toc li[hidden] { display: none; }
#ps-toc ol { flex: 1; margin: 0; padding: 4px 0; list-style: none; overflow-y: auto; }
#ps-toc li { display: flex; gap: 10px; padding: 7px 12px; cursor: pointer; font-size: 14px; line-height: 1.4; color: var(--ink2, #ccc); border-left: 3px solid transparent; }
#ps-toc li i { flex: none; width: 24px; font: normal 12px "SF Mono", ui-monospace, Menlo, monospace; color: var(--ink4, #888); padding-top: 1px; }
#ps-toc li:hover, #ps-toc li.sel { background: rgba(255,255,255,.06); }
#ps-toc li.now { border-left-color: #FF4F1F; color: var(--ink, #fff); }
#ps-toc li.now i { color: #FF4F1F; }
`;

// 汉字拼音首字母：按拼音排序的分界字归组，不依赖字库（目录搜索用）
const PY_EDGE = Array.from('阿八嚓哒妸发旮哈讥咔垃妈拿哦啪期然撒塌挖昔压匝');
const PY_LETTER = 'abcdefghjklmnopqrstwxyz';
const PY_COLLATOR = new Intl.Collator('zh-Hans-CN');
function pinyinInitials(text) {
  let out = '';
  for (const ch of text) {
    if (/[a-z0-9]/i.test(ch)) { out += ch.toLowerCase(); continue; }
    if (!/[\u4e00-\u9fff]/.test(ch)) continue;
    let i = 0;
    while (i < PY_EDGE.length - 1 && PY_COLLATOR.compare(ch, PY_EDGE[i + 1]) >= 0) i++;
    out += PY_LETTER[i];
  }
  return out;
}

function initPresenter(styleEl) {
  styleEl.textContent += PV_CSS;
  const pv = document.getElementById('pv');
  const body = document.getElementById('pvBody');
  const pvMain = pv && pv.querySelector('.pvmain');
  if (!pv || !body || !pvMain) return;

  const cssNum = (name, dflt) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || dflt;
  const prefs = Object.assign({ layout: 'bal' }, ipcRenderer.sendSync('stage:prefs-get') || {});
  const base = LAYOUTS.find((l) => l.id === prefs.layout) || LAYOUTS[0];
  let split = prefs.split || base.split;
  let font = prefs.font || base.font;
  let layout = LAYOUTS.some((l) => l.id === prefs.layout) ? prefs.layout : 'custom';
  const save = () => ipcRenderer.send('stage:prefs-set', { layout, split, font });

  // ---- 结构 ----
  const el = (tag, id, cls) => { const n = document.createElement(tag); if (id) n.id = id; if (cls) n.className = cls; return n; };
  const main = el('div', 'ps-main');
  const left = el('div', 'ps-left');
  const area = el('div', 'ps-area');
  const box = el('div', 'ps-box');
  const inkCanvas = el('canvas', 'ps-ink');
  const hud = el('div', 'ps-hud');
  const toc = el('div', 'ps-toc');
  const bar = el('div', 'ps-bar');
  const hint = el('div', 'ps-hint');
  const help = el('div', 'ps-help');
  const ptrBox = el('div', 'ps-ptr');
  const splitter = el('div', 'ps-split');
  const right = el('div', 'ps-right');
  const ixBox = el('div', 'ps-ix');
  ixBox.hidden = true;
  const next = el('div', 'ps-next');
  const mkNb = () => {
    const nb = el('div', null, 'nb');
    const cap = el('div', null, 'cap');
    const bx = el('div', null, 'box');
    const mini = el('div', null, 'mini');
    bx.appendChild(mini);
    nb.append(cap, bx);
    return { nb, cap, bx, mini };
  };
  const prevNb = mkNb();
  const nextNb = mkNb();
  next.append(prevNb.nb, nextNb.nb);
  box.appendChild(inkCanvas);
  area.append(box, toc, ptrBox, help, hud);
  left.append(area, bar, hint);
  right.append(body, ixBox, next);
  main.append(left, splitter, right);
  pv.insertBefore(main, pvMain);

  const stageEl = document.getElementById('stage');
  if (stageEl) box.insertBefore(stageEl, inkCanvas);

  // ---- 尺寸 ----
  const fit = () => {
    const W = cssNum('--deck-w', 1600);
    const H = cssNum('--deck-h', 900);
    const cs = getComputedStyle(area);
    const aw = area.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ah = area.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const k = Math.max(0.05, Math.min(aw / W, ah / H));
    box.style.width = Math.floor(W * k) + 'px';
    box.style.height = Math.floor(H * k) + 'px';
    box.style.setProperty('--ps-k', String(k));
    for (const n of [prevNb, nextNb]) n.mini.style.transform = `scale(${n.bx.clientWidth / W})`;
  };
  new ResizeObserver(fit).observe(area);
  new ResizeObserver(fit).observe(prevNb.bx);
  new ResizeObserver(fit).observe(nextNb.bx);

  const applyPrefs = () => {
    pv.style.setProperty('--ps-split', String(split));
    pv.style.setProperty('--ps-font', String(font));
    pv.classList.toggle('lay-stage', layout === 'stage');
    layoutBtn.firstChild.textContent = '布局 · ' + (layout === 'custom' ? '自定义' : LAYOUTS.find((l) => l.id === layout).name);
    fit();
  };

  // ---- 页面状态 ----
  const slideEls = () => Array.from(document.querySelectorAll('#slides > .slide'));
  const curIndex = () => slideEls().findIndex((s) => s.classList.contains('on'));
  const goTo = (i) => { const d = document.querySelectorAll('#dots > i')[i]; if (d) d.click(); };

  prevNb.nb.addEventListener('click', () => { const i = curIndex(); if (i > 0) goTo(i - 1); });
  nextNb.nb.addEventListener('click', () => { const i = curIndex(); if (i >= 0 && i < slideEls().length - 1) goTo(i + 1); });

  // ---- 工具栏 ----
  const btn = (label, key, fn) => {
    const b = el('button');
    b.type = 'button';
    b.append(label);
    if (key) { const k = el('kbd'); k.textContent = key; b.appendChild(k); }
    b.addEventListener('click', () => { fn(); b.blur(); });
    return b;
  };
  let hudTimer;
  const say = (msg) => {
    hud.textContent = msg;
    hud.classList.add('on');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => hud.classList.remove('on'), 1600);
  };
  const tocBtn = btn('目录', 'G', () => toggleToc());
  const layoutBtn = btn('', 'L', () => cycleLayout());
  const ptrBtn = btn('光标', 'K', () => togglePtr());
  const penBtn = btn('画笔', 'E', () => togglePen());
  const clearBtn = btn('清除', 'C', () => clearInk());
  const sp = el('div', null, 'sp');
  const fontDn = btn('A-', '-', () => setFont(font - 1));
  const fontUp = btn('A+', '+', () => setFont(font + 1));
  const helpBtn = btn('帮助', '?', () => toggleHelp());

  // 二维码开关：未提前在稿库开启时，点击也会自动启动局域网服务并展示二维码
  const remoteQr = addQrLayer('stage-remote-qr', '手机控制', '扫码后可翻页、跳页、黑屏和调整台词字号<br>按 R 或再次点击“手机控制”即可收起');
  let remoteEnabled = false;
  let visitorCount = 0;
  let remoteCount = 0;
  let visitorQrMode = 'off'; // 'off' | 'full' | 'corner'
  let liveInteractions = [];

  const updateRemoteButtons = () => {
    remoteBtn.firstChild.textContent = remoteEnabled
      ? (remoteCount ? `手机控制 · ${remoteCount} 台` : '手机控制 · 已开启')
      : '手机控制';
    remoteBtn.title = '显示/隐藏手机控制二维码（R），未开启时自动启动';

    const suffix = remoteEnabled ? ` · ${visitorCount} 人` : '';
    const modeLabel = visitorQrMode === 'full' ? ' · 大图' : visitorQrMode === 'corner' ? ' · 角标' : suffix;
    visitorBtn.firstChild.textContent = '访客入口' + modeLabel;
    visitorBtn.classList.toggle('on', visitorQrMode === 'full');
    visitorBtn.classList.toggle('corner', visitorQrMode === 'corner');
    visitorBtn.title = '切换访客二维码：全屏大图 → 右下角角标 → 关闭（V）';
  };

  const toggleRemoteQr = (force) => {
    const on = typeof force === 'boolean' ? force : !remoteQr.classList.contains('on');
    if (on && !remoteEnabled) say('正在开启手机控制服务…');
    ipcRenderer.send('stage:remote-qr', on);
  };

  const cycleVisitorQr = (forceMode) => {
    let nextMode = forceMode;
    if (!nextMode) {
      nextMode = visitorQrMode === 'off' ? 'full' : visitorQrMode === 'full' ? 'corner' : 'off';
    }
    visitorQrMode = nextMode;
    updateRemoteButtons();
    if (nextMode === 'full') say(remoteEnabled ? '访客二维码：全屏大图（再按 V 切右下角角标）' : '正在开启访客服务…');
    else if (nextMode === 'corner') say('访客二维码：右下角角标（再按 V 关闭）');
    else say('访客二维码：已收起');
    ipcRenderer.send('stage:visitor-qr', nextMode);
  };

  const remoteBtn = btn('手机控制', 'R', () => toggleRemoteQr());
  const visitorBtn = btn('访客入口', 'V', () => cycleVisitorQr());
  bar.append(tocBtn, layoutBtn, ptrBtn, penBtn, clearBtn, helpBtn, remoteBtn, visitorBtn, sp, fontDn, fontUp);

  // ---- 现场互动结果面板（仅在当前页声明了 data-interaction 时显示） ----
  const renderInteractions = () => {
    const curSlide = slideEls()[curIndex()];
    const defs = curSlide ? Array.from(curSlide.querySelectorAll('[data-interaction]')) : [];
    if (!defs.length) { ixBox.hidden = true; ixBox.textContent = ''; return; }
    ixBox.hidden = false;
    ixBox.textContent = '';
    const byId = new Map(liveInteractions.map((x) => [x.id, x]));
    const totalSubmits = defs.reduce((sum, d) => sum + ((byId.get(d.getAttribute('data-interaction')) || {}).count || 0), 0);
    const hd = el('div', null, 'ix-hd');
    const hdTitle = el('span');
    hdTitle.textContent = `现场互动反馈 · 共 ${totalSubmits} 条`;
    const hdSub = el('span');
    hdSub.textContent = visitorCount ? `在线访客 ${visitorCount} 人` : '按 V 展示二维码';
    hd.append(hdTitle, hdSub);
    ixBox.appendChild(hd);

    defs.forEach((d) => {
      const id = d.getAttribute('data-interaction');
      const label = d.getAttribute('data-interaction-label') || d.textContent.trim().slice(0, 60) || id;
      const item = byId.get(id);
      const wrap = el('div', null, 'ix-item');
      const q = el('div', null, 'ix-q');
      q.textContent = label;
      wrap.appendChild(q);
      if (!item || !item.count) {
        const empty = el('div', null, 'ix-empty');
        empty.textContent = '暂无提交';
        wrap.appendChild(empty);
      } else {
        const entries = Object.entries(item.results || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
        entries.forEach(([ans, cnt]) => {
          const pct = Math.round((cnt / item.count) * 100);
          const row = el('div', null, 'ix-row');
          const k = el('span'); k.textContent = ans; k.title = ans;
          const b = el('div', null, 'ix-bar');
          const fill = el('i'); fill.style.width = pct + '%'; b.appendChild(fill);
          const c = el('span', null, 'ix-cnt'); c.textContent = `${cnt} (${pct}%)`;
          row.append(k, b, c);
          wrap.appendChild(row);
        });
      }
      ixBox.appendChild(wrap);
    });
  };

  ipcRenderer.on('stage:remote-qr', (_e, data) => {
    const on = !!(data && typeof data === 'object' ? data.on : data);
    if (data && data.qr) remoteQr.querySelector('img').src = data.qr;
    remoteQr.classList.toggle('on', on);
    remoteBtn.classList.toggle('on', on);
  });
  ipcRenderer.on('stage:visitor-qr-state', (_e, data) => {
    if (data && data.mode) { visitorQrMode = data.mode; updateRemoteButtons(); }
  });
  ipcRenderer.on('stage:remote-status', (_e, data) => {
    remoteEnabled = !!(data && data.enabled);
    visitorCount = Number(data && data.visitors) || 0;
    remoteCount = Number(data && data.remotes) || 0;
    if (data && Array.isArray(data.interactions)) liveInteractions = data.interactions;
    if (!remoteEnabled) {
      if (remoteQr.classList.contains('on')) { remoteQr.classList.remove('on'); remoteBtn.classList.remove('on'); }
      if (visitorQrMode !== 'off') visitorQrMode = 'off';
    } else if (data && data.visitorQrMode) {
      visitorQrMode = data.visitorQrMode;
    }
    updateRemoteButtons();
    renderInteractions();
  });
  updateRemoteButtons();
  ipcRenderer.send('stage:remote-status-get');

  // ---- 操作指引 ----
  const HINT_IDLE = [['F', '全屏/窗口'], ['D', '换屏'], ['B', '黑屏'], ['P', '回到本窗'], ['G', '目录'], ['K', '光标'], ['R', '手机控制'], ['V', '访客二维码'], ['?', '全部快捷键']];
  let tocOpen = false;
  let subframeTyping = false;

  const syncTyping = () => {
    const localEditable = Sync.isEditableTarget(document.activeElement);
    ipcRenderer.send('stage:typing', tocOpen || localEditable || subframeTyping);
  };
  document.addEventListener('focusin', syncTyping, true);
  document.addEventListener('focusout', () => setTimeout(syncTyping, 0), true);

  const setHint = () => {
    hint.textContent = '';
    hint.classList.toggle('toc', tocOpen);
    if (tocOpen) { hint.textContent = '目录已打开，F / D / B / P 等快捷键已暂停：输入页码、标题或拼音首字母筛选，↑↓ 选择，回车跳转，Esc 收起'; return; }
    HINT_IDLE.forEach(([k, t], i) => {
      if (i) hint.append(' · ');
      const b = el('b'); b.textContent = k;
      hint.append(b, ' ' + t);
    });
  };
  const HELP = [
    ['放映（观众屏幕）', [['F', '观众窗口 全屏 / 窗口模式'], ['D', '观众窗口换到下一块屏幕'], ['B', '黑屏，再按恢复'], ['P', '回到演讲者窗口'], ['← →  空格', '翻页'], ['Esc', '退出输入焦点 / 退出全屏；窗口模式连按两次结束放映']]],
    ['演讲者窗口', [['G', '打开目录（搜页码 / 标题 / 拼音首字母）；Esc 收起'], ['数字 + 回车', '直接跳到第几页'], ['L', '切换布局：均衡 / 画面优先 / 台词优先'], ['+  -', '台词字号'], ['K', '实时切换投屏光标样式与大小'], ['鼠标移入当前页', '观众屏与访客端同步显示光标（含内嵌网页）'], ['Shift + 拖动', '在画面上划线（内嵌网页上也可直接划）'], ['E', '画笔常开 / 关闭'], ['C', '清除笔迹（翻页也会清）'], ['R', '显示/隐藏手机控制二维码（自动开启）'], ['V', '切换访客二维码：全屏大图 → 右下角角标 → 关闭'], ['?', '打开本说明；Esc 或 ✕ 关闭']]]
  ];
  const buildHelp = () => {
    const hd = el('div', null, 'hd');
    const t = el('span'); t.textContent = '操作指引';
    const x = el('button'); x.type = 'button'; x.textContent = '✕';
    x.addEventListener('click', () => toggleHelp(false));
    hd.append(t, x);
    help.append(hd);
    HELP.forEach(([title, rows]) => {
      const h = el('h4'); h.textContent = title;
      const dl = el('dl');
      rows.forEach(([k, d]) => { const dt = el('dt'); dt.textContent = k; const dd = el('dd'); dd.textContent = d; dl.append(dt, dd); });
      help.append(h, dl);
    });
  };
  function toggleHelp(force) {
    const on = force == null ? !help.classList.contains('on') : !!force;
    help.classList.toggle('on', on);
    syncOverlay();
  }
  function syncOverlay() { ipcRenderer.send('stage:overlay', tocOpen || help.classList.contains('on') || ptrBox.classList.contains('on')); }
  ipcRenderer.on('stage:close-overlay', () => {
    if (help.classList.contains('on')) toggleHelp(false);
    else if (ptrBox.classList.contains('on')) togglePtr(false);
    else if (tocOpen) toggleToc(false);
  });
  buildHelp();

  function cycleLayout() {
    const i = LAYOUTS.findIndex((l) => l.id === layout);
    const n = LAYOUTS[(i + 1) % LAYOUTS.length];
    layout = n.id; split = n.split; font = n.font;
    applyPrefs(); save(); say('布局：' + n.name);
  }
  function setFont(v) {
    font = Math.max(FONT_MIN, Math.min(FONT_MAX, v));
    applyPrefs(); save(); say('台词字号 ' + font);
  }

  // ---- 拖动分隔条 ----
  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    splitter.classList.add('drag');
    const rect = main.getBoundingClientRect();
    const move = (ev) => {
      split = Math.round(Math.max(25, Math.min(85, ((ev.clientX - rect.left) / rect.width) * 100)));
      layout = 'custom';
      applyPrefs();
    };
    const up = () => {
      splitter.classList.remove('drag');
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      save();
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  });

  // ---- 目录 ----
  let tocSel = 0;
  let tocCount = -1;
  let tocQuery = '';
  const tocInput = el('input');
  tocInput.type = 'text';
  tocInput.placeholder = '页码、标题或拼音首字母';
  tocInput.spellcheck = false;
  tocInput.autocomplete = 'off';
  const tocList = el('ol');
  const visibleItems = () => Array.from(tocList.children).filter((li) => !li.hidden);
  const buildToc = () => {
    const slides = slideEls();
    tocCount = slides.length;
    toc.textContent = '';
    tocList.textContent = '';
    const hd = el('div', null, 'hd');
    const hdHint = el('span');
    hdHint.textContent = '目录 · 回车跳转 · Esc 收起';
    const close = el('button');
    close.type = 'button';
    close.textContent = '✕';
    close.addEventListener('click', () => toggleToc(false));
    hd.append(hdHint, close);
    slides.forEach((s, i) => {
      const li = el('li');
      li.dataset.i = String(i);
      li.dataset.q = `${i + 1} ${String(i + 1).padStart(2, '0')} ${s.dataset.t || ''}`.toLowerCase();
      li.dataset.py = pinyinInitials(s.dataset.t || '');
      const n = el('i'); n.textContent = String(i + 1).padStart(2, '0');
      li.append(n, document.createTextNode(s.dataset.t || `第 ${i + 1} 页`));
      li.addEventListener('click', () => goTo(i));
      tocList.appendChild(li);
    });
    const tip = el('div', null, 'tip');
    tip.textContent = '页码 11 · 标题关键字 · 拼音首字母 fy';
    toc.append(hd, tocInput, tip, tocList);
    filterToc();
  };
  const filterToc = () => {
    const q = tocQuery.trim().toLowerCase();
    Array.from(tocList.children).forEach((li) => {
      const i = Number(li.dataset.i);
      li.hidden = !!q && !(/^\d+$/.test(q) ? String(i + 1).startsWith(String(parseInt(q, 10))) : li.dataset.q.includes(q) || (/^[a-z]+$/.test(q) && li.dataset.py.includes(q)));
    });
    const vis = visibleItems();
    if (!vis.some((li) => Number(li.dataset.i) === tocSel)) tocSel = vis.length ? Number(vis[0].dataset.i) : -1;
    markToc(curIndex());
  };
  const markToc = (cur) => {
    Array.from(tocList.children).forEach((li) => {
      const i = Number(li.dataset.i);
      li.classList.toggle('now', i === cur);
      li.classList.toggle('sel', i === tocSel);
      if (i === tocSel && !li.hidden) li.scrollIntoView({ block: 'nearest' });
    });
  };
  const moveSel = (d) => {
    const vis = visibleItems().map((li) => Number(li.dataset.i));
    if (!vis.length) return;
    const at = Math.max(0, vis.indexOf(tocSel));
    tocSel = vis[Math.max(0, Math.min(vis.length - 1, at + d))];
    markToc(curIndex());
  };
  const jumpSel = () => { if (tocSel >= 0) goTo(tocSel); };
  tocInput.addEventListener('input', () => { tocQuery = tocInput.value; filterToc(); });
  function toggleToc(force) {
    tocOpen = force == null ? !tocOpen : !!force;
    if (tocOpen && tocCount !== slideEls().length) buildToc();
    toc.classList.toggle('on', tocOpen);
    tocBtn.classList.toggle('on', tocOpen);
    syncTyping();
    setHint();
    syncOverlay();
    if (tocOpen) {
      tocQuery = ''; tocInput.value = '';
      tocSel = Math.max(0, curIndex());
      filterToc();
      tocInput.focus();
    } else {
      tocInput.blur();
    }
  }

  // ---- 上一页 / 下一页预览（替换重资源 iframe/video/audio 为静态占位，防止重复发请求） ----
  const renderOne = (nb, label, idx, emptyText) => {
    const slides = slideEls();
    nb.mini.textContent = '';
    const sl = slides[idx];
    nb.nb.classList.toggle('can-jump', !!sl);
    if (!sl) { nb.cap.textContent = emptyText; return; }
    nb.cap.textContent = `${label} · ${String(idx + 1).padStart(2, '0')} ${sl.dataset.t || ''}`;
    const c = sl.cloneNode(true);
    c.classList.add('on');
    c.removeAttribute('data-t');
    c.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    c.querySelectorAll('.an').forEach((n) => { n.style.animation = 'none'; });
    c.querySelectorAll('iframe, video, audio').forEach((media) => {
      const ph = document.createElement('div');
      ph.className = (media.className ? media.className + ' ' : '') + 'ps-media-ph';
      ph.style.cssText = media.style.cssText;
      const tag = media.tagName.toLowerCase();
      const desc = media.getAttribute('title') || media.getAttribute('src') || '';
      ph.textContent = tag === 'iframe' ? `内嵌网页${desc ? ' · ' + desc : ''}` : '媒体内容';
      media.replaceWith(ph);
    });
    nb.mini.appendChild(c);
  };
  const renderNeighbors = (cur) => {
    renderOne(prevNb, '上一页', cur - 1, '已是第一页');
    renderOne(nextNb, '下一页', cur + 1, '已是最后一页');
    fit();
  };

  // ---- 光点、划线与内嵌网页（iframe）同步 ----
  let pointerCatalog = Object.assign({ value: { style: 'mac', size: 'small' } }, POINTER_DATA);
  const ink = Sync.makeInk(inkCanvas, () => inkCanvas.getBoundingClientRect(), pointerCatalog);
  const renderPtrBox = () => {
    const styles = pointerCatalog.styles || [];
    const sizes = pointerCatalog.sizes || [];
    const curVal = pointerCatalog.value || { style: 'mac', size: 'small' };
    ptrBox.textContent = '';
    const hd = el('div', null, 'hd');
    const title = el('span');
    title.textContent = '投屏光标 · 实时切换（Esc 收起）';
    const close = el('button');
    close.type = 'button';
    close.textContent = '✕';
    close.onclick = () => togglePtr(false);
    hd.append(title, close);
    const grid = el('div', null, 'ptr-grid');
    styles.forEach((st) => {
      const b = el('button', null, 'ptr-item' + (st.id === curVal.style ? ' on' : ''));
      b.type = 'button';
      const im = el('img');
      im.alt = '';
      im.src = (st.previews && (st.previews[curVal.size] || st.previews.small)) || '';
      const nm = el('span');
      nm.textContent = st.name;
      b.append(im, nm);
      b.onclick = () => selectPointer({ style: st.id, size: curVal.size });
      grid.appendChild(b);
    });
    const szWrap = el('div', null, 'ptr-sizes');
    sizes.forEach((sz) => {
      const b = el('button', null, 'ptr-sz' + (sz.id === curVal.size ? ' on' : ''));
      b.type = 'button';
      b.textContent = `${sz.name}号 · ${sz.px}px`;
      b.onclick = () => selectPointer({ style: curVal.style, size: sz.id });
      szWrap.appendChild(b);
    });
    ptrBox.append(hd, grid, szWrap);
  };
  const selectPointer = (nextVal) => {
    pointerCatalog = Object.assign({}, pointerCatalog, { value: nextVal });
    ink.setPointer(pointerCatalog);
    renderPtrBox();
    ipcRenderer.invoke('stage:pointer-set', nextVal);
    const st = (pointerCatalog.styles || []).find((x) => x.id === nextVal.style);
    const sz = (pointerCatalog.sizes || []).find((x) => x.id === nextVal.size);
    say(`光标：${st ? st.name : nextVal.style}${sz ? ' · ' + sz.name + '号' : ''}`);
  };
  function togglePtr(force) {
    const on = force == null ? !ptrBox.classList.contains('on') : !!force;
    if (on) renderPtrBox();
    ptrBox.classList.toggle('on', on);
    ptrBtn.classList.toggle('on', on);
    syncOverlay();
  }
  ipcRenderer.on('stage:pointer-config', (_e, catalog) => {
    if (!catalog) return;
    pointerCatalog = catalog;
    ink.setPointer(pointerCatalog);
    if (ptrBox.classList.contains('on')) renderPtrBox();
  });
  const emit = (m) => { ink.apply(m); ipcRenderer.send('stage:pointer', m); };
  const emitRemote = (m) => ipcRenderer.send('stage:pointer', m);
  let pen = false;
  let shiftHeld = false;
  let strokeN = 0;
  let drawing = null;
  let last = null;
  let pending = null;
  let flushRaf = 0;

  const syncPenLayer = () => inkCanvas.classList.toggle('pen', pen || shiftHeld);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const norm = (e) => {
    const r = box.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
  };
  const flush = () => {
    flushRaf = 0;
    if (!pending) return;
    const p = pending;
    pending = null;
    emitRemote({ k: 'm', x: p.pos[0], y: p.pos[1] });
    if (p.pts.length && drawing) { ink.add(drawing.id, p.pts); emitRemote({ k: 's', id: drawing.id, pts: p.pts }); }
  };
  const queue = (pos, pt) => {
    pending = pending || { pos, pts: [] };
    pending.pos = pos;
    if (pt) pending.pts.push(pt);
    if (!flushRaf) flushRaf = requestAnimationFrame(flush);
  };
  const endStroke = () => {
    if (!drawing) return;
    flush();
    emit({ k: 'e', id: drawing.id });
    drawing = null;
  };
  box.addEventListener('mousemove', (e) => {
    last = norm(e);
    queue(last, drawing ? last : null);
  });
  box.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !(pen || e.shiftKey)) return;
    e.preventDefault();
    drawing = { id: `${Date.now().toString(36)}-${++strokeN}` };
    last = norm(e);
    queue(last, last);
  });
  window.addEventListener('mouseup', endStroke, true);
  box.addEventListener('mouseleave', () => { endStroke(); last = null; emitRemote({ k: 'l' }); });
  setInterval(() => { if (last) emitRemote({ k: 'm', x: last[0], y: last[1] }); }, 1500);

  // 接收子帧（内嵌网页 iframe）发来的光标坐标、输入聚焦状态及交互事件
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.__dsFrame !== 1) return;
    const frames = Array.from(document.querySelectorAll('#slides iframe'));
    const fi = frames.findIndex((f) => f.contentWindow === e.source);
    if (fi < 0) return;
    if (d.op === 'move') {
      const fr = frames[fi].getBoundingClientRect();
      const br = box.getBoundingClientRect();
      if (!br.width || !br.height) return;
      last = [
        clamp01((fr.left + d.rx * fr.width - br.left) / br.width),
        clamp01((fr.top + d.ry * fr.height - br.top) / br.height)
      ];
      queue(last, drawing ? last : null);
    } else if (d.op === 'leave') {
      if (!drawing) { last = null; emitRemote({ k: 'l' }); }
    } else if (d.op === 'typing') {
      subframeTyping = !!d.on;
      syncTyping();
    } else if (d.op === 'refocus') {
      subframeTyping = false;
      syncTyping();
      if (frames[fi].blur) frames[fi].blur();
      window.focus();
      say('已退回舞台焦点');
    } else if (d.op === 'nav-key') {
      subframeTyping = false;
      syncTyping();
      if (frames[fi].blur) frames[fi].blur();
      window.focus();
      const nextIdx = curIndex() + (d.dir > 0 ? 1 : -1);
      if (nextIdx >= 0 && nextIdx < slideEls().length) goTo(nextIdx);
    } else if (d.op === 'click' || d.op === 'dblclick' || d.op === 'scroll' || d.op === 'input' || d.op === 'url') {
      const payload = Object.assign({}, d, { fi });
      delete payload.__dsFrame;
      ipcRenderer.send('stage:iframe-sync', payload);
    }
  });

  function togglePen(force) {
    pen = force == null ? !pen : !!force;
    penBtn.classList.toggle('on', pen);
    syncPenLayer();
    say(pen ? '画笔 开 · 拖动划线' : '画笔 关');
  }
  function clearInk() { emit({ k: 'c' }); }

  // ---- 翻页检测：清笔迹、更新目录、预览与互动面板 ----
  let lastIdx = -2;
  const onTick = () => {
    const i = curIndex();
    if (i === lastIdx || i < 0) return;
    lastIdx = i;
    subframeTyping = false;
    syncTyping();
    clearInk();
    renderNeighbors(i);
    renderInteractions();
    if (tocOpen && !tocQuery) { tocSel = i; markToc(i); } else if (tocOpen) markToc(i);
  };
  window.addEventListener('hashchange', onTick);
  setInterval(onTick, 150);

  // ---- 键盘 ----
  let digits = '';
  let digitTimer;
  const showDigits = () => {
    clearTimeout(digitTimer);
    if (!digits) { hud.classList.remove('on'); return; }
    say('跳转到第 ' + digits + ' 页 · 回车');
    digitTimer = setTimeout(() => { digits = ''; }, 2500);
  };
  const eat = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift' && !shiftHeld) { shiftHeld = true; syncPenLayer(); }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.target === tocInput) {
      e.stopImmediatePropagation();
      if (k === 'ArrowDown') { e.preventDefault(); moveSel(1); }
      else if (k === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
      else if (k === 'Enter') { e.preventDefault(); jumpSel(); tocQuery = ''; tocInput.value = ''; filterToc(); }
      return;
    }
    // 幻灯片内的输入框正在打字：阻止事件传给内核翻页，允许正常输入文字
    if (Sync.isEditableTarget(e.target)) {
      if (k === 'Escape') { eat(e); e.target.blur(); syncTyping(); }
      else e.stopImmediatePropagation();
      return;
    }
    if (k === '?') { eat(e); toggleHelp(); return; }
    if (tocOpen && k !== 'g' && e.key.length === 1) { tocInput.focus(); return; }
    if (/^[0-9]$/.test(k)) { eat(e); digits = (digits + k).slice(0, 3); showDigits(); return; }
    if (digits && k === 'Enter') {
      eat(e);
      const n = Math.max(1, Math.min(slideEls().length, parseInt(digits, 10)));
      digits = '';
      goTo(n - 1);
      return;
    }
    if (digits && k === 'Backspace') { eat(e); digits = digits.slice(0, -1); showDigits(); return; }
    if (tocOpen && (k === 'ArrowUp' || k === 'ArrowDown')) { eat(e); moveSel(k === 'ArrowDown' ? 1 : -1); return; }
    if (tocOpen && k === 'Enter') { eat(e); jumpSel(); return; }
    switch (k) {
      case 'g': eat(e); toggleToc(); break;
      case 'l': eat(e); cycleLayout(); break;
      case 'k': eat(e); togglePtr(); break;
      case 'e': eat(e); togglePen(); break;
      case 'c': eat(e); clearInk(); say('已清除笔迹'); break;
      case 'r': eat(e); toggleRemoteQr(); break;
      case 'v': eat(e); cycleVisitorQr(); break;
      case '+': case '=': eat(e); setFont(font + 1); break;
      case '-': case '_': eat(e); setFont(font - 1); break;
      default: break;
    }
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' && shiftHeld) { shiftHeld = false; syncPenLayer(); }
  }, true);
  window.addEventListener('blur', () => {
    if (shiftHeld) { shiftHeld = false; syncPenLayer(); }
  });

  applyPrefs();
  setHint();
  buildToc();
  onTick();
}

function watchLightbox() {
  const lb = document.getElementById('lb');
  const img = document.getElementById('lbImg');
  if (!lb || !img) return;
  const isPresenter = /[?&]notes\b/.test(location.search);
  const closeBtn = lb.querySelector('[data-lb="close"]');
  const isOn = () => lb.classList.contains('on');

  const report = () => {
    ipcRenderer.send('stage:lightbox', isOn());
    if (!isPresenter) return;
    if (isOn()) ipcRenderer.send('stage:lb-sync', { op: 'open', src: img.src, cap: (document.getElementById('lbCap') || {}).textContent || '' });
    else ipcRenderer.send('stage:lb-sync', { op: 'close' });
  };
  new MutationObserver(report).observe(lb, { attributes: true, attributeFilter: ['class'] });

  if (isPresenter) {
    let raf = 0;
    new MutationObserver(() => {
      if (raf || !isOn()) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(img.style.transform || '');
        if (!m) return;
        const r = lb.getBoundingClientRect();
        ipcRenderer.send('stage:lb-sync', { op: 'xf', s: parseFloat(m[3]), nx: parseFloat(m[1]) / r.width, ny: parseFloat(m[2]) / r.height });
      });
    }).observe(img, { attributes: true, attributeFilter: ['style'] });
  } else {
    ipcRenderer.on('stage:lb-sync', (_e, m) => Sync.applyLbSync(document, m));
  }

  ipcRenderer.on('stage:close-lightbox', () => { if (closeBtn) closeBtn.click(); });
}

function watchSyncZones() {
  const isPresenter = /[?&]notes\b/.test(location.search);
  if (isPresenter) {
    const send = (m) => ipcRenderer.send('stage:dom-sync', m);
    new MutationObserver((records) => {
      const list = Sync.syncZonesOf(document);
      if (!list.length) return;
      for (const r of records) {
        const zi = list.findIndex((z) => z.contains(r.target));
        if (zi < 0) continue;
        const z = list[zi];
        if (r.type === 'attributes') {
          if (r.target === z || !Sync.syncAttr(r.attributeName)) continue;
          send({ zi, path: Sync.pathOf(z, r.target), op: 'attr', name: r.attributeName, value: r.target.getAttribute(r.attributeName) });
        } else if (r.type === 'characterData') {
          send({ zi, path: Sync.pathOf(z, r.target), op: 'text', value: r.target.data });
        } else if (r.type === 'childList' && r.target.nodeType === 1) {
          send({ zi, path: Sync.pathOf(z, r.target), op: 'html', value: r.target.innerHTML });
        }
      }
    }).observe(document.documentElement, { subtree: true, attributes: true, characterData: true, childList: true });
    ipcRenderer.on('stage:dom-sync-hello', () => Sync.syncZonesOf(document).forEach((z, zi) => Sync.snapshotZone(z, zi, send)));
  } else {
    ipcRenderer.on('stage:dom-sync', (_e, m) => Sync.applyDomSync(document, m));
    ipcRenderer.send('stage:dom-sync-ready');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  const isPresenter = /[?&]notes\b/.test(location.search);
  watchLightbox();
  watchSyncZones();
  ipcRenderer.on('stage:blur-editable', blurActiveEditable);

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  if (isPresenter) {
    addEndButton();
    initPresenter(style);
    return;
  }
  document.body.classList.add('stage-audience');
  initAudienceInk();
  initAudienceIframeReplay();

  const syncAudienceTyping = () => ipcRenderer.send('stage:typing', Sync.isEditableTarget(document.activeElement));
  document.addEventListener('focusin', syncAudienceTyping, true);
  document.addEventListener('focusout', () => setTimeout(syncAudienceTyping, 0), true);
  window.addEventListener('keydown', (e) => {
    if (Sync.isEditableTarget(e.target)) e.stopImmediatePropagation();
  }, true);

  const drag = document.createElement('div');
  drag.id = 'stage-drag';
  document.body.appendChild(drag);

  const black = document.createElement('div');
  black.id = 'stage-black';
  document.body.appendChild(black);

  const visitorQr = addQrLayer('stage-visitor-qr', '扫码同屏查看', '打开即进入横屏大屏同步视图，也可参与互动<br>按 V 可切换为右下角小角标或收起');
  ipcRenderer.on('stage:visitor-qr', (_e, data) => {
    const mode = data && typeof data === 'object' ? (data.mode || (data.on ? 'full' : 'off')) : (data ? 'full' : 'off');
    if (data && data.qr) visitorQr.querySelector('img').src = data.qr;
    visitorQr.classList.toggle('on', mode === 'full');
    visitorQr.classList.toggle('corner', mode === 'corner');
  });

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
