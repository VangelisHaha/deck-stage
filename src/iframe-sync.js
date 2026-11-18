'use strict';
// 内嵌网页（iframe）跨窗口同步桥：
// 演讲者窗口的子帧只采集真实操作（isTrusted）并通过 postMessage 上报顶层页面；
// 观众窗口的子帧只接收来自自身顶层页面的重放指令，单向同步，不产生循环触发。
const { isEditableTarget } = require('../kernel/stage-sync');

function shouldSkipSync(el) {
  if (!el || typeof el !== 'object') return false;
  if (typeof el.closest === 'function' && el.closest('[data-no-sync]')) return true;
  return false;
}

function canScrollHorizontally(el, doc) {
  for (let cur = el; cur && cur !== doc; cur = cur.parentElement) {
    if ((cur.scrollWidth || 0) > (cur.clientWidth || 0) + 6) {
      const win = doc && doc.defaultView;
      if (!win || typeof win.getComputedStyle !== 'function') return true;
      const ox = win.getComputedStyle(cur).overflowX;
      if (ox === 'auto' || ox === 'scroll' || cur === doc.documentElement || cur === doc.body) return true;
    }
  }
  return false;
}

function domPathOf(doc, node) {
  if (!doc || !node || !doc.body) return null;
  if (node === doc || node === doc.documentElement || node === doc.body) return [];
  const path = [];
  for (let cur = node; cur && cur !== doc.body; cur = cur.parentElement) {
    const parent = cur.parentElement;
    if (!parent) return null;
    const idx = Array.prototype.indexOf.call(parent.children, cur);
    if (idx < 0) return null;
    path.unshift(idx);
  }
  return path;
}

function elementHint(el) {
  if (!el || el.nodeType !== 1) return null;
  return {
    tag: (el.tagName || '').toLowerCase(),
    id: el.id || '',
    name: el.getAttribute && (el.getAttribute('name') || ''),
    role: el.getAttribute && (el.getAttribute('role') || '')
  };
}

function nodeFromPath(doc, path, hint, rx, ry) {
  if (!doc || !doc.body) return null;
  if (hint && hint.id) {
    const byId = doc.getElementById(hint.id);
    if (byId) return byId;
  }
  let cur = doc.body;
  if (Array.isArray(path)) {
    for (const i of path) {
      cur = cur && cur.children ? cur.children[i] : null;
      if (!cur) break;
    }
  } else {
    cur = null;
  }
  if (cur && (!hint || !hint.tag || (cur.tagName || '').toLowerCase() === hint.tag)) return cur;
  const win = doc.defaultView;
  if (win && typeof doc.elementFromPoint === 'function' && Number.isFinite(rx) && Number.isFinite(ry)) {
    const hit = doc.elementFromPoint(rx * win.innerWidth, ry * win.innerHeight);
    if (hit) return hit;
  }
  return cur;
}

// 兼容原生表单与 React / Vue 受控输入框：调用原型链上的原生 value/checked setter 再派发事件
function applyControlValue(win, el, msg) {
  if (!el || shouldSkipSync(el)) return false;
  const tag = (el.tagName || '').toUpperCase();
  const Ev = win.Event || Event;
  const InputEv = win.InputEvent || Ev;

  if (tag === 'SELECT') {
    if (typeof msg.selectedIndex === 'number') el.selectedIndex = msg.selectedIndex;
    if (msg.value !== undefined) el.value = msg.value;
  } else if (tag === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
    const desc = win.HTMLInputElement && Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'checked');
    if (desc && desc.set) desc.set.call(el, !!msg.checked);
    else el.checked = !!msg.checked;
  } else if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const proto = tag === 'TEXTAREA' ? win.HTMLTextAreaElement && win.HTMLTextAreaElement.prototype : win.HTMLInputElement && win.HTMLInputElement.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    const nextVal = msg.value == null ? '' : String(msg.value);
    if (desc && desc.set) desc.set.call(el, nextVal);
    else el.value = nextVal;
  } else if (el.isContentEditable && msg.value !== undefined) {
    el.textContent = String(msg.value);
  } else {
    return false;
  }

  el.dispatchEvent(new InputEv('input', { bubbles: true, cancelable: false }));
  if (msg.eventType === 'change') el.dispatchEvent(new Ev('change', { bubbles: true, cancelable: false }));
  return true;
}

