/* ============================================================
   deck-html · 放映内核（固定层）

   六个模块，都靠 deck.config.js 里的 window.__DECK 配置驱动：
     1 放映内核     固定画布等比缩放、键盘 / 点击 / 圆点导航、页脚注入
     2 双屏同步     BroadcastChannel + localStorage 兜底
     3 演讲者视图   ?notes=1，台词 + 计时 + 幻灯预览条
     4 素材自动装载 assets/ 里有图就换上，没有就保留占位框
     5 图片灯箱     点图放大，滚轮缩放、拖拽平移
     6 导出 PPTX    逐页 html2canvas 截图铺进 16:9

   ⚠️ 改这个文件等于改所有稿子。稿子专属逻辑（图表、特效）请写在
   index.html 自己的 <script> 里，不要往这里塞。

   对外暴露的钩子（稿子里可以用）：
     window.__go(n)        跳到第 n 页（0 起）
     window.__cur()        当前页序号
     window.__slides       所有 .slide 节点
     window.__toast(msg,ms) 底部提示，ms=0 表示不自动消失
     window.__assetsReady  素材装载完成的 Promise
   ============================================================ */

(function(){
'use strict';

/* ---------- 配置：给全部字段兜底，稿子只写自己关心的 ---------- */
var CFG = window.__DECK || {};
var W = CFG.W || 1600, H = CFG.H || 900;
var CHANNEL = CFG.channel || 'deck-html-sync';
var PPTX = CFG.pptx || {};
var RAIL = CFG.rail || null;
var PV = document.documentElement.classList.contains('pv');

document.documentElement.style.setProperty('--deck-w', W + 'px');
document.documentElement.style.setProperty('--deck-h', H + 'px');

/* 渐变文字的导出降级：html2canvas 渲染不了 background-clip:text，
   不降级的话导出后那行字直接是空白。规则从配置读，避免漏改。 */
(function injectExportFallback(){
  var list = CFG.gradientText || [];
  if(!list.length) return;
  var css = list.map(function(r){
    return '.exporting ' + r.sel + '{background:none !important;'
         + '-webkit-text-fill-color:' + r.color + ' !important;'
         + 'color:' + r.color + ' !important;}';
  }).join('\n');
  var st = document.createElement('style');
  st.id = 'deckExportFallback';
  st.textContent = css;
  document.head.appendChild(st);
})();

/* ============================================================
   1 放映内核
   ============================================================ */
var stage  = document.getElementById('stage');
var slides = Array.from(document.querySelectorAll('.slide'));
var prog   = document.getElementById('prog');
var dots   = document.getElementById('dots');
var toastEl= document.getElementById('toast');
var cur = 0;

/* 页脚台阶条：靠幕间页的 data-t 动态推导当前处在第几级，
   增删页都不会错位。RAIL 不配则页脚只有页码。 */
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
  var f = document.createElement('div');
  f.className = 'footer';
  f.innerHTML = html;
  s.appendChild(f);
});

/* 背景光斑：配置里给了才画 */
(function bokeh(){
  var bg = document.getElementById('bg');
  if(!bg || !CFG.bokeh || !CFG.bokeh.length) return;
  CFG.bokeh.forEach(function(c, i){
    var b = document.createElement('div');
    b.className = 'bokeh';
    b.style.cssText = 'left:' + c[0] + '%;top:' + c[1] + '%;width:' + c[2] + 'px;height:'
                    + c[2] + 'px;background:' + c[3] + ';animation-duration:' + c[4]
                    + 's;animation-delay:-' + (i * 2.4) + 's';
    bg.appendChild(b);
  });
})();

slides.forEach(function(s, i){
  var d = document.createElement('i');
  d.title = (i+1) + '. ' + (s.dataset.t || '');
  d.onclick = function(){ go(i); };
  dots.appendChild(d);
});
var dotEls = Array.from(dots.children);

