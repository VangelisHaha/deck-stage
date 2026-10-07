'use strict';
// 注入到观众/演讲者窗口的预加载脚本（沙箱内只能用 electron 的 ipcRenderer）。
// 去浏览器痕迹：隐藏稿子工具条、鼠标自动隐藏、黑屏、窗口模式下的拖动条。
// 演讲者窗口另加：大画面布局、目录、光点与划线（划线经主进程转给观众窗口）。不改稿子文件，旧稿子同样生效。
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
/* 稿子的框架样式在演讲者视图里把灯箱整个藏了，结果点图「打开」了一个看不见的灯箱。这里让它在演讲者窗口里也显示出来 */
html.pv #lb.on { display: flex !important; }
#stage-ink { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2147482000; pointer-events: none; }
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

// ---------- 光点与划线（演讲者窗口画、观众窗口显示；坐标一律是 0–1 的画面比例，两边分辨率不同也对得上）----------
const INK_COLOR = '#FF4F1F';
const INK_WAIT = 3000; // 笔迹停留，之后淡出
const INK_FADE = 600;
const DOT_TTL = 5000;
// 放映启动前选定的投屏光标。目录和矢量路径由主进程统一提供，旧配置自动回退到 macOS 黑箭头 + 小号。
const POINTER_DATA = ipcRenderer.sendSync('stage:pointer-prefs-get') || {};
const POINTER_VALUE = POINTER_DATA.value || { style: 'mac', size: 'small' };
const POINTER_STYLE = (POINTER_DATA.styles || []).find((x) => x.id === POINTER_VALUE.style) || (POINTER_DATA.styles || [])[0];
const POINTER_SIZE = (POINTER_DATA.sizes || []).find((x) => x.id === POINTER_VALUE.size) || (POINTER_DATA.sizes || [])[0];

function drawPointer(ctx, x, y, rect) {
  if (!POINTER_STYLE || !POINTER_SIZE) return;
  const density = Math.max(.85, Math.min(1.35, rect.width / 1600));
  const scale = (POINTER_SIZE.px * density) / POINTER_STYLE.viewBox;
  ctx.save();
  ctx.translate(x - POINTER_STYLE.tip[0] * scale, y - POINTER_STYLE.tip[1] * scale);
  ctx.scale(scale, scale);
  for (const layer of POINTER_STYLE.layers) {
    const shape = new Path2D(layer.path);
    ctx.shadowColor = layer.shadow || 'transparent';
    ctx.shadowBlur = layer.shadow ? POINTER_STYLE.viewBox * .1 : 0;
    ctx.shadowOffsetY = layer.shadow ? POINTER_STYLE.viewBox * .04 : 0;
    if (layer.fill && layer.fill !== 'none') { ctx.fillStyle = layer.fill; ctx.fill(shape); }
    ctx.shadowColor = 'transparent';
    if (layer.stroke && layer.stroke !== 'none' && layer.lineWidth) {
      ctx.strokeStyle = layer.stroke;
      ctx.lineWidth = layer.lineWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke(shape);
    }
  }
  ctx.restore();
}

