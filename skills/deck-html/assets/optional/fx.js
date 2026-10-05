/* ============================================================
   fx.js · 可选的动效引擎（放在 deck.js 之后加载）
   配套样式：fx.css。用法与约定见 references/effects.md。

   每次某页变成 .on 就重播这一页的动效：
     [data-seq="开始ms 间隔ms"]  容器里的 .q 按文档顺序逐条加 .in
         .q[data-d="ms"]         覆盖这一条与上一条的间隔
         .q[data-add="cls"]      这一条出现时，给所属 [data-seq] 容器加 cls
     [data-type="延迟ms"]        逐字打出（data-speed 每字毫秒，默认 26）
                                 在 [data-seq] 里时，打完才轮到下一条
     [data-count="目标值"]        数字从 0 滚到目标值（data-dur 毫秒，默认 1200）
   键盘 R：重播当前页动效
   导出 PPTX（body.exporting）与演讲者视图缩略图克隆体：CSS 直接显示终态
   ============================================================ */
(function(){
  'use strict';

  var slides = window.__slides || [].slice.call(document.querySelectorAll('.slide'));
  var timers = [];
  var token = 0;

  function later(fn, ms){ var t = setTimeout(fn, ms); timers.push(t); return t; }
  function clearAll(){ timers.forEach(clearTimeout); timers = []; token++; }

  /* ---------- 逐字：把文本节点拆成 .ch，只做一次 ---------- */
  function splitChars(el){
    if(el.__split) return;
    el.__split = true;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while(walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function(n){
      var frag = document.createDocumentFragment();
      Array.from(n.nodeValue).forEach(function(c){
        var s = document.createElement('span');
        s.className = 'ch';
        s.textContent = c;
        frag.appendChild(s);
      });
      n.parentNode.replaceChild(frag, n);
    });
    var caret = document.createElement('i');
    caret.className = 'caret';
    el.appendChild(caret);
  }

  /* 打字，返回总耗时 ms */
  function typeIn(el, my){
    splitChars(el);
    var chs = el.querySelectorAll('.ch');
    var sp = +el.getAttribute('data-speed') || 26;
    el.classList.remove('done');
    chs.forEach(function(c, i){
      later(function(){ if(my === token) c.classList.add('in'); }, i * sp);
    });
    var total = chs.length * sp;
    later(function(){ if(my === token) el.classList.add('done'); }, total + 60);
    return total + 120;
  }

  /* ---------- 数字滚动 ---------- */
  function countUp(el, my){
    var to = +el.getAttribute('data-count');
    var dur = +el.getAttribute('data-dur') || 1200;
    var t0 = performance.now();
    function step(now){
      if(my !== token) return;
      var p = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * e);
      if(p < 1) requestAnimationFrame(step);
    }
    el.textContent = '0';
    requestAnimationFrame(step);
  }

  /* ---------- 序列 ---------- */
  function ownItems(box){
    return [].filter.call(box.querySelectorAll('.q'), function(q){
      return q.closest('[data-seq]') === box;
    });
  }

  function runSeq(box, my){
    var cfg = (box.getAttribute('data-seq') || '').trim().split(/\s+/);
    var t = +cfg[0] || 300;
    var gap = +cfg[1] || 380;
    ownItems(box).forEach(function(q, i){
      if(i > 0) t += q.hasAttribute('data-d') ? +q.getAttribute('data-d') : gap;
      var at = t;
      later(function(){
        if(my !== token) return;
        q.classList.add('in');
        var add = q.getAttribute('data-add');
        if(add) box.classList.add(add);
        /* 嵌套序列：等这一条出现后再启动 */
        q.querySelectorAll('[data-seq]').forEach(function(inner){
          if(inner.parentElement.closest('.q') === q) runSeq(inner, my);
        });
      }, at);
      var ty = q.matches('[data-type]') ? q : q.querySelector('[data-type]');
      if(ty){
        var dur = 0;
        later(function(){ if(my === token) dur = typeIn(ty, my); }, at);
        /* 打字时长可预估：字数 × 速度 */
        splitChars(ty);
        t += ty.querySelectorAll('.ch').length * (+ty.getAttribute('data-speed') || 26) + 160;
      }
    });
  }

  function reset(s){
    s.querySelectorAll('.q.in').forEach(function(q){ q.classList.remove('in'); });
    s.querySelectorAll('[data-type]').forEach(function(el){
      el.classList.remove('done');
      el.querySelectorAll('.ch.in').forEach(function(c){ c.classList.remove('in'); });
    });
    s.querySelectorAll('[data-seq]').forEach(function(box){
      ownItems(box).forEach(function(q){
        var add = q.getAttribute('data-add');
        if(add) box.classList.remove(add);
      });
    });
  }

  function run(s){
    clearAll();
    var my = token;
    reset(s);
    if(document.body.classList.contains('exporting')){
      s.querySelectorAll('.q').forEach(function(q){ q.classList.add('in');
        var add = q.getAttribute('data-add'); var box = q.closest('[data-seq]');
        if(add && box) box.classList.add(add); });
      s.querySelectorAll('[data-type]').forEach(function(el){ splitChars(el); el.classList.add('done');
        el.querySelectorAll('.ch').forEach(function(c){ c.classList.add('in'); }); });
      s.querySelectorAll('[data-count]').forEach(function(el){ el.textContent = el.getAttribute('data-count'); });
      return;
    }
    s.querySelectorAll('[data-seq]').forEach(function(box){
      if(!box.parentElement.closest('.q')) runSeq(box, my);   /* 只启动顶层序列 */
    });
    s.querySelectorAll('[data-type]').forEach(function(el){
      if(el.closest('[data-seq]')) return;
      var d = +el.getAttribute('data-type') || 300;
      later(function(){ if(my === token) typeIn(el, my); }, d);
    });
    s.querySelectorAll('[data-count]').forEach(function(el){ countUp(el, my); });
  }

  /* ---------- 监听翻页 ---------- */
  var mo = new MutationObserver(function(list){
    list.forEach(function(m){
      var s = m.target;
      if(s.classList.contains('on') && !m.oldValue.split(/\s+/).includes('on')) run(s);
    });
  });
  slides.forEach(function(s){
    mo.observe(s, {attributes:true, attributeFilter:['class'], attributeOldValue:true});
  });
  var first = document.querySelector('.slide[data-t].on');
  if(first) run(first);

  document.addEventListener('keydown', function(e){
    if((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey){
      var s = document.querySelector('.slide[data-t].on');
      if(s) run(s);
    }
  });
})();