function fit(){
  /* 演讲者视图里舞台被降级成缩略图，缩放交给 pvFit 按预览槽算 */
  if(document.documentElement.classList.contains('pv')){
    if(window.__pvFit) window.__pvFit();
    return;
  }
  var k = Math.min(window.innerWidth/W, window.innerHeight/H);
  stage.style.transform = 'translate(-50%,-50%) scale(' + k + ')';
}
window.addEventListener('resize', fit);
fit();

function go(n, silent){
  if(n < 0 || n >= slides.length) return;
  slides[cur].classList.remove('on');
  cur = n;
  var s = slides[cur];
  /* 重置动画：强制重排让 stagger 重新播放 */
  s.querySelectorAll('.an').forEach(function(el){ el.style.animation = 'none'; });
  s.classList.add('on');
  void s.offsetWidth;
  s.querySelectorAll('.an').forEach(function(el){ el.style.animation = ''; });
  prog.style.width = ((cur+1)/slides.length*100) + '%';
  dotEls.forEach(function(d, i){ d.classList.toggle('on', i === cur); });
  location.hash = 'p' + (cur+1);
  /* silent=true 表示本次翻页来自另一个窗口的广播，不再回播，避免回环 */
  if(!silent && window.__bcSend) window.__bcSend(cur);
  if(window.__pvRender) window.__pvRender(cur);
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
    case 'f': case 'F': toggleFull(); break;
  }
});

document.addEventListener('click', function(e){
  if(document.documentElement.classList.contains('pv')) return;  /* 演讲者视图靠按钮 */
  if(window.__lbOpen) return;                                    /* 灯箱开着不翻页 */
  if(e.target.closest('#tools') || e.target.closest('#dots')) return;
  if(e.target.closest('#lb')) return;
  /* 点图是放大，不是翻页 */
  if(e.target.closest('.imgslot.has') || e.target.closest('[data-avatar] img')) return;
  if(e.clientX < window.innerWidth*0.22) go(cur-1);
  else if(e.clientX > window.innerWidth*0.78) go(cur+1);
});

function toggleFull(){
  if(!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
}
var btnFull = document.getElementById('btnFull');
if(btnFull) btnFull.onclick = toggleFull;

window.__toast = function(msg, ms){
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastEl.__t);
  if(ms !== 0) toastEl.__t = setTimeout(function(){ toastEl.classList.remove('on'); }, ms || 2200);
};

/* 从 hash 恢复，方便刷新后停在原页 */
var m = /^#p(\d+)$/.exec(location.hash);
go(m ? Math.min(parseInt(m[1],10)-1, slides.length-1) : 0);


/* ============================================================
   2 双屏同步 + 3 演讲者视图
     观众视图   index.html#p1        → 主屏 / 投影
     演讲者视图 index.html?notes=1   → 小屏，念台词 + 控翻页
   同一浏览器多窗口用 BroadcastChannel 双向同步，无服务端、无轮询。
   台词在 notes.js，key = 各页 data-t，增删页不会错位。
   ============================================================ */