function makeInk(canvas, getRect) {
  const ctx = canvas.getContext('2d');
  const strokes = new Map(); // id → { pts, endAt }
  let dot = null;
  let raf = 0;

  function frame(now) {
    raf = 0;
    const cr = canvas.getBoundingClientRect();
    const d = window.devicePixelRatio || 1;
    const w = Math.round(cr.width * d);
    const h = Math.round(cr.height * d);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, cr.width, cr.height);
    const r = getRect();
    const at = (p) => [r.left - cr.left + p[0] * r.width, r.top - cr.top + p[1] * r.height];
    const lw = Math.max(3, r.width * 0.0045);
    let alive = false;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [id, s] of strokes) {
      let a = 1;
      if (s.endAt) {
        const t = now - s.endAt - INK_WAIT;
        if (t >= INK_FADE) { strokes.delete(id); continue; }
        if (t > 0) a = 1 - t / INK_FADE;
      }
      alive = true;
      ctx.globalAlpha = a;
      ctx.strokeStyle = INK_COLOR;
      ctx.shadowColor = 'rgba(255,79,31,.55)';
      ctx.shadowBlur = lw * 2;
      ctx.lineWidth = lw;
      ctx.beginPath();
      s.pts.forEach((p, i) => { const [x, y] = at(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      if (s.pts.length === 1) { const [x, y] = at(s.pts[0]); ctx.lineTo(x + 0.01, y); }
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    if (dot && now - dot.at > DOT_TTL) dot = null;
    if (dot) {
      alive = true;
      const [x, y] = at([dot.x, dot.y]);
      drawPointer(ctx, x, y, r);
    }
    if (alive) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  return {
    pointer(x, y) { dot = x == null ? null : { x, y, at: performance.now() }; kick(); },
    add(id, pts) {
      const s = strokes.get(id) || { pts: [], endAt: 0 };
      s.pts.push(...pts);
      strokes.set(id, s);
      kick();
    },
    end(id) { const s = strokes.get(id); if (s) s.endAt = performance.now(); kick(); },
    clear() { strokes.clear(); kick(); },
    apply(m) {
      if (m.k === 'm') this.pointer(m.x, m.y);
      else if (m.k === 'l') this.pointer(null);
      else if (m.k === 's') this.add(m.id, m.pts);
      else if (m.k === 'e') this.end(m.id);
      else if (m.k === 'c') this.clear();
    }
  };
}

function makeHoverMirror(getStage) {
  let path = [];
  const fire = (node, type, x, y, relatedTarget, bubbles = false) => {
    node.dispatchEvent(new MouseEvent(type, {
      bubbles,
      clientX: x,
      clientY: y,
      relatedTarget
    }));
  };
  const clear = (x = -1, y = -1) => {
    const oldTarget = path[0] || null;
    for (const node of path) fire(node, 'mouseleave', x, y, null);
    if (oldTarget) fire(oldTarget, 'mouseout', x, y, null, true);
    path = [];
  };
  return {
    move(nx, ny) {
      const stage = getStage();
      if (!stage) return clear();
      const rect = stage.getBoundingClientRect();
      const x = rect.left + nx * rect.width;
      const y = rect.top + ny * rect.height;
      const target = document.elementFromPoint(x, y);
      if (!target || !stage.contains(target)) return clear(x, y);

      const next = [];
      for (let node = target; node; node = node.parentElement) {
        next.push(node);
        if (node === stage) break;
      }
      const oldTarget = path[0] || null;
      const nextSet = new Set(next);
      const oldSet = new Set(path);
      for (const node of path) if (!nextSet.has(node)) fire(node, 'mouseleave', x, y, target);
      if (oldTarget !== target && oldTarget) fire(oldTarget, 'mouseout', x, y, target, true);
      for (const node of next.slice().reverse()) if (!oldSet.has(node)) fire(node, 'mouseenter', x, y, oldTarget);
      if (oldTarget !== target) fire(target, 'mouseover', x, y, oldTarget, true);
      fire(target, 'mousemove', x, y, oldTarget, true);
      path = next;
    },
    clear
  };
}

function initAudienceInk() {
  const canvas = document.createElement('canvas');
  canvas.id = 'stage-ink';
  document.body.appendChild(canvas);
  const stage = () => document.getElementById('stage');
  const ink = makeInk(canvas, () => (stage() || document.documentElement).getBoundingClientRect());
  const hover = makeHoverMirror(stage);
  ipcRenderer.on('stage:pointer', (_e, m) => {
    ink.apply(m);
    if (m.k === 'm') hover.move(m.x, m.y);
    else if (m.k === 'l') hover.clear();
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
#pv .pvshots, #pv #pvFold { display: none !important; }
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
#ps-next { flex: none; display: flex; gap: 12px; padding: 8px 16px 12px; border-top: 1px solid var(--line, #222); }
#ps-next .nb { flex: 1; min-width: 0; max-width: 300px; }
#pv.lay-stage #ps-next { display: none; }
#ps-next .cap { cursor: default; font: 11px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing: .04em; color: var(--ink4, #888); margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#ps-next .box { position: relative; overflow: hidden; width: 100%; aspect-ratio: 16 / 9; border: 1px solid var(--line2, #333); background: var(--bg0, #0F0F0E); }
#ps-next .mini { position: absolute; left: 0; top: 0; width: var(--deck-w, 1600px); height: var(--deck-h, 900px); transform-origin: 0 0; pointer-events: none; }
#ps-next .mini > .slide { display: flex !important; }
#ps-next .mini .an { animation: none !important; }
#ps-bar { flex: none; display: flex; gap: 8px; align-items: center; padding: 6px 6px 10px 14px; flex-wrap: wrap; }
#ps-bar button { height: 28px; padding: 0 11px; border: 1px solid var(--line2, #333); background: transparent; color: var(--ink3, #aaa); font: 12px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing: .04em; cursor: pointer; white-space: nowrap; }
#ps-bar button:hover { color: var(--ink, #eee); border-color: var(--ink3, #aaa); }
#ps-bar button.on { color: #121212; background: #FF4F1F; border-color: #FF4F1F; }
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
#ps-toc .tip { flex: none; margin: -2px 10px 8px; font: 11px/1.6 "SF Mono", ui-monospace, Menlo, monospace; color: var(--ink4, #888); }
#ps-bar kbd { opacity: .55; margin-left: 5px; font: inherit; }
#ps-bar .sp { flex: 1; }
#ps-hud { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 120; padding: 6px 14px; background: rgba(18,18,18,.92); border: 1px solid #FF4F1F; color: #F1EEE6; font: 13px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing: .06em; opacity: 0; pointer-events: none; transition: opacity .15s; }
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
  const shots = document.getElementById('pvShots');
  if (!pv || !body || !shots) return; // 不是 deck-html 骨架就保持原样

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
  const splitter = el('div', 'ps-split');
  const right = el('div', 'ps-right');
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
  area.append(box, toc, help, hud);
  left.append(area, bar, hint);
  right.append(body, next);
  main.append(left, splitter, right);
  pv.insertBefore(main, shots);

  // 观众舞台本体由稿子的脚本放进预览条里，这里每次都把它拿回来放大使用
  const stageEl = document.getElementById('stage');
  const claim = () => { if (stageEl && stageEl.parentElement !== box) box.insertBefore(stageEl, inkCanvas); };
  new MutationObserver(claim).observe(shots, { childList: true, subtree: true });
  claim();

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
    hudTimer = setTimeout(() => hud.classList.remove('on'), 1400);
  };
  const tocBtn = btn('目录', 'G', () => toggleToc());
  const layoutBtn = btn('', 'L', () => cycleLayout());
  const penBtn = btn('画笔', 'E', () => togglePen());
  const clearBtn = btn('清除', 'C', () => clearInk());
  const sp = el('div', null, 'sp');
  const fontDn = btn('A-', '-', () => setFont(font - 1));
  const fontUp = btn('A+', '+', () => setFont(font + 1));
  const helpBtn = btn('帮助', '?', () => toggleHelp());
  bar.append(tocBtn, layoutBtn, penBtn, clearBtn, helpBtn, sp, fontDn, fontUp);

  // ---- 操作指引：底部常驻一行提示，? 打开完整快捷键表 ----
  const HINT_IDLE = [['F', '全屏/窗口'], ['D', '换屏'], ['B', '黑屏'], ['P', '回到本窗'], ['G', '目录'], ['?', '全部快捷键']];
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
    ['放映（观众屏幕）', [['F', '观众窗口 全屏 / 窗口模式'], ['D', '观众窗口换到下一块屏幕'], ['B', '黑屏，再按恢复'], ['P', '回到演讲者窗口'], ['← →  空格', '翻页'], ['Esc', '退出全屏；窗口模式连按两次结束放映']]],
    ['演讲者窗口', [['G', '打开目录（搜页码 / 标题 / 拼音首字母）；Esc 收起'], ['数字 + 回车', '直接跳到第几页'], ['L', '切换布局：均衡 / 画面优先 / 台词优先'], ['+  -', '台词字号'], ['鼠标移入当前页', '观众屏幕出现手形指针'], ['Shift + 拖动', '在观众屏幕上划线'], ['E', '画笔常开 / 关闭'], ['C', '清除笔迹（翻页也会清）'], ['?', '打开本说明；Esc 或 ✕ 关闭']]]
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
  function syncOverlay() { ipcRenderer.send('stage:overlay', tocOpen || help.classList.contains('on')); }
  // 主进程转来的 Esc：先关操作指引，再关目录
  ipcRenderer.on('stage:close-overlay', () => { if (help.classList.contains('on')) toggleHelp(false); else if (tocOpen) toggleToc(false); });
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

  // ---- 页面状态 ----
  const slideEls = () => Array.from(document.querySelectorAll('#slides > .slide'));
  const curIndex = () => slideEls().findIndex((s) => s.classList.contains('on'));
  const goTo = (i) => { const d = document.querySelectorAll('#dots > i')[i]; if (d) d.click(); };

  // ---- 目录（带搜索；点选或回车跳转后保持打开，用 G 或 ✕ 收起）----
  let tocOpen = false;
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
    const hint = el('span');
    hint.textContent = '目录 · 回车跳转 · Esc 收起';
    const close = el('button');
    close.type = 'button';
    close.textContent = '✕';
    close.addEventListener('click', () => toggleToc(false));
    hd.append(hint, close);
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
  // 数字按页码前缀匹配（11 → 第 11、110 页），其余按标题包含匹配
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
    ipcRenderer.send('stage:typing', tocOpen);
    setHint();
    syncOverlay(); // 目录开着期间，放映快捷键（F/D/B/P）全部让位
    if (tocOpen) {
      tocQuery = ''; tocInput.value = '';
      tocSel = Math.max(0, curIndex());
      filterToc();
      tocInput.focus();
    } else {
      tocInput.blur();
    }
  }

  // ---- 上一页 / 下一页预览 ----
  const renderOne = (nb, label, idx, emptyText) => {
    const slides = slideEls();
    nb.mini.textContent = '';
    const sl = slides[idx];
    if (!sl) { nb.cap.textContent = emptyText; return; }
    nb.cap.textContent = `${label} · ${String(idx + 1).padStart(2, '0')} ${sl.dataset.t || ''}`;
    const c = sl.cloneNode(true);
    c.classList.add('on');
    c.removeAttribute('data-t');
    c.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    c.querySelectorAll('.an').forEach((n) => { n.style.animation = 'none'; });
    nb.mini.appendChild(c);
  };
  const renderNeighbors = (cur) => {
    renderOne(prevNb, '上一页', cur - 1, '已是第一页');
    renderOne(nextNb, '下一页', cur + 1, '已是最后一页');
    fit();
  };

  // ---- 光点与划线 ----
  const ink = makeInk(inkCanvas, () => inkCanvas.getBoundingClientRect());
  const emit = (m) => { ink.apply(m); ipcRenderer.send('stage:pointer', m); };
  const emitRemote = (m) => ipcRenderer.send('stage:pointer', m);
  let pen = false;
  let strokeN = 0;
  let drawing = null;
  let last = null;
  let pending = null;
  let flushRaf = 0;
  const norm = (e) => {
    const r = box.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
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
  setInterval(() => { if (last) emitRemote({ k: 'm', x: last[0], y: last[1] }); }, 1500); // 光点心跳，鼠标不动也不会被收起

  function togglePen(force) {
    pen = force == null ? !pen : !!force;
    penBtn.classList.toggle('on', pen);
    inkCanvas.classList.toggle('pen', pen);
    say(pen ? '画笔 开 · 拖动划线' : '画笔 关');
  }
  function clearInk() { emit({ k: 'c' }); }

  // ---- 翻页检测：清笔迹、更新目录与预览 ----
  let lastIdx = -2;
  const onTick = () => {
    const i = curIndex();
    if (i === lastIdx || i < 0) return;
    lastIdx = i;
    clearInk();
    renderNeighbors(i);
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
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.target === tocInput) { // 在搜索框里打字：按键不能漏给稿子翻页
      e.stopImmediatePropagation();
      if (k === 'ArrowDown') { e.preventDefault(); moveSel(1); }
      else if (k === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
      else if (k === 'Enter') { e.preventDefault(); jumpSel(); tocQuery = ''; tocInput.value = ''; filterToc(); }
      return;
    }
    if (k === '?') { eat(e); toggleHelp(); return; }
    if (tocOpen && k !== 'g' && e.key.length === 1) { tocInput.focus(); return; } // 目录开着：可打印字符一律进搜索框，不触发任何快捷键
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
      case 'e': eat(e); togglePen(); break;
      case 'c': eat(e); clearInk(); say('已清除笔迹'); break;
      case '+': case '=': eat(e); setFont(font + 1); break;
      case '-': case '_': eat(e); setFont(font - 1); break;
      default: break;
    }
  }, true);

  applyPrefs();
  setHint();
  buildToc();
  onTick();
}

// 稿子里点图会弹出灯箱，灯箱开着时稿子自己会吞掉翻页键，看起来像「键盘突然失灵」。
// 这里在最前面截住翻页键：先收起灯箱，再让这次按键正常翻页（Esc、+ - 0 仍由灯箱自己处理）。
const PAGE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Enter']);
function closeLightboxOnPageKey() {
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !PAGE_KEYS.has(e.key)) return;
    const lb = document.getElementById('lb');
    if (!lb || !lb.classList.contains('on')) return;
    const close = lb.querySelector('[data-lb="close"]');
    if (close) close.click();
  }, true);
}

