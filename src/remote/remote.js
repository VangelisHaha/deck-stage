'use strict';
// 手机遥控页。浏览器能做的功能直接显示；浏览器做不了的（音量键映射）只有 App 壳注入
// window.DeckStageNative 时才出现，网页里不展示。
(function () {
  const $ = (id) => document.getElementById(id);
  const pad2 = (n) => String(n).padStart(2, '0');
  const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60); };
  const store = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 隐私模式下写不进去，忽略 */ } }
  };

  let state = null;
  let offset = 0;       // 服务器时间 - 本机时间
  let es = null;
  const cid = Math.random().toString(36).slice(2);

  // ---------- 视图切换 ----------
  function show(name) {
    for (const id of ['pair', 'idle', 'live']) $(id).hidden = id !== name;
  }

  // ---------- 台词渲染：「> 」开头是动作提示，**xx** 是重读 ----------
  function renderNotes(text, box) {
    box.textContent = '';
    if (!text) { const n = document.createElement('div'); n.className = 'none'; n.textContent = '这一页没有台词。'; box.appendChild(n); return; }
    let buf = [];
    const flush = () => {
      if (!buf.length) return;
      const p = document.createElement('p');
      buf.forEach((line, i) => {
        if (i) p.appendChild(document.createElement('br'));
        line.split(/\*\*(.+?)\*\*/).forEach((part, j) => {
          if (j % 2) { const b = document.createElement('b'); b.textContent = part; p.appendChild(b); }
          else p.appendChild(document.createTextNode(part));
        });
      });
      box.appendChild(p);
      buf = [];
    };
    text.split('\n').forEach((raw) => {
      const line = raw.trim();
      if (!line) return flush();
      if (line.charAt(0) === '>') {
        flush();
        const c = document.createElement('div');
        c.className = 'cue';
        c.textContent = 'CUE ▸ ' + line.slice(1).trim();
        box.appendChild(c);
        return;
      }
      buf.push(line);
    });
    flush();
  }

  // ---------- 渲染 ----------
  let lastPage = -1;
  function render() {
    if (!state || !state.live) { show('idle'); return; }
    show('live');
    $('deckName').textContent = '· ' + state.deck;
    $('pageNo').textContent = pad2(state.page + 1);
    $('pageTotal').textContent = '/ ' + pad2(state.total);
    $('slideTitle').textContent = state.slide.t || ('第 ' + (state.page + 1) + ' 页');
    $('nextUp').textContent = state.next ? 'NEXT ▸ ' + state.next : (state.total ? 'END' : '');
    $('btnBlack').classList.toggle('on', !!state.blackout);
    $('btnPrev').disabled = state.page <= 0;

    const ticks = $('ticks');
    if (ticks.children.length !== state.total) {
      ticks.textContent = '';
      for (let i = 0; i < state.total; i++) { const t = document.createElement('div'); t.className = 'tick'; ticks.appendChild(t); }
    }
    Array.prototype.forEach.call(ticks.children, (t, i) => {
      t.className = 'tick' + (i < state.page ? ' done' : i === state.page ? ' now' : '');
    });

    if (lastPage !== state.page) {
      renderNotes(state.slide.text, $('notes'));
      $('notes').scrollTop = 0;
      lastPage = state.page;
    }
  }

  function tick() {
    if (!state || !state.live) return;
    const now = Date.now() + offset;
    $('elapsed').textContent = state.t0 ? mmss(now - state.t0) : '00:00';
  }
  setInterval(tick, 500);

  // ---------- 与电脑通信 ----------
  async function send(cmd, n) {
    try {
      const r = await fetch('/api/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd, n }) });
      if (r.status === 401) return connect();
    } catch (e) { /* 断线时 SSE 会提示 */ }
  }

  function connect() {
    if (es) es.close();
    fetch('/api/me').then((r) => {
      if (r.status === 401) { show('pair'); return; }
      es = new EventSource('/api/events?cid=' + cid);
      es.addEventListener('state', (ev) => {
        state = JSON.parse(ev.data);
        if (state.now) offset = state.now - Date.now();
        $('conn').hidden = true;
        render();
        tick();
      });
      es.onerror = () => {
        $('conn').hidden = false;
        fetch('/api/me').then((x) => { if (x.status === 401) { es.close(); show('pair'); } }).catch(() => {});
      };
      if (!state) show('idle');
    }).catch(() => { $('conn').hidden = false; });
  }

  // ---------- 配对 ----------
  $('pairForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('code').value.trim();
    $('pairErr').textContent = '';
    if (!/^\d{6}$/.test(code)) { $('pairErr').textContent = '请输入 6 位数字'; return; }
    const r = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    if (r.ok) { $('code').value = ''; connect(); }
    else if (r.status === 429) $('pairErr').textContent = '输错太多次，请 1 分钟后再试';
    else $('pairErr').textContent = '配对码不对，看一下电脑上的 6 位数字';
  });

  // ---------- 操作 ----------
  const canVibrate = 'vibrate' in navigator;
  const buzz = () => { if (canVibrate && store.get('vibrate', '1') === '1') navigator.vibrate(15); };
  const act = {
    next: () => { buzz(); send('next'); },
    prev: () => { buzz(); send('prev'); },
    black: () => { buzz(); send('black'); }
  };
  $('btnNext').onclick = act.next;
  $('btnPrev').onclick = act.prev;
  $('btnBlack').onclick = act.black;

  // 点刻度条按位置跳页
  $('ticks').addEventListener('click', (e) => {
    if (!state || !state.total) return;
    const r = $('ticks').getBoundingClientRect();
    send('goto', Math.min(state.total - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * state.total))));
  });

  // 跳页列表
  $('btnJump').onclick = () => {
    if (!state) return;
    const list = $('jumpList');
    list.textContent = '';
    state.titles.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'jump-item' + (i === state.page ? ' now' : '');
      const n = document.createElement('span'); n.className = 'n'; n.textContent = pad2(i + 1);
      const s = document.createElement('span'); s.textContent = t || ('第 ' + (i + 1) + ' 页');
      row.appendChild(n); row.appendChild(s);
      row.onclick = () => { send('goto', i); $('jump').hidden = true; };
      list.appendChild(row);
    });
    $('jump').hidden = false;
  };
  $('jumpClose').onclick = () => { $('jump').hidden = true; };

  // ---------- 按能力显示的附加功能 ----------
  // 震动：Android 浏览器支持，iOS Safari 不支持，不支持就不显示这一行
  if (canVibrate) {
    $('vibrateRow').hidden = false;
    $('vibrate').checked = store.get('vibrate', '1') === '1';
    $('vibrate').onchange = (e) => store.set('vibrate', e.target.checked ? '1' : '0');
  }

  // 防息屏：支持的浏览器静默启用，不需要界面
  if ('wakeLock' in navigator) {
    const lock = () => navigator.wakeLock.request('screen').catch(() => {});
    lock();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lock(); });
  }

  // 音量键映射：网页做不到，只有 App 壳（window.DeckStageNative）提供时才出现。
  // 原生层只需要在按下音量键时派发 deckstage:key 事件，detail 为 'volumeUp' / 'volumeDown'。
  const native = window.DeckStageNative;
  if (native && native.volumeKeys) {
    $('keysBox').hidden = false;
    const opts = [['prev', '上一页'], ['next', '下一页'], ['none', '不响应']];
    const fill = (sel, key, dflt) => {
      opts.forEach(([v, label]) => { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o); });
      sel.value = store.get(key, dflt);
      sel.onchange = () => store.set(key, sel.value);
    };
    fill($('mapUp'), 'map.up', 'prev');
    fill($('mapDown'), 'map.down', 'next');
    window.addEventListener('deckstage:key', (e) => {
      const a = store.get(e.detail === 'volumeUp' ? 'map.up' : 'map.down', e.detail === 'volumeUp' ? 'prev' : 'next');
      if (act[a]) act[a]();
    });
    if (typeof native.enableVolumeKeys === 'function') native.enableVolumeKeys(true);
  }
  if (!$('vibrateRow').hidden || !$('keysBox').hidden) $('extras').hidden = false;

  connect();
})();