function applyScrollSync(doc, msg) {
  if (!doc || !msg) return false;
  const target = msg.isDoc
    ? (doc.scrollingElement || doc.documentElement || doc.body)
    : nodeFromPath(doc, msg.path, msg.hint);
  if (!target) return false;
  const maxX = Math.max(0, (target.scrollWidth || 0) - (target.clientWidth || 0));
  const maxY = Math.max(0, (target.scrollHeight || 0) - (target.clientHeight || 0));
  const nextLeft = maxX > 0 && Number.isFinite(msg.sx) ? Math.round(msg.sx * maxX) : (Number(msg.left) || 0);
  const nextTop = maxY > 0 && Number.isFinite(msg.sy) ? Math.round(msg.sy * maxY) : (Number(msg.top) || 0);
  if (typeof target.scrollTo === 'function') target.scrollTo({ left: nextLeft, top: nextTop, behavior: 'instant' });
  else { target.scrollLeft = nextLeft; target.scrollTop = nextTop; }
  return true;
}

function applyClickSync(win, doc, msg) {
  const target = nodeFromPath(doc, msg.path, msg.hint, msg.rx, msg.ry);
  if (!target || shouldSkipSync(target)) return false;
  const cx = Number.isFinite(msg.rx) ? msg.rx * (win.innerWidth || 0) : 0;
  const cy = Number.isFinite(msg.ry) ? msg.ry * (win.innerHeight || 0) : 0;
  const MouseEv = win.MouseEvent || MouseEvent;
  const PointerEv = win.PointerEvent || MouseEv;
  const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1 };

  if (typeof target.focus === 'function' && isEditableTarget(target)) {
    try { target.focus({ preventScroll: true }); } catch (e) { /* 忽略不支持的参数 */ }
  }
  if (msg.op === 'dblclick') {
    target.dispatchEvent(new MouseEv('dblclick', { ...opts, buttons: 0, detail: 2 }));
    return true;
  }
  target.dispatchEvent(new PointerEv('pointerdown', opts));
  target.dispatchEvent(new MouseEv('mousedown', opts));
  target.dispatchEvent(new PointerEv('pointerup', { ...opts, buttons: 0 }));
  target.dispatchEvent(new MouseEv('mouseup', { ...opts, buttons: 0 }));
  if (typeof target.click === 'function') target.click();
  else target.dispatchEvent(new MouseEv('click', { ...opts, buttons: 0, detail: 1 }));
  return true;
}

