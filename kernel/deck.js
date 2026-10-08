/* ============================================================
   DeckStage 放映内核（随 App 分发，稿子通过 /_deckstage/deck.js 引用）

   稿子只写内容：<section class="slide" data-t="…"> 若干页、notes.js 台词、
   可选的 deck.config.js 与自己的样式脚本。舞台、页脚、圆点、灯箱、
   演讲者视图这些骨架都由这里生成。

   模块：
     0 骨架        把 body 里的幻灯收进舞台，生成提示、圆点、灯箱、演讲者视图
     1 放映        固定画布等比缩放、键盘 / 点击 / 圆点导航、页脚注入
     2 双窗同步    BroadcastChannel + localStorage 兜底
     3 演讲者视图  ?notes=1：台词 + 计时 + 当前页
     4 素材装载    assets/ 里有图就换上，没有就保留占位框
     5 图片灯箱    点图放大，滚轮缩放、拖拽平移
     6 动效引擎    data-seq 逐条出现、data-type 打字、data-count 数字滚动
     7 导出 PPTX   逐页 html2canvas 截图铺进 16:9（库按需加载）

   对外钩子（稿子脚本在本文件之后执行，可以直接用）：
     window.__go(n)          跳到第 n 页（0 起）
     window.__cur()          当前页序号
     window.__slides         所有 .slide 节点
     window.__toast(msg,ms)  底部提示，ms=0 表示不自动消失
     window.__assetsReady    素材装载完成的 Promise
     window.__lbOpen         灯箱是否开着
     document 上的 deck:slide 事件  每次进入一页（含按 R 重播）触发，
                             detail = { index, slide, replay }；打开稿子时的第一页在 DOMContentLoaded 时触发
   ============================================================ */