(function(){
  var NOTES = window.__NOTES || {};

  /* 双通道：BroadcastChannel 为主，localStorage storage 事件兜底。
     两者都受同源限制 —— 主屏和小屏的 协议 + 域名 + 端口 必须完全一致，
     所以观众视图提供「演讲者视图」按钮用 window.open 打开，从根上避免敲错地址。 */
  var bc = null;
  try{ bc = new BroadcastChannel(CHANNEL); }catch(e){}

  var peerAt = 0, everLive = false;
  var openedAt = Date.now();

  function send(msg, beat){
    msg.pv = PV;
    if(bc){ try{ bc.postMessage(msg); }catch(e){} }
    if(beat) return;   /* 心跳不落 localStorage，免得两秒一次刷爆存储事件 */
    try{
      localStorage.setItem(CHANNEL, JSON.stringify({ m:msg, ts:Date.now(), r:Math.random() }));
    }catch(e){}
  }

  function handle(d){
    if(!d || !d.t) return;
    if(PV && d.pv) return;   /* 两个演讲者视图之间不互认，免得自己跟自己「连上」 */
    peerAt = Date.now();
    everLive = true;
    if(d.t === 'beat') return;
    if(d.t === 'page'){
      if(d.n !== window.__cur()) window.__go(d.n, true);
    }else if(d.t === 'hello' && !PV){
      /* 新窗口上线，由观众视图应答当前页；演讲者视图只跟随，不抢主导 */
      send({ t:'page', n:window.__cur() });
    }
  }

  /* go() 翻页后回调；silent 翻页不会走到这里，所以不会回环 */
  window.__bcSend = function(n){ send({ t:'page', n:n }); };

  if(bc) bc.onmessage = function(ev){ handle(ev.data); };
  window.addEventListener('storage', function(ev){
    if(ev.key !== CHANNEL || !ev.newValue) return;
    try{ handle(JSON.parse(ev.newValue).m); }catch(e){}
  });

  send({ t:'hello' });
  /* BroadcastChannel 没有连接状态，靠定期打点判断对端还在不在。
     两个窗口都被切到后台时浏览器会降频，回到前台几秒内自动恢复。 */
  setInterval(function(){ send({ t:'beat' }, true); }, 2000);

  var btnPV = document.getElementById('btnPV');
  if(btnPV && !PV){
    btnPV.onclick = function(){
      var w = window.open(location.pathname + '?notes=1' + location.hash, 'deck-presenter');
      if(!w) window.__toast('浏览器拦了弹窗，请允许后再点一次', 3000);
      else    window.__toast('演讲者视图已打开，把它拖到小屏', 2600);
    };
  }

  if(!PV) return;   /* 观众视图到此为止 */

  /* ---------- 以下只在演讲者视图执行 ---------- */
  var $ = function(id){ return document.getElementById(id); };
  var elNo=$('pvNo'), elTot=$('pvTot'), elTtl=$('pvTitle'), elEl=$('pvElapsed'),
      elPg=$('pvPage'), elBody=$('pvBody'), elLink=$('pvLink'), elWarn=$('pvWarn');

  elTot.textContent = String(slides.length).padStart(2,'0');
  document.title = '演讲者视图 · ' + (CFG.title || document.title);

  /* 台词渲染：「> 」开头是动作提示（别念），**xx** 是重读 */
  function render(txt){
    if(!txt) return '<p class="none">这一页还没写台词。</p>';
    var esc  = function(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    var bold = function(s){ return esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>'); };
    var out = '', buf = [];
    function flush(){ if(buf.length){ out += '<p>' + buf.join('<br>') + '</p>'; buf = []; } }
    txt.split('\n').forEach(function(raw){
      var line = raw.trim();
      if(!line){ flush(); return; }
      if(line.charAt(0) === '>'){
        flush();
        out += '<div class="cue">' + bold(line.slice(1).trim()) + '</div>';
        return;
      }
      buf.push(bold(line));
    });
    flush();
    return out;
  }

  /* ---------- 计时：总计时 + 本页用时 / 建议时长 ---------- */
  var t0 = 0, tp = Date.now(), sec = 0;
  function mmss(ms){
    var s = Math.max(0, Math.floor(ms/1000));
    return String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
  }
  elEl.style.cursor = 'pointer';
  elEl.title = '点一下重置总计时';
  elEl.onclick = function(){ t0 = 0; elEl.textContent = '00:00'; };

  function tick(){
    elEl.textContent = t0 ? mmss(Date.now()-t0) : '00:00';
    var used = Date.now() - tp;
    elPg.textContent = mmss(used) + ' / ' + mmss(sec*1000);
    elPg.className = 'pvpg' + (!sec ? '' : used > sec*1000 ? ' over' : used > sec*800 ? ' warn' : '');
    var live = Date.now()-peerAt < 12000;
    elLink.className = 'pvlink' + (live ? ' ok' : '');
    elLink.querySelector('em').textContent = live ? '已连主屏' : '未连主屏';
    elLink.title = '本窗口 origin：' + location.origin;
    /* 开着几秒还没握上手，就把原因摆出来，别让人猜。
       曾经连上过和从来没连上过，原因不一样，文案也分开。 */
    var warn = (!live && Date.now()-openedAt > 4000);
    elWarn.classList.toggle('on', warn);
    var kind = everLive ? 'lost' : 'never';
    if(warn && elWarn.dataset.kind !== kind){
      elWarn.dataset.kind = kind;
      elWarn.innerHTML = everLive
        ? '和主屏断了联系。可能是主屏窗口被关了或刷新了，也可能两个窗口都切到了后台被浏览器降频——'
          + '主屏回到前台后几秒内会自动恢复，翻一页也能立刻重连。'
        : '没检测到主屏窗口。要么主屏还没开，要么两个窗口不<b>同源</b>——协议、域名、端口三者必须完全一致。'
          + '本窗口是 <code>' + location.origin + '</code>；'
          + '<code>127.0.0.1</code> 和局域网 IP 算两个不同站点。'
          + '<br>最省事的做法：回主屏点右上角 <b>⧉ 演讲者视图</b>，让它替你开这个窗口。';
    }
  }
  setInterval(tick, 500);

  /* ---------- 幻灯预览条 ----------
     全部页横向滚动，点任意一格跳过去。当前页那一格放的是观众舞台本体，
     所以永远和投影一致；其余格子由 IntersectionObserver 滚到附近才填克隆。 */
  var elShots = $('pvShots');
  var shots = [];
  var clones = new Map();     /* index → 克隆节点，移出 DOM 也留着复用 */
  var nowIdx = -1, SH = 150, SW = 267;

  function cloneOf(i){
    if(clones.has(i)) return clones.get(i);
    var s = slides[i];
    if(!s) return null;
    var c = s.cloneNode(true);
    c.classList.add('on');
    /* 克隆体不参与任何脚本查询，也不重播入场动画 */
    c.removeAttribute('data-t');
    c.querySelectorAll('[id]').forEach(function(el){ el.removeAttribute('id'); });
    c.querySelectorAll('.an').forEach(function(el){ el.style.animation = 'none'; });
    clones.set(i, c);
    return c;
  }

  function fill(i){
    var d = shots[i];
    if(!d || d.classList.contains('now')) return;   /* now 那格用 stage 本体 */
    var mini = d.firstElementChild;
    var c = cloneOf(i);
    if(c && mini.firstElementChild !== c){ mini.textContent = ''; mini.appendChild(c); }
  }

  var io = ('IntersectionObserver' in window)
    ? new IntersectionObserver(function(list){
        list.forEach(function(en){
          if(en.isIntersecting) fill(parseInt(en.target.dataset.i, 10));
        });
      }, { root: elShots, rootMargin: '320px 0px' })
    : null;

  function applySize(){
    /* 预览条高度取视口 30%，夹在 118~330px；台词区靠 flex 让位并可上下滑 */
    SH = Math.max(118, Math.min(330, Math.round(window.innerHeight*0.30)));
    SW = Math.round(SH * W / H);
    var k = 'scale(' + (SW/W) + ')';
    shots.forEach(function(d){
      d.style.width = SW + 'px'; d.style.height = SH + 'px';
      d.firstElementChild.style.transform = k;
    });
    stage.style.transform = k;
  }

  function build(){
    elShots.textContent = '';
    shots.length = 0;
    slides.forEach(function(s, i){
      var d = document.createElement('div');
      d.className = 'shot';
      d.dataset.i = String(i);
      d.title = (i+1) + '. ' + (s.dataset.t || '');
      var mini = document.createElement('div'); mini.className = 'mini';
      var cap  = document.createElement('div'); cap.className  = 'cap';
      cap.textContent = String(i+1).padStart(2,'0') + ' ' + (s.dataset.t || '');
      d.appendChild(mini); d.appendChild(cap);
      d.onclick = function(){ window.__go(i); };
      elShots.appendChild(d);
      shots.push(d);
      if(io) io.observe(d);
    });
    applySize();
  }

  function setNow(n){
    if(nowIdx === n) return;
    var old = shots[nowIdx];
    if(old){ old.classList.remove('now'); fill(nowIdx); }
    nowIdx = n;
    var d = shots[n];
    if(!d) return;
    d.classList.add('now');
    d.firstElementChild.textContent = '';        /* 腾出位置给真舞台 */
    d.insertBefore(stage, d.lastElementChild);
    stage.classList.add('ready');
  }

  /* 定位一律瞬时：现场要的是确定性，滚动动画只会让人分心，
     而且平滑滚动被连续翻页打断时容易停在半路 */
  function scrollToNow(){
    var d = shots[nowIdx];
    if(!d) return;
    elShots.scrollLeft = Math.max(0, d.offsetLeft - (elShots.clientWidth - d.offsetWidth)/2);
  }

  /* 鼠标滚轮竖滚 → 预览条横滚，触控板横扫保持原样 */
  elShots.addEventListener('wheel', function(e){
    if(Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    elShots.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive:false });

  window.addEventListener('resize', function(){ applySize(); scrollToNow(); });

  $('pvFold').onclick = function(){
    var box = document.getElementById('pv');
    box.classList.toggle('fold');
    this.textContent = box.classList.contains('fold') ? '▥' : '▤';
    if(!box.classList.contains('fold')){ applySize(); scrollToNow(); }
  };

  window.__pvRender = function(n){
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
    setNow(n);
    scrollToNow();
    $('pvPrev').disabled = (n === 0);
    $('pvNext').disabled = (n === slides.length-1);
    tick();
  };

  window.__pvFit = function(){ applySize(); };

  $('pvPrev').onclick = function(){ window.__go(window.__cur()-1); };
  $('pvNext').onclick = function(){ window.__go(window.__cur()+1); };

  /* 首次渲染推到本轮同步脚本之后：稿子自己的图表和素材装载都在后面跑，
     否则先建出来的克隆会是空图表 / 空图位 */
  setTimeout(function(){
    build();
    window.__pvRender(window.__cur());
    if(window.__assetsReady && window.__assetsReady.then)
      window.__assetsReady.then(function(){
        clones.clear();                    /* 图片装好了，克隆重建一遍 */
        shots.forEach(function(d, i){
          if(!d.classList.contains('now') && d.firstElementChild.firstElementChild){
            d.firstElementChild.textContent = '';
            fill(i);
          }
        });
      });
  }, 0);
})();


/* ============================================================
   4 素材自动装载
   丢图进 assets/ → 刷新页面即生效，不需要改 HTML
   探测 data-src / data-avatar 指向的文件：
     在   → 换成 <img>，去掉虚线占位框
     不在 → 原样保留占位框（不报错、不留空洞）
   src 带时间戳，换同名图也能立刻看到，不吃浏览器缓存
   ============================================================ */
window.__assetsReady = (function(){
  var stamp = '?_=' + Date.now();
  var jobs = [];

  function probe(src, onOK){
    return new Promise(function(done){
      var img = new Image();
      img.onload  = function(){ onOK(img); done(true); };
      img.onerror = function(){ done(false); };   /* 文件不存在，保持占位 */
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
   灯箱开着时点击不翻页；按翻页键（方向键 / PageUp / PageDown / 空格 / 回车 / Home / End）会先收起灯箱再翻页
   ============================================================ */
(function(){
  var lb  = document.getElementById('lb');
  if(!lb) return;
  var img = document.getElementById('lbImg');
  var pct = document.getElementById('lbPct');
  var cap = document.getElementById('lbCap');
  var MIN = .5, MAX = 8;
  var s = 1, tx = 0, ty = 0;
  var dragging = false, sx = 0, sy = 0, bx = 0, by = 0;

  function apply(){
    img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
    pct.textContent = Math.round(s*100) + '%';
    lb.classList.toggle('zoomed', s > 1.01);
  }
  function reset(){ s = 1; tx = ty = 0; apply(); }

  /* 以 (mx,my) 为锚点缩放：让鼠标下的那个像素保持不动 */
  function zoomAt(ns, mx, my){
    ns = Math.min(MAX, Math.max(MIN, ns));
    var r = lb.getBoundingClientRect();
    var cx = r.left + r.width/2, cy = r.top + r.height/2;
    tx = mx - cx - (mx - cx - tx) * (ns/s);
    ty = my - cy - (my - cy - ty) * (ns/s);
    s = ns; apply();
  }
  function zoomCenter(f){
    var r = lb.getBoundingClientRect();
    zoomAt(s*f, r.left + r.width/2, r.top + r.height/2);
  }

  function open(src, text){
    img.src = src; cap.textContent = text || '';
    reset(); lb.classList.add('on'); window.__lbOpen = true;
  }
  function close(){ lb.classList.remove('on'); window.__lbOpen = false; }

  /* 事件委托，后补的图也生效 */
  document.addEventListener('click', function(e){
    if(window.__lbOpen) return;
    var t = e.target.closest('.imgslot.has img, [data-avatar] img');
    if(!t) return;
    e.preventDefault();
    var host = t.closest('[data-avatar]');
    var nm = host && host.parentElement && host.parentElement.querySelector('.nm');
    open(t.currentSrc || t.src, t.alt || (nm ? nm.textContent : ''));
  });

  lb.querySelector('.bar').addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    var a = b.dataset.lb;
    if(a === 'in')    zoomCenter(1.25);
    if(a === 'out')   zoomCenter(1/1.25);
    if(a === 'fit')   reset();
    if(a === 'close') close();
  });

  lb.addEventListener('click', function(e){
    if(e.target === img || e.target.closest('.bar')) return;
    close();
  });

  lb.addEventListener('wheel', function(e){
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
    lb.classList.add('drag');
  });
  window.addEventListener('mousemove', function(e){
    if(!dragging) return;
    tx = bx + (e.clientX - sx); ty = by + (e.clientY - sy); apply();
  });
  window.addEventListener('mouseup', function(){
    dragging = false; lb.classList.remove('drag');
  });

  /* capture 阶段先拦，放映内核收不到。
     翻页键例外：先收起灯箱，再放行给内核正常翻页——点了图之后按方向键，应该是翻页而不是没反应 */
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
   6 导出 PPTX
   逐页用 html2canvas 截成位图，按 16:9 全屏铺进 pptx
   —— 图片方案能 100% 还原版式，代价是文字不可再编辑
   前提：同目录下有 lib/html2canvas.min.js 与 lib/pptxgen.bundle.js，
   且从 http:// 打开（file:// 会因 canvas 跨域污染导出失败）
   ============================================================ */
(function(){
  var btn = document.getElementById('btnPptx');
  if(!btn) return;
  var SCALE = PPTX.scale || 1.25;        /* 1600 → 2000px 宽，约 200 DPI */
  var BG    = PPTX.bgColor || '#101014';
  var busy = false;

  btn.onclick = async function(){
    if(busy) return;
    if(typeof html2canvas === 'undefined' || typeof PptxGenJS === 'undefined'){
      window.__toast('导出库未加载：请确认同目录下存在 lib/html2canvas.min.js 与 lib/pptxgen.bundle.js', 5000);
      return;
    }
    busy = true; btn.disabled = true;
    /* 等素材装载完再截图，否则刚打开就导出会漏掉图 */
    if(window.__assetsReady) await window.__assetsReady;
    var back = (function(){
      var mm = /^#p(\d+)$/.exec(location.hash); return mm ? parseInt(mm[1],10)-1 : 0;
    })();

    /* 进入导出模式：取消缩放，让 html2canvas 拿到真实画布尺寸 */
    var savedTransform = stage.style.transform;
    document.body.classList.add('exporting');
    stage.style.transform = 'translate(-50%,-50%) scale(1)';

    try{
      var pptx = new PptxGenJS();
      var LAYOUT = PPTX.layoutName || 'DECK16x9';
      pptx.defineLayout({ name:LAYOUT, width:13.333, height:7.5 });
      pptx.layout = LAYOUT;
      if(PPTX.author)  pptx.author  = PPTX.author;
      if(PPTX.title)   pptx.title   = PPTX.title;
      if(PPTX.subject) pptx.subject = PPTX.subject;

      for(var i=0; i<slides.length; i++){
        window.__toast('正在导出 ' + (i+1) + ' / ' + slides.length + ' …', 0);
        go(i);
        /* 等两帧 + 一点余量，确保布局与 SVG 图表都已绘制 */
        await new Promise(function(r){
          requestAnimationFrame(function(){
            requestAnimationFrame(function(){ setTimeout(r, 90); });
          });
        });

        var canvas = await html2canvas(stage, {
          backgroundColor:BG,
          scale:SCALE, width:W, height:H,
          windowWidth:W, windowHeight:H,
          useCORS:true, allowTaint:true, logging:false,
          scrollX:0, scrollY:0, imageTimeout:0
        });
        pptx.addSlide().addImage({
          data: canvas.toDataURL('image/png'),
          x:0, y:0, w:13.333, h:7.5
        });
        canvas.width = canvas.height = 0;   /* 及早释放，几十页不至于把内存打满 */
      }

      window.__toast('正在打包 pptx …', 0);
      await pptx.writeFile({ fileName: PPTX.fileName || 'deck.pptx' });
      window.__toast('导出完成，共 ' + slides.length + ' 页', 3200);
    }catch(err){
      console.error(err);
      window.__toast('导出失败：' + (err && err.message ? err.message : err), 6000);
    }finally{
      document.body.classList.remove('exporting');
      stage.style.transform = savedTransform;
      go(back);
      busy = false; btn.disabled = false;
    }
  };

  /* ---------- 自检：?selftest=1 试截一页并把结果写进 document.title ----------
     用途：不打开界面也能确认导出链路通不通（库有没有加载、canvas 有没有被污染）。
     用法：curl 拿不到 title，得用浏览器或无头浏览器读 document.title。 */
  if(/[?&]selftest=1/.test(location.search)){
    window.addEventListener('load', async function(){
      var q = new URLSearchParams(location.search);
      var page = parseInt(q.get('p') || '1', 10);
      var sc   = parseFloat(q.get('scale') || '0.5');
      var r = [];
      r.push('h2c='  + (typeof html2canvas !== 'undefined'));
      r.push('pptx=' + (typeof PptxGenJS  !== 'undefined'));
      try{
        go(Math.min(Math.max(page,1), slides.length) - 1);
        document.body.classList.add('exporting');
        stage.style.transform = 'translate(-50%,-50%) scale(1)';
        await new Promise(function(res){ setTimeout(res, 260); });
        var c = await html2canvas(stage, { backgroundColor:BG, scale:sc,
          width:W, height:H, windowWidth:W, windowHeight:H,
          useCORS:true, allowTaint:true, logging:false, imageTimeout:0 });
        var url = c.toDataURL('image/png');
        r.push('page=' + page);
        r.push('canvas=' + c.width + 'x' + c.height);
        r.push('dataurl=' + Math.round(url.length/1024) + 'KB');
        r.push('OK');
      }catch(e){ r.push('FAIL:' + (e && e.message ? e.message : e)); }
      finally{ document.body.classList.remove('exporting'); }
      document.title = 'SELFTEST ' + r.join(' | ');
    });
  }
})();

})();