// 灯箱（点图放大）开着时告诉主进程：Esc 要先用来关灯箱，而不是退出全屏 / 结束放映
// 演讲者窗口里点图放大 = 观众屏幕上也放大：打开、缩放、平移、关闭都同步过去（平移量按各自窗口大小折算成比例）
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
    ipcRenderer.on('stage:lb-sync', (_e, m) => {
      if (m.op === 'open') {
        if (isOn()) return;
        // 找到观众这边当前页里同一张图，点一下（稿子自己的点击处理会打开灯箱）
        const imgs = Array.from(document.querySelectorAll('.slide.on .imgslot.has img, .slide.on [data-avatar] img'));
        // 图片地址带各窗口自己的防缓存时间戳（?_=…），按路径比
        const path = (u) => { try { return new URL(u, location.href).pathname; } catch (e) { return u; } };
        const hit = imgs.find((x) => path(x.currentSrc || x.src) === path(m.src));
        if (hit) hit.click();
      } else if (m.op === 'xf') {
        if (!isOn()) return;
        const r = lb.getBoundingClientRect();
        img.style.transform = `translate(${m.nx * r.width}px,${m.ny * r.height}px) scale(${m.s})`;
        const pct = document.getElementById('lbPct');
        if (pct) pct.textContent = Math.round(m.s * 100) + '%';
        lb.classList.toggle('zoomed', m.s > 1.01);
      } else if (m.op === 'close') {
        if (isOn() && closeBtn) closeBtn.click();
      }
    });
  }

  ipcRenderer.on('stage:close-lightbox', () => { if (closeBtn) closeBtn.click(); });
}

window.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  const isPresenter = /[?&]notes\b/.test(location.search);
  closeLightboxOnPageKey();
  watchLightbox();

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