(function(){
'use strict';

var CFG = window.__DECK || {};
var W = CFG.W || 1600, H = CFG.H || 900;
var PPTX = CFG.pptx || {};
var RAIL = CFG.rail || null;
var root = document.documentElement;
var PV = /[?&]notes\b/.test(location.search);
if(PV) root.classList.add('pv');
/* 同一个 App 里每份稿子各有自己的端口（不同源），频道名只需在单个来源里唯一 */
var CHANNEL = CFG.channel || ('deck:' + location.pathname);
/* 内核自己的地址：导出库从同一个目录加载 */
var BASE = (document.currentScript && document.currentScript.src || '').replace(/[^/]*$/, '');

root.style.setProperty('--deck-w', W + 'px');
root.style.setProperty('--deck-h', H + 'px');

function el(tag, id, cls, html){
  var n = document.createElement(tag);
  if(id) n.id = id;
  if(cls) n.className = cls;
  if(html) n.innerHTML = html;
  return n;
}

/* 渐变文字的导出降级：html2canvas 渲染不了 background-clip:text，
   不降级的话导出后那行字直接是空白。规则从配置读。 */
(function injectExportFallback(){
  var list = CFG.gradientText || [];
  if(!list.length) return;
  var st = el('style', 'deckExportFallback');
  st.textContent = list.map(function(r){
    return '.exporting ' + r.sel + '{background:none !important;'
         + '-webkit-text-fill-color:' + r.color + ' !important;'
         + 'color:' + r.color + ' !important;}';
  }).join('\n');
  document.head.appendChild(st);
})();

/* ============================================================
   0 骨架
   稿子 body 里的 <section class="slide"> 收进 #slides；
   #bg（可选，背景层）放最底；其余元素（柔光、装饰层）放在幻灯之上，一起缩放。
   ============================================================ */
var stage = el('div', 'stage');
var bgEl = document.getElementById('bg') || el('div', 'bg');
var prog = el('div', 'prog');
var box = el('div', 'slides');
var layers = [];
Array.prototype.slice.call(document.body.children).forEach(function(n){
  if(/^(SCRIPT|STYLE|LINK|TEMPLATE|NOSCRIPT)$/.test(n.tagName) || n === bgEl) return;
  if(n.matches('section.slide')) box.appendChild(n);
  else layers.push(n);
});
stage.appendChild(bgEl);
stage.appendChild(prog);
stage.appendChild(box);
layers.forEach(function(n){ stage.appendChild(n); });
document.body.insertBefore(stage, document.body.firstChild);

var toastEl = el('div', 'toast');
var dots = el('div', 'dots');
var lbEl = el('div', 'lb', null,
    '<div class="stage"><img id="lbImg" alt=""></div>'
  + '<div class="bar"><button data-lb="out">−</button><span class="pct" id="lbPct">100%</span>'
  + '<button data-lb="in">+</button><button data-lb="fit">复位</button><button data-lb="close">✕ 关闭</button></div>'
  + '<div class="cap"><b id="lbCap"></b><span class="hint">滚轮缩放 · 拖拽平移 · 双击放大 · Esc 关闭</span></div>');
document.body.appendChild(toastEl);
document.body.appendChild(dots);
document.body.appendChild(lbEl);

/* ============================================================
   1 放映
   ============================================================ */
var slides = Array.prototype.slice.call(box.querySelectorAll(':scope > .slide'));
var cur = 0;

/* 页脚台阶条：靠幕间页的 data-t 推导当前处在第几级，增删页都不会错位 */
var levels = slides.map(function(){ return 0; });
if(RAIL && RAIL.map && RAIL.steps){
  var lv = 0;
  levels = slides.map(function(s){
    var t = s.dataset.t || '';
    if(RAIL.map[t] !== undefined) lv = RAIL.map[t];
    return lv;
  });
}

slides.forEach(function(s, i){
  if(s.classList.contains('cover')) return;
  var html = '';
  if(RAIL && RAIL.steps){
    var n = RAIL.steps.length;
    html += '<div class="steps"><i></i>';
    for(var k = 1; k <= n; k++){
      var cls = (k === levels[i]) ? ' on' : (k < levels[i] ? ' done' : '');
      html += '<span class="st l' + k + cls + '"><b>' + RAIL.steps[k-1][0] + '</b>'
            + RAIL.steps[k-1][1] + '</span>';
      if(k < n) html += '<span class="sep">→</span>';
    }
    html += '</div>';
  }else{
    html += '<div></div>';
  }
  html += '<div class="pno"><b>' + String(i+1).padStart(2,'0') + '</b> / '
        + String(slides.length).padStart(2,'0') + '</div>';
  s.appendChild(el('div', null, 'footer', html));
});

/* 背景光斑：配置里给了才画 */
(CFG.bokeh || []).forEach(function(c, i){
  var b = el('div', null, 'bokeh');
  b.style.cssText = 'left:' + c[0] + '%;top:' + c[1] + '%;width:' + c[2] + 'px;height:'
                  + c[2] + 'px;background:' + c[3] + ';animation-duration:' + c[4]
                  + 's;animation-delay:-' + (i * 2.4) + 's';
  bgEl.appendChild(b);
});

slides.forEach(function(s, i){
  var d = el('i');
  d.title = (i+1) + '. ' + (s.dataset.t || '');
  d.onclick = function(){ go(i); };
  dots.appendChild(d);
});
var dotEls = Array.prototype.slice.call(dots.children);

function fit(){
  if(PV){ pvFit(); return; }
  var k = Math.min(window.innerWidth/W, window.innerHeight/H);
  stage.style.transform = 'translate(-50%,-50%) scale(' + k + ')';
}
window.addEventListener('resize', fit);

var booted = false;   /* 启动时的第一页等稿子自己的脚本都加载完再通知（DOMContentLoaded） */
function enter(s, i, replay){
  if(!booted) return;
  document.dispatchEvent(new CustomEvent('deck:slide', { detail: { index: i, slide: s, replay: !!replay } }));
}

function go(n, silent){
  if(n < 0 || n >= slides.length) return;
  slides[cur].classList.remove('on');
  cur = n;
  var s = slides[cur];
  /* 重置动画：强制重排让 stagger 重新播放 */
  s.querySelectorAll('.an').forEach(function(x){ x.style.animation = 'none'; });
  s.classList.add('on');
  void s.offsetWidth;
  s.querySelectorAll('.an').forEach(function(x){ x.style.animation = ''; });
  prog.style.width = ((cur+1)/slides.length*100) + '%';
  dotEls.forEach(function(d, i){ d.classList.toggle('on', i === cur); });
  location.hash = 'p' + (cur+1);
  /* silent=true 表示本次翻页来自另一个窗口的广播，不再回播，避免回环 */
  if(!silent) bcSend(cur);
  if(PV) pvRender(cur);
  fxRun(s);
  enter(s, cur, false);
}
window.__go = go;
window.__slides = slides;
window.__cur = function(){ return cur; };

document.addEventListener('keydown', function(e){
  if(e.metaKey || e.ctrlKey || e.altKey) return;
  switch(e.key){
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Enter':
      e.preventDefault(); go(cur+1); break;
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
      e.preventDefault(); go(cur-1); break;
    case 'Home': e.preventDefault(); go(0); break;
    case 'End':  e.preventDefault(); go(slides.length-1); break;
    case 'r': case 'R': fxRun(slides[cur]); enter(slides[cur], cur, true); break;
    /* 下面两个在 DeckStage 里由 App 接管（按键到不了页面），只在导出的 HTML 包里起作用 */
    case 'f': case 'F': toggleFull(); break;
    case 'p': case 'P': if(!PV) openPresenter(); break;
  }
});

document.addEventListener('click', function(e){
  if(PV) return;                         /* 演讲者视图靠按钮和键盘 */
  if(window.__lbOpen) return;            /* 灯箱开着不翻页 */
  if(e.target.closest('#dots') || e.target.closest('#lb')) return;
  /* 点图是放大，不是翻页 */
  if(e.target.closest('.imgslot.has') || e.target.closest('[data-avatar] img')) return;
  if(e.clientX < window.innerWidth*0.22) go(cur-1);
  else if(e.clientX > window.innerWidth*0.78) go(cur+1);
});

function toggleFull(){
  if(!document.fullscreenElement) root.requestFullscreen();
  else document.exitFullscreen();
}

function openPresenter(){
  var w = window.open(location.pathname + '?notes=1' + location.hash, 'deck-presenter');
  if(!w) window.__toast('浏览器拦了弹窗，请允许后再按一次 P', 3000);
}

window.__toast = function(msg, ms){
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastEl.__t);
  if(ms !== 0) toastEl.__t = setTimeout(function(){ toastEl.classList.remove('on'); }, ms || 2200);
};

/* ============================================================
   2 双窗同步
   观众窗口 index.html、演讲者窗口 index.html?notes=1，同源多窗口双向同步。
   BroadcastChannel 为主，localStorage 的 storage 事件兜底。
   ============================================================ */
var bc = null;
try{ bc = new BroadcastChannel(CHANNEL); }catch(e){}

function send(msg){
  msg.pv = PV;
  if(bc){ try{ bc.postMessage(msg); }catch(e){} }
  try{ localStorage.setItem(CHANNEL, JSON.stringify({ m:msg, ts:Date.now(), r:Math.random() })); }catch(e){}
}
function bcSend(n){ send({ t:'page', n:n }); }
function handle(d){
  if(!d || !d.t) return;
  if(PV && d.pv) return;   /* 两个演讲者窗口之间不互认 */
  if(d.t === 'page'){
    if(d.n !== cur) go(d.n, true);
  }else if(d.t === 'hello' && !PV){
    /* 新窗口上线，由观众窗口应答当前页；演讲者窗口只跟随 */
    send({ t:'page', n:cur });
  }
}
if(bc) bc.onmessage = function(ev){ handle(ev.data); };
window.addEventListener('storage', function(ev){
  if(ev.key !== CHANNEL || !ev.newValue) return;
  try{ handle(JSON.parse(ev.newValue).m); }catch(e){}
});

/* ============================================================
   3 演讲者视图
   台词在 notes.js，key = 各页 data-t。
   ============================================================ */
var NOTES = window.__NOTES || {};
var pvRender = function(){};
var pvFit = function(){};

if(PV){
  var pvEl = el('div', 'pv', null,
      '<div class="pvtop">'
    +   '<div class="pvno"><b id="pvNo">01</b> / <span id="pvTot">00</span></div>'
    +   '<div class="pvttl" id="pvTitle">—</div>'
    +   '<div class="pvclock"><span class="pvtot" id="pvElapsed" title="点一下重置总计时">00:00</span>'
    +   '<span class="pvpg" id="pvPage">0:00 / 0:00</span></div>'
    +   '<div class="pvnav"><button id="pvPrev" title="上一页（← 也行）">◀</button>'
    +   '<button id="pvNext" title="下一页（→ 也行）">▶</button></div>'
    + '</div>'
    + '<div class="pvmain"><div class="pvstage" id="pvStage"></div><div class="pvbody" id="pvBody"></div></div>');
  document.body.appendChild(pvEl);
  var $ = function(id){ return document.getElementById(id); };
  var elNo = $('pvNo'), elTtl = $('pvTitle'), elEl = $('pvElapsed'), elPg = $('pvPage'), elBody = $('pvBody');
  var pvStage = $('pvStage');
  pvStage.appendChild(stage);
  $('pvTot').textContent = String(slides.length).padStart(2,'0');
  document.title = '演讲者视图 · ' + (CFG.title || document.title);

  /* 台词渲染：「> 」开头是动作提示（别念），**xx** 是重读 */
  var render = function(txt){
    if(!txt) return '<p class="none">这一页还没写台词。</p>';
    var esc  = function(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    var bold = function(s){ return esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>'); };
    var out = '', buf = [];
    var flush = function(){ if(buf.length){ out += '<p>' + buf.join('<br>') + '</p>'; buf = []; } };
    txt.split('\n').forEach(function(raw){
      var line = raw.trim();
      if(!line){ flush(); return; }
      if(line.charAt(0) === '>'){ flush(); out += '<div class="cue">' + bold(line.slice(1).trim()) + '</div>'; return; }
      buf.push(bold(line));
    });
    flush();
    return out;
  };

  /* 计时：总计时 + 本页用时 / 建议时长 */
  var t0 = 0, tp = Date.now(), sec = 0;
  var mmss = function(ms){
    var s = Math.max(0, Math.floor(ms/1000));
    return String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
  };
  elEl.onclick = function(){ t0 = 0; elEl.textContent = '00:00'; };
  var tick = function(){
    elEl.textContent = t0 ? mmss(Date.now()-t0) : '00:00';
    var used = Date.now() - tp;
    elPg.textContent = mmss(used) + ' / ' + mmss(sec*1000);
    elPg.className = 'pvpg' + (!sec ? '' : used > sec*1000 ? ' over' : used > sec*800 ? ' warn' : '');
  };
  setInterval(tick, 500);

  /* 当前页放在 #pvStage 里等比缩放；App 把舞台挪走后这里就不再管 */
  pvFit = function(){
    if(stage.parentElement !== pvStage) return;
    var k = Math.min(pvStage.clientWidth/W, pvStage.clientHeight/H);
    var x = (pvStage.clientWidth - W*k)/2, y = (pvStage.clientHeight - H*k)/2;
    stage.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + k + ')';
  };
  if(window.ResizeObserver) new ResizeObserver(pvFit).observe(pvStage);

  pvRender = function(n){
    var s = slides[n];
    if(!s) return;
    var key = s.dataset.t || '';
    var note = NOTES[key];
    sec = note && note.sec ? note.sec : 0;
    tp = Date.now();
    if(!t0 && n > 0) t0 = Date.now();      /* 离开封面即开始总计时 */
    elNo.textContent  = String(n+1).padStart(2,'0');
    elTtl.textContent = key || ('第 ' + (n+1) + ' 页');
    elBody.innerHTML  = render(note && note.text);
    elBody.scrollTop  = 0;
    $('pvPrev').disabled = (n === 0);
    $('pvNext').disabled = (n === slides.length-1);
    tick();
  };
  $('pvPrev').onclick = function(){ go(cur-1); };
  $('pvNext').onclick = function(){ go(cur+1); };
}

/* ============================================================
   4 素材自动装载
   data-src / data-avatar 指向的文件在 → 换成 <img>；不在 → 保留占位框
   src 带时间戳，换同名图也能立刻看到
   ============================================================ */
window.__assetsReady = (function(){
  var stamp = '?_=' + Date.now();
  var jobs = [];
  function probe(src, onOK){
    return new Promise(function(done){
      var img = new Image();
      img.onload  = function(){ onOK(img); done(true); };
      img.onerror = function(){ done(false); };
      img.src = src + stamp;
    });
  }
  document.querySelectorAll('.imgslot[data-src]').forEach(function(slot){
    jobs.push(probe(slot.dataset.src, function(img){
      img.alt = slot.dataset.alt || '';
      slot.innerHTML = '';
      slot.appendChild(img);
      slot.classList.add('has');
    }));
  });
  document.querySelectorAll('[data-avatar]').forEach(function(ph){
    jobs.push(probe(ph.dataset.avatar, function(img){
      img.alt = ph.dataset.alt || '';
      ph.textContent = '';
      ph.appendChild(img);
      ph.style.borderStyle = 'solid';
    }));
  });
  return Promise.all(jobs);
})();

/* ============================================================
   5 图片灯箱
   点图弹出大图，滚轮以鼠标位置为锚点缩放、按住拖拽平移
   双击在 100% / 250% 之间切换，Esc 关闭
   灯箱开着时点击不翻页；翻页键会先收起灯箱再翻页
   ============================================================ */
(function(){
  var img = document.getElementById('lbImg');
  var pct = document.getElementById('lbPct');
  var cap = document.getElementById('lbCap');
  var MIN = .5, MAX = 8;
  var s = 1, tx = 0, ty = 0;
  var dragging = false, sx = 0, sy = 0, bx = 0, by = 0;

  function apply(){
    img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
    pct.textContent = Math.round(s*100) + '%';
    lbEl.classList.toggle('zoomed', s > 1.01);
  }
  function reset(){ s = 1; tx = ty = 0; apply(); }
  /* 以 (mx,my) 为锚点缩放：让鼠标下的那个像素保持不动 */
  function zoomAt(ns, mx, my){
    ns = Math.min(MAX, Math.max(MIN, ns));
    var r = lbEl.getBoundingClientRect();
    var cx = r.left + r.width/2, cy = r.top + r.height/2;
    tx = mx - cx - (mx - cx - tx) * (ns/s);
    ty = my - cy - (my - cy - ty) * (ns/s);
    s = ns; apply();
  }
  function zoomCenter(f){
    var r = lbEl.getBoundingClientRect();
    zoomAt(s*f, r.left + r.width/2, r.top + r.height/2);
  }
  function open(src, text){
    img.src = src; cap.textContent = text || '';
    reset(); lbEl.classList.add('on'); window.__lbOpen = true;
  }
  function close(){ lbEl.classList.remove('on'); window.__lbOpen = false; }

  /* 事件委托，后补的图也生效 */
  document.addEventListener('click', function(e){
    if(window.__lbOpen) return;
    var t = e.target.closest('#slides .imgslot.has img, #slides [data-avatar] img');
    if(!t) return;
    e.preventDefault();
    var host = t.closest('[data-avatar]');
    var nm = host && host.parentElement && host.parentElement.querySelector('.nm');
    open(t.currentSrc || t.src, t.alt || (nm ? nm.textContent : ''));
  });
  lbEl.querySelector('.bar').addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    var a = b.dataset.lb;
    if(a === 'in')    zoomCenter(1.25);
    if(a === 'out')   zoomCenter(1/1.25);
    if(a === 'fit')   reset();
    if(a === 'close') close();
  });
  lbEl.addEventListener('click', function(e){
    if(e.target === img || e.target.closest('.bar')) return;
    close();
  });
  lbEl.addEventListener('wheel', function(e){
    e.preventDefault();
    zoomAt(s * (e.deltaY < 0 ? 1.13 : 1/1.13), e.clientX, e.clientY);
  }, { passive:false });
  img.addEventListener('dblclick', function(e){
    e.preventDefault();
    if(s > 1.01) reset(); else zoomAt(2.5, e.clientX, e.clientY);
  });
  img.addEventListener('mousedown', function(e){
    e.preventDefault();
    dragging = true; sx = e.clientX; sy = e.clientY; bx = tx; by = ty;
    lbEl.classList.add('drag');
  });
  window.addEventListener('mousemove', function(e){
    if(!dragging) return;
    tx = bx + (e.clientX - sx); ty = by + (e.clientY - sy); apply();
  });
  window.addEventListener('mouseup', function(){ dragging = false; lbEl.classList.remove('drag'); });

  /* capture 阶段先拦，放映键盘收不到。翻页键例外：先收起灯箱，再放行正常翻页 */
  var PAGE_KEYS = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' ','Enter'];
  document.addEventListener('keydown', function(e){
    if(!window.__lbOpen) return;
    var k = e.key;
    if(!e.metaKey && !e.ctrlKey && !e.altKey && PAGE_KEYS.indexOf(k) >= 0){ close(); return; }
    if(k === 'Escape')              close();
    else if(k === '+' || k === '=') zoomCenter(1.25);
    else if(k === '-' || k === '_') zoomCenter(1/1.25);
    else if(k === '0')              reset();
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();

/* ============================================================
   6 动效引擎
   每次进入一页就重播这一页的动效（按 R 也重播）：
     [data-seq="开始ms 间隔ms"]  容器里的 .q 按文档顺序逐条加 .in
         .q[data-d="ms"]         覆盖这一条与上一条的间隔
         .q[data-add="cls"]      这一条出现时，给所属 [data-seq] 容器加 cls
     [data-type="延迟ms"]        逐字打出（data-speed 每字毫秒，默认 26）
                                 在 [data-seq] 里时，打完才轮到下一条
     [data-count="目标值"]        数字从 0 滚到目标值（data-dur 毫秒，默认 1200）
   导出 PPTX / 稿库预览（body.exporting）直接显示终态
   ============================================================ */
var fxRun = (function(){
  var timers = [];
  var token = 0;
  function later(fn, ms){ var t = setTimeout(fn, ms); timers.push(t); return t; }
  function clearAll(){ timers.forEach(clearTimeout); timers = []; token++; }

  /* 逐字：把文本节点拆成 .ch，只做一次 */
  function splitChars(x){
    if(x.__split) return;
    x.__split = true;
    var walker = document.createTreeWalker(x, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while(walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function(n){
      var frag = document.createDocumentFragment();
      Array.from(n.nodeValue).forEach(function(c){
        var sp = document.createElement('span');
        sp.className = 'ch';
        sp.textContent = c;
        frag.appendChild(sp);
      });
      n.parentNode.replaceChild(frag, n);
    });
    x.appendChild(el('i', null, 'caret'));
  }
  /* 打字，返回总耗时 ms */
  function typeIn(x, my){
    splitChars(x);
    var chs = x.querySelectorAll('.ch');
    var sp = +x.getAttribute('data-speed') || 26;
    x.classList.remove('done');
    chs.forEach(function(c, i){ later(function(){ if(my === token) c.classList.add('in'); }, i * sp); });
    var total = chs.length * sp;
    later(function(){ if(my === token) x.classList.add('done'); }, total + 60);
    return total + 120;
  }
  function countUp(x, my){
    var to = +x.getAttribute('data-count');
    var dur = +x.getAttribute('data-dur') || 1200;
    var start = performance.now();
    function step(now){
      if(my !== token) return;
      var p = Math.min(1, (now - start) / dur);
      x.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if(p < 1) requestAnimationFrame(step);
    }
    x.textContent = '0';
    requestAnimationFrame(step);
  }
  function ownItems(seq){
    return [].filter.call(seq.querySelectorAll('.q'), function(q){ return q.closest('[data-seq]') === seq; });
  }
  function runSeq(seq, my){
    var cfg = (seq.getAttribute('data-seq') || '').trim().split(/\s+/);
    var t = +cfg[0] || 300;
    var gap = +cfg[1] || 380;
    ownItems(seq).forEach(function(q, i){
      if(i > 0) t += q.hasAttribute('data-d') ? +q.getAttribute('data-d') : gap;
      var at = t;
      later(function(){
        if(my !== token) return;
        q.classList.add('in');
        var add = q.getAttribute('data-add');
        if(add) seq.classList.add(add);
        /* 嵌套序列：等这一条出现后再启动 */
        q.querySelectorAll('[data-seq]').forEach(function(inner){
          if(inner.parentElement.closest('.q') === q) runSeq(inner, my);
        });
      }, at);
      var ty = q.matches('[data-type]') ? q : q.querySelector('[data-type]');
      if(ty){
        later(function(){ if(my === token) typeIn(ty, my); }, at);
        splitChars(ty);
        t += ty.querySelectorAll('.ch').length * (+ty.getAttribute('data-speed') || 26) + 160;
      }
    });
  }
  function reset(s){
    s.querySelectorAll('.q.in').forEach(function(q){ q.classList.remove('in'); });
    s.querySelectorAll('[data-type]').forEach(function(x){
      x.classList.remove('done');
      x.querySelectorAll('.ch.in').forEach(function(c){ c.classList.remove('in'); });
    });
    s.querySelectorAll('[data-seq]').forEach(function(seq){
      ownItems(seq).forEach(function(q){
        var add = q.getAttribute('data-add');
        if(add) seq.classList.remove(add);
      });
    });
  }
  return function run(s){
    clearAll();
    var my = token;
    reset(s);
    if(document.body.classList.contains('exporting')){
      s.querySelectorAll('.q').forEach(function(q){
        q.classList.add('in');
        var add = q.getAttribute('data-add'); var seq = q.closest('[data-seq]');
        if(add && seq) seq.classList.add(add);
      });
      s.querySelectorAll('[data-type]').forEach(function(x){
        splitChars(x); x.classList.add('done');
        x.querySelectorAll('.ch').forEach(function(c){ c.classList.add('in'); });
      });
      s.querySelectorAll('[data-count]').forEach(function(x){ x.textContent = x.getAttribute('data-count'); });
      return;
    }
    s.querySelectorAll('[data-seq]').forEach(function(seq){
      if(!seq.parentElement.closest('.q')) runSeq(seq, my);   /* 只启动顶层序列 */
    });
    s.querySelectorAll('[data-type]').forEach(function(x){
      if(x.closest('[data-seq]')) return;
      var d = +x.getAttribute('data-type') || 300;
      later(function(){ if(my === token) typeIn(x, my); }, d);
    });
    s.querySelectorAll('[data-count]').forEach(function(x){ countUp(x, my); });
  };
})();

/* 导出 / 预览开关 body.exporting 后，当前页的动效要立刻切到终态 */
var wasExporting = false;
new MutationObserver(function(){
  var on = document.body.classList.contains('exporting');
  if(on === wasExporting) return;
  wasExporting = on;
  if(slides[cur]) fxRun(slides[cur]);
}).observe(document.body, { attributes:true, attributeFilter:['class'] });

/* ============================================================
   7 导出 PPTX
   逐页用 html2canvas 截成位图，按 16:9 全屏铺进 pptx：版式 100% 还原，文字不可再编辑。
   由 DeckStage 调用 window.__deckExport()；进度和结果写在 #toast 里（App 读它）。
   ============================================================ */
(function(){
  var SCALE = PPTX.scale || 1.25;        /* 1600 → 2000px 宽，约 200 DPI */
  var BG    = PPTX.bgColor || getComputedStyle(root).getPropertyValue('--bg0').trim() || '#101014';
  var busy = false;

  function load(src){
    return new Promise(function(ok, bad){
      var sc = document.createElement('script');
      sc.src = src;
      sc.onload = ok;
      sc.onerror = function(){ bad(new Error('导出库加载失败：' + src)); };
      document.head.appendChild(sc);
    });
  }
  function libs(){
    var jobs = [];
    if(typeof html2canvas === 'undefined') jobs.push(load(BASE + 'lib/html2canvas.min.js'));
    if(typeof PptxGenJS === 'undefined') jobs.push(load(BASE + 'lib/pptxgen.bundle.js'));
    return Promise.all(jobs);
  }

  window.__deckExport = async function(){
    if(busy) return;
    busy = true;
    var back = cur;
    var savedTransform = stage.style.transform;
    try{
      window.__toast('正在准备导出 …', 0);
      await libs();
      /* 等素材装载完再截图，否则刚打开就导出会漏掉图 */
      await window.__assetsReady;
      /* 进入导出模式：取消缩放，让 html2canvas 拿到真实画布尺寸 */
      document.body.classList.add('exporting');
      stage.style.transform = 'translate(-50%,-50%) scale(1)';

      var pptx = new PptxGenJS();
      var LAYOUT = PPTX.layoutName || 'DECK16x9';
      pptx.defineLayout({ name:LAYOUT, width:13.333, height:7.5 });
      pptx.layout = LAYOUT;
      pptx.title = PPTX.title || CFG.title || document.title;
      if(PPTX.author)  pptx.author  = PPTX.author;
      if(PPTX.subject) pptx.subject = PPTX.subject;

      for(var i=0; i<slides.length; i++){
        window.__toast('正在导出 ' + (i+1) + ' / ' + slides.length + ' …', 0);
        go(i, true);
        /* 等两帧 + 一点余量，确保布局与 SVG 图表都已绘制 */
        await new Promise(function(r){
          requestAnimationFrame(function(){ requestAnimationFrame(function(){ setTimeout(r, 90); }); });
        });
        var canvas = await html2canvas(stage, {
          backgroundColor:BG, scale:SCALE, width:W, height:H,
          windowWidth:W, windowHeight:H, useCORS:true, allowTaint:true, logging:false,
          scrollX:0, scrollY:0, imageTimeout:0
        });
        pptx.addSlide().addImage({ data: canvas.toDataURL('image/png'), x:0, y:0, w:13.333, h:7.5 });
        canvas.width = canvas.height = 0;   /* 及早释放，几十页不至于把内存打满 */
      }
      window.__toast('正在打包 pptx …', 0);
      await pptx.writeFile({ fileName: PPTX.fileName || ((CFG.title || document.title || 'deck') + '.pptx') });
      window.__toast('导出完成，共 ' + slides.length + ' 页', 3200);
    }catch(err){
      console.error(err);
      window.__toast('导出失败：' + (err && err.message ? err.message : err), 6000);
    }finally{
      document.body.classList.remove('exporting');
      stage.style.transform = savedTransform;
      go(back, true);
      busy = false;
    }
  };
})();

/* ============================================================
   启动：从 hash 恢复页码（刷新后停在原页），然后通知其他窗口自己上线了
   ============================================================ */
fit();
var m = /^#p(\d+)$/.exec(location.hash);
go(m ? Math.max(0, Math.min(parseInt(m[1],10)-1, slides.length-1)) : 0, true);
send({ t:'hello' });
document.addEventListener('DOMContentLoaded', function(){ booted = true; enter(slides[cur], cur, false); });

})();