function buildSubframeScript(kind) {
  const mode = kind === 'presenter' ? 'presenter' : 'audience';
  return `(function(){
    if (window.__dsSubframeMode === ${JSON.stringify(mode)}) return;
    window.__dsSubframeMode = ${JSON.stringify(mode)};
    const isEditableTarget = ${isEditableTarget.toString()};
    const shouldSkipSync = ${shouldSkipSync.toString()};
    const canScrollHorizontally = ${canScrollHorizontally.toString()};
    const domPathOf = ${domPathOf.toString()};
    const elementHint = ${elementHint.toString()};
    const nodeFromPath = ${nodeFromPath.toString()};
    const applyControlValue = ${applyControlValue.toString()};
    const applyScrollSync = ${applyScrollSync.toString()};
    const applyClickSync = ${applyClickSync.toString()};

    if (${JSON.stringify(mode)} === 'presenter') {
      const post = (payload) => {
        try { if (window.top && window.top !== window) window.top.postMessage(Object.assign({ __dsFrame: 1 }, payload), '*'); } catch (e) {}
      };
      const normXY = (e) => [
        window.innerWidth > 0 ? Math.max(0, Math.min(1, e.clientX / window.innerWidth)) : 0,
        window.innerHeight > 0 ? Math.max(0, Math.min(1, e.clientY / window.innerHeight)) : 0
      ];
      window.addEventListener('mousemove', (e) => {
        const [rx, ry] = normXY(e);
        post({ op: 'move', rx, ry });
      }, { capture: true, passive: true });
      window.addEventListener('mouseleave', () => post({ op: 'leave' }), { capture: true, passive: true });

      const reportTyping = () => post({ op: 'typing', on: isEditableTarget(document.activeElement) });
      document.addEventListener('focusin', reportTyping, true);
      document.addEventListener('focusout', () => setTimeout(reportTyping, 0), true);
      window.addEventListener('blur', () => post({ op: 'typing', on: false }));
      window.addEventListener('message', (e) => {
        if (e.source === window.top && e.data && e.data.__dsBlur && document.activeElement && document.activeElement.blur) {
          document.activeElement.blur();
          post({ op: 'typing', on: false });
        }
      });

      // 子帧焦点防困：未在输入框打字时，PageUp/PageDown 和无横向滚动时的左右键直接透传给舞台翻页，Esc 一键退回舞台焦点
      window.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (isEditableTarget(e.target)) {
          if (e.key === 'Escape') {
            e.preventDefault();
            if (e.target.blur) e.target.blur();
            post({ op: 'typing', on: false });
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          post({ op: 'refocus' });
        } else if (e.key === 'PageDown' || e.key === 'PageUp') {
          e.preventDefault();
          post({ op: 'nav-key', dir: e.key === 'PageDown' ? 1 : -1 });
        } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !canScrollHorizontally(e.target, document)) {
          e.preventDefault();
          post({ op: 'nav-key', dir: e.key === 'ArrowRight' ? 1 : -1 });
        }
      }, true);

      const onClick = (e) => {
        if (!e.isTrusted || e.button !== 0 || shouldSkipSync(e.target)) return;
        const [rx, ry] = normXY(e);
        post({ op: e.type, path: domPathOf(document, e.target), hint: elementHint(e.target), rx, ry });
      };
      window.addEventListener('click', onClick, true);
      window.addEventListener('dblclick', onClick, true);

      const onInput = (e) => {
        if (!e.isTrusted || shouldSkipSync(e.target)) return;
        const t = e.target;
        post({
          op: 'input',
          eventType: e.type,
          path: domPathOf(document, t),
          hint: elementHint(t),
          value: t.isContentEditable ? t.textContent : t.value,
          checked: !!t.checked,
          selectedIndex: typeof t.selectedIndex === 'number' ? t.selectedIndex : -1
        });
      };
      window.addEventListener('input', onInput, true);
      window.addEventListener('change', onInput, true);

      let scrollRaf = 0;
      let pendingScroll = null;
      window.addEventListener('scroll', (e) => {
        const raw = e.target;
        const isDoc = raw === document || raw === document.documentElement || raw === document.body;
        const el = isDoc ? (document.scrollingElement || document.documentElement || document.body) : raw;
        if (!el || (!isDoc && shouldSkipSync(el))) return;
        const maxX = Math.max(0, (el.scrollWidth || 0) - (el.clientWidth || 0));
        const maxY = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
        pendingScroll = {
          op: 'scroll',
          isDoc,
          path: isDoc ? [] : domPathOf(document, el),
          hint: isDoc ? null : elementHint(el),
          sx: maxX > 0 ? el.scrollLeft / maxX : 0,
          sy: maxY > 0 ? el.scrollTop / maxY : 0,
          left: el.scrollLeft || 0,
          top: el.scrollTop || 0
        };
        if (!scrollRaf) {
          scrollRaf = requestAnimationFrame(() => {
            scrollRaf = 0;
            if (pendingScroll) { post(pendingScroll); pendingScroll = null; }
          });
        }
      }, { capture: true, passive: true });

      let urlTimer = 0;
      const syncUrl = () => {
        clearTimeout(urlTimer);
        urlTimer = setTimeout(() => post({ op: 'url', href: location.href }), 90);
      };
      window.addEventListener('hashchange', syncUrl);
      window.addEventListener('popstate', syncUrl);
      for (const fn of ['pushState', 'replaceState']) {
        const orig = history[fn];
        if (typeof orig === 'function') {
          history[fn] = function () { const r = orig.apply(this, arguments); syncUrl(); return r; };
        }
      }
      syncUrl();
      return;
    }

    let urlSyncTimer = 0;
    window.addEventListener('message', (e) => {
      if (e.source !== window.top || !e.data || e.data.__dsReplay !== 1) return;
      const m = e.data;
      if (m.op === 'click' || m.op === 'dblclick') applyClickSync(window, document, m);
      else if (m.op === 'scroll') applyScrollSync(document, m);
      else if (m.op === 'input') {
        const el = nodeFromPath(document, m.path, m.hint);
        if (el) applyControlValue(window, el, m);
      } else if (m.op === 'url' && typeof m.href === 'string' && /^https?:/i.test(m.href)) {
        clearTimeout(urlSyncTimer);
        urlSyncTimer = setTimeout(() => {
          const stripReload = (u) => u.replace(/([?&])_deck_reload=\\d+&?/, '$1').replace(/[?&]$/, '');
          if (stripReload(location.href) !== stripReload(m.href)) location.replace(m.href);
        }, 140);
      }
    });
  })();`;
}

module.exports = {
  shouldSkipSync,
  canScrollHorizontally,
  domPathOf,
  elementHint,
  nodeFromPath,
  applyControlValue,
  applyScrollSync,
  applyClickSync,
  buildSubframeScript
};
