'use strict';
// 观众窗口、演讲者窗口与访客大屏共用的画面同步与输入判别工具（Node 测试 / 预加载脚本 / 浏览器共用）。
(function (root) {
  const INK_COLOR = '#FF4F1F';
  const INK_WAIT = 3000;
  const INK_FADE = 600;
  const DOT_TTL = 5000;

  const SYNC_ATTR_NAMES = new Set([
    'class', 'hidden', 'disabled', 'style',
    'aria-pressed', 'aria-expanded', 'aria-checked', 'value', 'open', 'src'
  ]);

  function syncAttr(name) {
    return SYNC_ATTR_NAMES.has(name) || name.startsWith('data-') || name.startsWith('aria-');
  }

  // 判断当前事件目标是否为正在输入的可编辑控件（排除按钮类 input），输入时单键快捷键应让位
  function isEditableTarget(el) {
    if (!el || typeof el !== 'object' || el.nodeType !== 1) return false;
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const type = String(el.type || 'text').toLowerCase();
      return !['button', 'submit', 'reset', 'image'].includes(type);
    }
    if (el.isContentEditable) return true;
    if (typeof el.closest === 'function') {
      const ce = el.closest('[contenteditable]');
      if (ce && ce.getAttribute('contenteditable') !== 'false') return true;
    }
    return false;
  }

  function drawPointer(ctx, x, y, rect, style, size) {
    if (!style || !size || !Array.isArray(style.layers)) return;
    const density = Math.max(0.85, Math.min(1.35, rect.width / 1600));
    const scale = (size.px * density) / style.viewBox;
    ctx.save();
    ctx.translate(x - style.tip[0] * scale, y - style.tip[1] * scale);
    ctx.scale(scale, scale);
    for (const layer of style.layers) {
      const shape = new Path2D(layer.path);
      ctx.shadowColor = layer.shadow || 'transparent';
      ctx.shadowBlur = layer.shadow ? style.viewBox * 0.1 : 0;
      ctx.shadowOffsetY = layer.shadow ? style.viewBox * 0.04 : 0;
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

  function resolvePointerPair(catalog) {
    if (!catalog || typeof catalog !== 'object') return { style: null, size: null };
    if (catalog.style && catalog.style.layers && catalog.size && catalog.size.px) {
      return { style: catalog.style, size: catalog.size };
    }
    const val = catalog.value || { style: 'mac', size: 'small' };
    const styles = catalog.styles || [];
    const sizes = catalog.sizes || [];
    return {
      style: styles.find((x) => x.id === val.style) || styles[0] || null,
      size: sizes.find((x) => x.id === val.size) || sizes[0] || null
    };
  }

  function makeInk(canvas, getRect, initialCatalog) {
    const ctx = canvas.getContext('2d');
    const strokes = new Map();
    const win = (canvas.ownerDocument && canvas.ownerDocument.defaultView) || root;
    const rafFn = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : (fn) => setTimeout(() => fn(Date.now()), 16);
    const nowFn = () => (win.performance && win.performance.now ? win.performance.now() : Date.now());
    let pointerCfg = resolvePointerPair(initialCatalog);
    let dot = null;
    let raf = 0;

    function frame(now) {
      raf = 0;
      const cr = canvas.getBoundingClientRect();
      if (!cr.width || !cr.height) return;
      const d = win.devicePixelRatio || 1;
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
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      if (dot && now - dot.at > DOT_TTL) dot = null;
      if (dot) {
        alive = true;
        const [x, y] = at([dot.x, dot.y]);
        drawPointer(ctx, x, y, r, pointerCfg.style, pointerCfg.size);
      }
      if (alive) raf = rafFn(frame);
    }

    const kick = () => { if (!raf) raf = rafFn(frame); };

    return {
      setPointer(catalog) { pointerCfg = resolvePointerPair(catalog); kick(); },
      pointer(x, y) { dot = x == null ? null : { x, y, at: nowFn() }; kick(); },
      add(id, pts) {
        if (!Array.isArray(pts) || !pts.length) return;
        const s = strokes.get(id) || { pts: [], endAt: 0 };
        s.pts.push(...pts);
        strokes.set(id, s);
        kick();
      },
      end(id) { const s = strokes.get(id); if (s) s.endAt = nowFn(); kick(); },
      clear() { strokes.clear(); kick(); },
      apply(m) {
        if (!m || typeof m !== 'object') return;
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
      const win = (node.ownerDocument && node.ownerDocument.defaultView) || root;
      const Ev = win.MouseEvent || MouseEvent;
      node.dispatchEvent(new Ev(type, { bubbles, clientX: x, clientY: y, relatedTarget }));
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
        const doc = stage.ownerDocument;
        const rect = stage.getBoundingClientRect();
        const x = rect.left + nx * rect.width;
        const y = rect.top + ny * rect.height;
        const target = doc.elementFromPoint(x, y);
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

  function syncZonesOf(doc) {
    return Array.from(doc.querySelectorAll('#slides [data-sync]'));
  }

  function pathOf(zone, node) {
    const path = [];
    for (let n = node; n && n !== zone; n = n.parentNode) {
      if (!n.parentNode) return null;
      path.unshift(Array.prototype.indexOf.call(n.parentNode.childNodes, n));
    }
    return path;
  }

  function nodeAt(zone, path) {
    return path.reduce((n, i) => (n && n.childNodes ? n.childNodes[i] : null), zone);
  }

  function snapshotZone(zone, zi, send) {
    zone.querySelectorAll('*').forEach((el) => {
      const attrs = {};
      for (const a of el.attributes) if (syncAttr(a.name)) attrs[a.name] = a.value;
      send({ zi, path: pathOf(zone, el), op: 'attrs', attrs });
    });
  }

  function applyDomSync(doc, m) {
    if (!doc || !m || typeof m !== 'object' || !Array.isArray(m.path)) return;
    doc.documentElement.setAttribute('data-mirror', '');
    const z = syncZonesOf(doc)[m.zi];
    if (!z) return;
    const n = nodeAt(z, m.path);
    if (!n) return;
    if (m.op === 'attr') {
      if (m.value === null) n.removeAttribute(m.name);
      else n.setAttribute(m.name, m.value);
    } else if (m.op === 'attrs' && m.attrs) {
      for (const a of Array.from(n.attributes)) if (syncAttr(a.name) && !(a.name in m.attrs)) n.removeAttribute(a.name);
      for (const [k, v] of Object.entries(m.attrs)) n.setAttribute(k, v);
    } else if (m.op === 'text') {
      n.data = m.value;
    } else if (m.op === 'html') {
      n.innerHTML = m.value;
    }
  }

  function domSyncKey(m) {
    if (!m || !Array.isArray(m.path)) return '';
    return `${m.zi}:${m.path.join('.')}:${m.op}:${m.name || ''}`;
  }

  function pathnameOfUrl(u, baseHref) {
    try { return new URL(u, baseHref).pathname.replace(/^\/deck(?=\/)/, ''); } catch (e) { return String(u || ''); }
  }

  function applyLbSync(doc, m) {
    if (!doc || !m || typeof m !== 'object') return;
    const lb = doc.getElementById('lb');
    const img = doc.getElementById('lbImg');
    if (!lb || !img) return;
    const closeBtn = lb.querySelector('[data-lb="close"]');
    const isOn = () => lb.classList.contains('on');
    const baseHref = (doc.defaultView && doc.defaultView.location && doc.defaultView.location.href) || 'http://localhost/';

    if (m.op === 'open') {
      if (!isOn()) {
        const imgs = Array.from(doc.querySelectorAll('.slide.on .imgslot.has img, .slide.on [data-avatar] img'));
        const hit = imgs.find((x) => pathnameOfUrl(x.currentSrc || x.src, baseHref) === pathnameOfUrl(m.src, baseHref));
        if (hit) hit.click();
        else if (m.src) {
          img.src = m.src;
          const cap = doc.getElementById('lbCap');
          if (cap) cap.textContent = m.cap || '';
          lb.classList.add('on');
          if (doc.defaultView) doc.defaultView.__lbOpen = true;
        }
      }
      if (m.xf && isOn()) applyLbSync(doc, { op: 'xf', ...m.xf });
    } else if (m.op === 'xf') {
      if (!isOn()) return;
      const r = lb.getBoundingClientRect();
      img.style.transform = `translate(${m.nx * r.width}px,${m.ny * r.height}px) scale(${m.s})`;
      const pct = doc.getElementById('lbPct');
      if (pct) pct.textContent = Math.round(m.s * 100) + '%';
      lb.classList.toggle('zoomed', m.s > 1.01);
    } else if (m.op === 'close') {
      if (isOn() && closeBtn) closeBtn.click();
      else if (isOn()) {
        lb.classList.remove('on');
        if (doc.defaultView) doc.defaultView.__lbOpen = false;
      }
    }
  }

  const api = {
    SYNC_ATTR_NAMES,
    syncAttr,
    isEditableTarget,
    drawPointer,
    resolvePointerPair,
    makeInk,
    makeHoverMirror,
    syncZonesOf,
    pathOf,
    nodeAt,
    snapshotZone,
    applyDomSync,
    domSyncKey,
    applyLbSync
  };

  root.DeckStageSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
