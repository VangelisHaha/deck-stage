'use strict';
// 访客同屏大屏页：加载真实幻灯舞台（/deck/index.html?visitor=1），
// 通过 SSE 实时同步页码、黑屏、data-sync 状态、图片灯箱以及演讲者的投屏光标与划线；
// 手机竖屏持握/锁定时自动旋转 90° 横屏铺满，并支持一键切回竖屏适配与参与现场互动。
(function () {
  const $ = (id) => document.getElementById(id);
  const Sync = window.DeckStageSync;
  const pad2 = (n) => String(n).padStart(2, '0');
  const store = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 忽略隐私模式 */ } }
  };

  let es = null;
  let state = null;
  let loadedDeckId = '';
  let frameReady = false;
  let frameInk = null;
  let frameHover = null;
  let bridgeToken = 0;
  let bridgePoll = 0;
  let orientMode = store.get('ds.visitor.orient', 'landscape') === 'fit' ? 'fit' : 'landscape';
  let hudTimer = 0;
  let lastIxSlide = -1;
  const submitted = new Map(); // id -> submitted answer
  const pendingDom = [];

  function wakeHud(ms = 3200) {
    const hud = $('hud');
    hud.classList.add('on');
    clearTimeout(hudTimer);
    if (ms > 0) hudTimer = setTimeout(() => { if ($('ixSheet').hidden) hud.classList.remove('on'); }, ms);
  }

  function applyLayout() {
    const shell = $('liveShell');
    if (shell.hidden) return;
    const isPortraitVp = window.innerHeight > window.innerWidth;
    const shouldRotate = isPortraitVp && orientMode === 'landscape';
    shell.classList.toggle('rot90', shouldRotate);
    $('btnOrient').hidden = !isPortraitVp;
    $('btnOrient').textContent = orientMode === 'landscape' ? '竖屏' : '横屏';

    const canFs = !!(document.fullscreenEnabled && shell.requestFullscreen);
    $('btnFull').hidden = !canFs;
    $('btnFull').textContent = document.fullscreenElement ? '退出全屏' : '全屏';

    const cw = $('stageFrame').contentWindow;
    if (cw) { try { cw.dispatchEvent(new cw.Event('resize')); } catch (e) { /* 忽略 */ } }
  }

  window.addEventListener('resize', applyLayout);
  document.addEventListener('fullscreenchange', applyLayout);

  $('btnOrient').onclick = (e) => {
    e.stopPropagation();
    orientMode = orientMode === 'landscape' ? 'fit' : 'landscape';
    store.set('ds.visitor.orient', orientMode);
    applyLayout();
    wakeHud();
  };

  $('btnFull').onclick = (e) => {
    e.stopPropagation();
    const shell = $('liveShell');
    if (!document.fullscreenElement && shell.requestFullscreen) {
      shell.requestFullscreen().then(() => {
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      }).catch(() => {});
    } else if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    wakeHud();
  };

  $('btnIx').onclick = (e) => {
    e.stopPropagation();
    const open = $('ixSheet').hidden;
    $('ixSheet').hidden = !open;
    wakeHud(open ? 0 : 2500);
  };
  $('ixClose').onclick = () => { $('ixSheet').hidden = true; wakeHud(2200); };
  $('liveShell').addEventListener('pointerdown', () => wakeHud(), { passive: true });

  function frameDoc() {
    try { return $('stageFrame').contentDocument; } catch (e) { return null; }
  }
  function frameWin() {
    try { return $('stageFrame').contentWindow; } catch (e) { return null; }
  }

  function syncFramePage(page) {
    const cw = frameWin();
    if (!cw || typeof cw.__go !== 'function') return;
    if (typeof cw.__cur === 'function' && cw.__cur() === page) return;
    cw.__go(page, true);
  }

  function initStageBridge() {
    const doc = frameDoc();
    const cw = frameWin();
    if (!doc || !cw || !doc.body || !Sync) return;
    frameReady = true;

    let canvas = doc.getElementById('stage-ink');
    if (!canvas) {
      canvas = doc.createElement('canvas');
      canvas.id = 'stage-ink';
      canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147482000;pointer-events:none;';
      doc.body.appendChild(canvas);
    }
    frameInk = Sync.makeInk(
      canvas,
      () => (doc.getElementById('stage') || doc.documentElement).getBoundingClientRect(),
      state && state.pointer
    );
    frameHover = Sync.makeHoverMirror(() => doc.getElementById('stage'));
    doc.addEventListener('pointerdown', () => wakeHud(), { capture: true, passive: true });

    if (state && state.live) {
      syncFramePage(state.page || 0);
      (state.domSync || []).forEach((m) => Sync.applyDomSync(doc, m));
      while (pendingDom.length) Sync.applyDomSync(doc, pendingDom.shift());
      if (state.lightbox) Sync.applyLbSync(doc, state.lightbox);
    }
    applyLayout();
  }

  function watchFrameReady() {
    const myToken = ++bridgeToken;
    clearInterval(bridgePoll);
    frameReady = false;
    bridgePoll = setInterval(() => {
      if (myToken !== bridgeToken || frameReady) { clearInterval(bridgePoll); return; }
      const doc = frameDoc();
      const cw = frameWin();
      if (!doc || !cw || cw.location.href === 'about:blank') return;
      if (typeof cw.__go === 'function' && doc.body) {
        clearInterval(bridgePoll);
        initStageBridge();
      }
    }, 60);
  }

  $('stageFrame').addEventListener('load', () => {
    if (!frameReady) initStageBridge();
    else applyLayout();
  });

  function renderInteractions(s) {
    const list = (s && s.slide && s.slide.interactions) || [];
    const btn = $('btnIx');
    if (!list.length) {
      btn.hidden = true;
      $('ixSheet').hidden = true;
      return;
    }
    btn.hidden = false;
    btn.textContent = `参与互动 (${list.length})`;
    if (lastIxSlide !== s.page) {
      lastIxSlide = s.page;
      wakeHud(4500);
    }

    const box = $('interactions');
    box.textContent = '';
    list.forEach((x) => {
      const row = document.createElement('div');
      row.className = 'interaction';
      const label = document.createElement('div');
      label.className = 'ix-label';
      label.textContent = x.label || x.id;
      row.appendChild(label);

      const doneVal = submitted.get(x.id);
      const hasOptions = Array.isArray(x.options) && x.options.length > 0;
      let currentValue = doneVal || (hasOptions ? x.options[0] : (x.type === 'scale' ? String(x.min || 1) : ''));

      const submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.className = 'ix-submit';
      submitBtn.textContent = doneVal ? '已提交 ✓' : (x.type === 'reaction' ? '发送' : x.type === 'scale' ? '评分' : '提交');
      submitBtn.disabled = !!doneVal;

      const doSubmit = (val) => {
        const clean = String(val || '').trim();
        if (!clean) return;
        submitBtn.disabled = true;
        submitBtn.textContent = '提交中…';
        fetch('/api/interaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: x.id, type: x.type, payload: clean })
        }).then((r) => {
          if (!r.ok) throw new Error('bad');
          submitted.set(x.id, clean);
          submitBtn.textContent = '已提交 ✓';
        }).catch(() => {
          submitBtn.disabled = false;
          submitBtn.textContent = '重试';
        });
      };

      if (hasOptions) {
        const optsWrap = document.createElement('div');
        optsWrap.className = 'ix-opts';
        x.options.forEach((opt) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'ix-opt' + (currentValue === opt ? ' sel' : '');
          b.textContent = opt;
          b.disabled = !!doneVal;
          b.onclick = () => {
            currentValue = opt;
            Array.from(optsWrap.children).forEach((c) => c.classList.toggle('sel', c === b));
          };
          optsWrap.appendChild(b);
        });
        row.appendChild(optsWrap);
        const form = document.createElement('div');
        form.className = 'ix-form';
        submitBtn.onclick = () => doSubmit(currentValue);
        form.appendChild(submitBtn);
        row.appendChild(form);
      } else {
        const form = document.createElement('div');
        form.className = 'ix-form';
        const input = document.createElement('input');
        if (x.type === 'scale') {
          input.type = 'range';
          input.min = x.min || 1;
          input.max = x.max || 5;
          input.value = currentValue || String(input.min);
          const valSpan = document.createElement('span');
          valSpan.className = 'ix-scale-val';
          valSpan.textContent = input.value;
          input.oninput = () => { valSpan.textContent = input.value; currentValue = input.value; };
          input.disabled = !!doneVal;
          submitBtn.onclick = () => doSubmit(input.value);
          form.append(input, valSpan, submitBtn);
        } else {
          input.type = 'text';
          input.placeholder = x.placeholder || '输入你的想法…';
          input.value = doneVal || '';
          input.disabled = !!doneVal;
          input.oninput = () => { currentValue = input.value; };
          submitBtn.onclick = () => doSubmit(input.value);
          form.append(input, submitBtn);
        }
        row.appendChild(form);
      }
      box.appendChild(row);
    });
  }

  function render(s) {
    state = s;
    if (!s || !s.live) {
      $('liveShell').hidden = true;
      $('idle').hidden = false;
      $('idleTitle').textContent = '等待放映…';
      $('idleSub').textContent = '已连上放映台。演讲开始后会自动切换为横屏大屏同步画面。';
      loadedDeckId = '';
      frameReady = false;
      return;
    }

    $('idle').hidden = true;
    const wasHidden = $('liveShell').hidden;
    $('liveShell').hidden = false;
    $('blackout').hidden = !s.blackout;
    $('pageBadge').textContent = `${pad2((s.page || 0) + 1)} / ${pad2(s.total || 0)}`;

    const targetDeckId = String(s.deckId || s.deck || 'live');
    if (loadedDeckId !== targetDeckId) {
      loadedDeckId = targetDeckId;
      pendingDom.length = 0;
      watchFrameReady();
      $('stageFrame').src = `/deck/index.html?visitor=1&d=${encodeURIComponent(targetDeckId)}#p${(s.page || 0) + 1}`;
    } else if (frameReady) {
      syncFramePage(s.page || 0);
      if (frameInk && s.pointer) frameInk.setPointer(s.pointer);
      const doc = frameDoc();
      if (doc && !s.lightbox) Sync.applyLbSync(doc, { op: 'close' });
    }

    renderInteractions(s);
    applyLayout();
    if (wasHidden) wakeHud();
  }

  function connect() {
    if (es) es.close();
    $('conn').hidden = true;
    fetch('/api/me').then((r) => {
      if (r.status === 401) {
        $('liveShell').hidden = true;
        $('idle').hidden = false;
        $('idleTitle').textContent = '链接已失效';
        $('idleSub').textContent = '二维码已更新，请重新扫描大屏上的访客二维码。';
        return;
      }
      es = new EventSource('/api/events');
      es.addEventListener('state', (e) => {
        $('conn').hidden = true;
        render(JSON.parse(e.data));
      });
      es.addEventListener('pointer', (e) => {
        if (!frameReady || !frameInk) return;
        const m = JSON.parse(e.data);
        frameInk.apply(m);
        if (frameHover) {
          if (m.k === 'm') frameHover.move(m.x, m.y);
          else if (m.k === 'l') frameHover.clear();
        }
      });
      es.addEventListener('dom', (e) => {
        const m = JSON.parse(e.data);
        const doc = frameDoc();
        if (frameReady && doc) Sync.applyDomSync(doc, m);
        else pendingDom.push(m);
      });
      es.addEventListener('lb', (e) => {
        const doc = frameDoc();
        if (frameReady && doc) Sync.applyLbSync(doc, JSON.parse(e.data));
      });
      es.onerror = () => { $('conn').hidden = false; };
    }).catch(() => { $('conn').hidden = false; });
  }

  if ('wakeLock' in navigator) {
    const lock = () => navigator.wakeLock.request('screen').catch(() => {});
    lock();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lock(); });
  }

  $('retry').onclick = connect;
  connect();
})();
