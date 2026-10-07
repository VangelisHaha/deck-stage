'use strict';
// 稿库界面。所有数据来自主进程的 stage.getState()，这里只负责渲染和把操作转回主进程。
(function () {
  const $ = (id) => document.getElementById(id);
  const pad2 = (n) => String(n).padStart(2, '0');
  let state = null;
  let filter = 'all'; // all | recent | 根目录路径
  let query = '';
  let selected = null;
  let remoteInfo = { enabled: false, devices: [] };
  let playPointer = null;
  let previewOn = true;
  try { previewOn = localStorage.getItem('deckstage.preview') !== 'off'; } catch (e) { /* 没有就默认开 */ }
  const pv = { dir: null, data: null, focus: 0, timer: 0, suspended: false };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function visibleDecks() {
    const q = query.trim().toLowerCase();
    let list = state.decks;
    if (filter === 'recent') list = state.recent.map((d) => list.find((x) => x.dir === d)).filter(Boolean);
    else if (filter !== 'all') list = list.filter((d) => d.root === filter);
    if (q) list = list.filter((d) => (d.title + ' ' + d.name).toLowerCase().includes(q));
    return list;
  }

  function renderNav() {
    const nav = $('nav');
    nav.textContent = '';
    const item = (key, label, count, sub, last) => {
      const b = el('button', 'nav-item' + (sub ? ' sub' : '') + (filter === key ? ' on' : '') + (last ? ' nav-last' : ''));
      const name = el('span', 'name');
      if (filter === key) name.appendChild(el('span', 'sq'));
      name.appendChild(el('span', '', label));
      b.appendChild(name);
      const right = el('span');
      right.appendChild(el('span', 'n', pad2(count)));
      b.appendChild(right);
      b.onclick = () => { filter = key; render(); };
      return { b, right };
    };
    nav.appendChild(item('all', '全部', state.decks.length).b);
    for (const r of state.roots) {
      const count = state.decks.filter((d) => d.root === r.dir).length;
      const rm = r.remote;
      const note = !r.exists ? '（找不到）' : rm && rm.loading ? '（连接中…）' : rm && rm.error ? '（连不上）' : '';
      const { b, right } = item(r.dir, (r.default ? '默认稿库' : r.label) + note, count, true);
      if (rm) {
        b.title = rm.error ? `SSH ${rm.host}：${rm.error}` : `SSH ${rm.host}`;
        const re = el('span', 'x refresh', '↻');
        re.title = '重新扫描这个远端稿库';
        re.onclick = (e) => { e.stopPropagation(); window.stage.refreshRemote(r.dir); };
        right.appendChild(re);
      }
      const x = el('span', 'x', '×');
      x.title = r.demo ? '删除示例稿' : r.default ? '移除默认稿库（不删文件，之后不再自动加回）' : '移除这个稿库目录（不删文件）';
      x.onclick = (e) => { e.stopPropagation(); if (filter === r.dir) filter = 'all'; window.stage.removeRoot(r.dir); };
      right.appendChild(x);
      nav.appendChild(b);
    }
    nav.appendChild(item('recent', '最近放映', state.recent.filter((d) => state.decks.some((x) => x.dir === d)).length, true, true).b);
  }

  function renderList() {
    const list = $('list');
    list.textContent = '';
    const decks = visibleDecks();
    if (!decks.some((d) => d.dir === selected)) selected = decks.length ? decks[0].dir : null;
    window.stage.select(selected);

    decks.forEach((d, i) => {
      const ep = /第\s*(\d+)\s*期/.exec(d.title + d.name);
      const row = el('div', 'deck' + (d.dir === selected ? ' on' : ''));
      row.appendChild(el('div', 'idx', pad2(ep ? ep[1] : i + 1)));
      const main = el('div', 'main');
      main.appendChild(el('div', 'title', d.title));
      const pathLine = el('div', 'path', [d.remote ? 'SSH' : '', d.demo ? '示例' : d.group, d.rel].filter(Boolean).join(' / '));
      if (d.remote) pathLine.appendChild(el('span', 'remote-note', d.remote.cached ? '  · 已缓存' : '  · 未同步'));
      main.appendChild(pathLine);
      row.appendChild(main);
      const meta = el('div', 'meta');
      meta.appendChild(document.createTextNode(ep ? `第 ${ep[1]} 期` : ''));
      meta.appendChild(document.createElement('br'));
      meta.appendChild(document.createTextNode(d.mtimeText));
      const busy = state.exporting && state.exporting[d.dir];
      const acts = el('div', 'acts' + (busy ? ' busy' : ''));
      if (busy) acts.appendChild(el('span', '', busy));
      else {
        for (const [kind, label] of [['zip', '导出 ZIP'], ['pptx', '导出 PPTX']]) {
          const b = el('button', 'act', label);
          b.onclick = (e) => { e.stopPropagation(); window.stage.exportDeck(d.dir, kind); };
          b.ondblclick = (e) => e.stopPropagation();
          acts.appendChild(b);
        }
        if (d.demo) {
          const del = el('button', 'act', '删除示例');
          del.onclick = (e) => { e.stopPropagation(); window.stage.removeDemo(); };
          del.ondblclick = (e) => e.stopPropagation();
          acts.appendChild(del);
        }
      }
      meta.appendChild(acts);
      row.appendChild(meta);
      row.onclick = () => { selected = d.dir; window.stage.select(selected); renderList(); renderBar(); };
      row.ondblclick = () => showPlaySetup(true);
      list.appendChild(row);
    });

    for (const r of state.roots) {
      if (r.remote && r.remote.error && (filter === 'all' || filter === r.dir)) list.appendChild(el('div', 'empty', `远端 ${r.remote.host} 连不上：${r.remote.error}。下面是上次扫描到的稿子（已同步过的仍可放映）。`));
    }
    if (!decks.length) {
      let msg = '没有匹配的稿子。';
      if (!state.roots.length) msg = '还没有登记稿库目录。点左下角「+ 添加稿库目录」，选择放稿子的文件夹。';
      else if (!state.decks.length) msg = `已登记的目录里还没有稿子。让 Agent 用 deck-html skill 生成一份，默认会放在 ${state.defaultRoot || '默认稿库'}，回到这里会自动出现。`;
      list.appendChild(el('div', 'empty', msg));
    } else {
      list.appendChild(el('div', 'empty', 'skills 生成的新稿子放进已登记的目录，回到这个窗口会自动出现。'));
    }
    $('count').textContent = `${state.decks.length} DECKS · ${state.roots.length} ROOT${state.roots.length === 1 ? '' : 'S'}`;
  }

  function renderBar() {
    const status = $('status');
    status.textContent = '';
    if (state.toast) {
      status.appendChild(el('span', 'sq'));
      status.appendChild(el('span', 'text', state.toast));
    } else {
      status.appendChild(el('span', 'sq'));
      status.appendChild(el('span', 'tag', `${state.plan.screens} SCREEN${state.plan.screens > 1 ? 'S' : ''}`));
      status.appendChild(el('span', 'text', state.plan.text));
    }
    $('play').disabled = !selected;
    $('reveal').style.visibility = selected ? 'visible' : 'hidden';
    $('installDemo').hidden = !!(state.demo && state.demo.installed);
    syncPreview();
  }

  function renderSkills() {
    $('skillPath').textContent = state.skills.dir;
    $('prompt').textContent = state.skills.prompt;
    const box = $('agents');
    box.textContent = '';
    const last = state.skills.agents[0];
    box.className = 'agents' + (last ? ' ok' : '');
    box.appendChild(el('span', 'dot'));
    box.appendChild(el('span', last ? '' : 'muted',
      last
        ? '已安装 · ' + state.skills.agents.map((a) => a.agent).join('、')
        : '还没收到 Agent 的回报。装好后这里会变成「已安装 · Agent 名」。'));
  }

  function renderPointerSetup() {
    if (!state || !state.pointer || !playPointer) return;
    const deck = state.decks.find((d) => d.dir === selected);
    $('pointerDeck').textContent = deck ? deck.title : '';
    const styles = $('pointerStyles');
    styles.textContent = '';
    for (const style of state.pointer.styles) {
      const b = el('button', 'pointer-choice' + (style.id === playPointer.style ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(style.id === playPointer.style));
      const img = el('img');
      img.alt = '';
      img.src = style.previews[playPointer.size];
      b.append(img, el('b', '', style.name), el('small', '', style.note));
      b.onclick = () => { playPointer.style = style.id; renderPointerSetup(); };
      styles.appendChild(b);
    }
    const sizes = $('pointerSizes');
    sizes.textContent = '';
    for (const size of state.pointer.sizes) {
      const b = el('button', 'pointer-size' + (size.id === playPointer.size ? ' on' : ''), `${size.name}号 · ${size.px}px`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(size.id === playPointer.size));
      b.onclick = () => { playPointer.size = size.id; renderPointerSetup(); };
      sizes.appendChild(b);
    }
  }

  function showPlaySetup(on) {
    $('playSetup').hidden = !on;
    pv.suspended = !!on;
    if (on) closeZoom();
    syncPreview();
    if (!on) return;
    playPointer = Object.assign({}, state.pointer.value);
    renderPointerSetup();
  }

  async function confirmPlay() {
    if (!selected || !playPointer) return;
    const dir = selected;
    await window.stage.setPointer(playPointer);
    showPlaySetup(false);
    window.stage.open(dir);
  }

  // ---- 预览浮窗：目录 + 每页缩略图 ----
  function syncPreview() {
    const main = document.querySelector('main');
    $('togglePreview').textContent = previewOn ? '预览：开' : '预览：关';
    const deck = state && state.decks.find((d) => d.dir === selected);
    const show = previewOn && !!deck && !pv.suspended; // 选光标 / 开始放映的弹窗开着时，先把预览浮窗收起来
    main.classList.toggle('with-preview', show);
    $('preview').hidden = !show;
    if (!show) { pv.dir = null; return; }
    if (pv.dir === selected && pv.mtime === deck.mtime) return;
    pv.dir = selected;
    pv.mtime = deck.mtime;
    pv.data = null;
    pv.focus = 0;
    pv.title = deck.title;
    renderPreview();
    clearTimeout(pv.timer);
    pv.timer = setTimeout(() => loadPreview(selected), 180); // 在列表里连按上下键时不要每一份都去渲染
  }

  async function loadPreview(dir) {
    const r = await window.stage.previewGet(dir);
    if (pv.dir !== dir) return;
    pv.data = r;
    if (pv.focus >= (r.slides || []).length) pv.focus = 0;
    renderPreview();
  }

  function setPreviewFocus(i) {
    pv.focus = i;
    const s = pv.data && pv.data.slides && pv.data.slides[i];
    $('pvImg').removeAttribute('src');
    if (s && s.thumb) $('pvImg').src = s.thumb;
    document.querySelectorAll('#pvList li').forEach((li, k) => li.classList.toggle('on', k === i));
  }

  function renderPreview() {
    const r = pv.data;
    $('pvTitle').textContent = (r && r.title) || pv.title || '';
    const slides = (r && r.slides) || [];
    const got = slides.filter((s) => s.thumb).length;
    const msg = {
      'remote-unsynced': '这份远端稿子还没同步到本机，放映或导出一次后就能预览。',
      none: '这份稿子无法预览。',
      busy: '放映中，暂不生成预览。',
      error: `预览生成失败：${(r && r.message) || '未知原因'}（稿子能正常放映就不影响使用）`
    };
    let meta = '';
    let hero = '';
    if (!r) { meta = '正在读取…'; hero = '正在生成预览…'; }
    else if (msg[r.state]) { hero = msg[r.state]; }
    else {
      meta = `${r.total} 页${r.minutes ? ` · 约 ${r.minutes} 分钟` : ''}${r.state === 'working' ? ` · 生成中 ${got}/${r.total}` : ''}`;
      if (!slides.length) hero = '正在生成预览…';
    }
    $('pvMeta').textContent = meta;
    $('pvState').textContent = hero;
    const list = $('pvList');
    list.textContent = '';
    $('pvImg').style.display = slides.length && !msg[r && r.state] ? '' : 'none';
    slides.forEach((s, i) => {
      const li = el('li', i === pv.focus ? 'on' : '');
      li.appendChild(el('span', 'no', pad2(i + 1)));
      const th = el('span', 'th');
      if (s.thumb) { const im = el('img'); im.alt = ''; im.src = s.thumb; th.appendChild(im); }
      li.appendChild(th);
      li.appendChild(el('span', 'tt', s.title));
      li.onmouseenter = () => setPreviewFocus(i);
      li.onclick = () => openZoom(i);
      li.ondblclick = () => showPlaySetup(true); // 双击预览里的某一页 = 开始放映这份稿子
      list.appendChild(li);
    });
    setPreviewFocus(Math.min(pv.focus, Math.max(0, slides.length - 1)));
  }

  // ---- 放大查看（点大图 / 点目录行 / 空格）----
  const zoom = { i: 0 };
  function zoomSlides() { return (pv.data && pv.data.slides) || []; }
  function showZoom(i) {
    const slides = zoomSlides();
    if (!slides.length) return;
    zoom.i = Math.max(0, Math.min(slides.length - 1, i));
    const s = slides[zoom.i];
    $('zImg').removeAttribute('src');
    if (s.thumb) $('zImg').src = s.thumb;
    $('zCap').textContent = `${pad2(zoom.i + 1)} / ${pad2(slides.length)} · ${s.title}`;
    $('zPrev').disabled = zoom.i === 0;
    $('zNext').disabled = zoom.i === slides.length - 1;
    setPreviewFocus(zoom.i);
    const row = document.querySelectorAll('#pvList li')[zoom.i];
    if (row) row.scrollIntoView({ block: 'nearest' });
  }
  function openZoom(i) {
    if (!zoomSlides().length) return;
    $('pvZoom').hidden = false;
    showZoom(i == null ? pv.focus : i);
  }
  function closeZoom() { $('pvZoom').hidden = true; }

  async function refreshRemote() {
    remoteInfo = await window.stage.remoteGet();
    renderRemote();
  }

  function renderRemoteBtn() {
    const r = state.remote;
    $('openRemote').className = 'remote-btn' + (r.enabled ? ' on' : '');
    $('remoteText').textContent = r.enabled ? `手机遥控 · 开${r.online ? ' · ' + r.online + ' 台' : ''}` : '手机遥控 · 关';
  }

  function renderRemote() {
    const on = remoteInfo.enabled;
    $('remoteToggle').className = 'switch' + (on ? ' on' : '');
    $('qrBox').className = 'qr-box' + (on ? '' : ' off');
    $('remoteOn').hidden = !on;
    $('remoteOff').hidden = on;
    if (!on) { $('qr').removeAttribute('src'); return; }
    $('qr').src = remoteInfo.qr;
    $('pairCode').textContent = remoteInfo.code.replace(/^(\d{3})(\d{3})$/, '$1 $2');
    $('remoteUrl').textContent = remoteInfo.base;
    const box = $('devices');
    box.textContent = '';
    if (!remoteInfo.devices.length) {
      const empty = el('div', 'muted small', '还没有手机连接。');
      empty.style.marginTop = '10px';
      box.appendChild(empty);
    }
    for (const d of remoteInfo.devices) {
      const row = el('div', 'device');
      row.appendChild(el('span', 'sq' + (d.online ? '' : ' off')));
      row.appendChild(el('span', 'grow', d.label));
      row.appendChild(el('span', 'mono', d.ip));
      const kick = el('button', 'link-ink', '断开');
      kick.onclick = () => window.stage.remoteKick(d.id);
      row.appendChild(kick);
      box.appendChild(row);
    }
  }

  function render() {
    document.querySelector('.brand-sub').textContent = '放映台 · v' + state.version;
    renderRemoteBtn();
    renderNav();
    renderList();
    renderBar();
    renderSkills();
  }

  async function refresh() {
    state = await window.stage.getState();
    if (!$('remote').hidden) refreshRemote();
    if (state.selected) { selected = state.selected; if (!visibleDecks().some((d) => d.dir === selected)) filter = 'all'; }
    render();
  }

  function flash(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = old; }, 1400);
  }

  function showSkills(on) { $('skills').hidden = !on; }
  function showRemote(on) { $('remote').hidden = !on; if (on) refreshRemote(); }

  $('q').addEventListener('input', (e) => { query = e.target.value; renderList(); renderBar(); });
  $('addRoot').onclick = () => window.stage.addRoot();
  $('installDemo').onclick = () => window.stage.installDemo();
  $('togglePreview').onclick = () => {
    previewOn = !previewOn;
    try { localStorage.setItem('deckstage.preview', previewOn ? 'on' : 'off'); } catch (e) { /* 记不住就算了 */ }
    pv.dir = null;
    syncPreview();
  };
  $('pvClose').onclick = () => $('togglePreview').click();
  document.querySelector('.pv-hero').onclick = () => openZoom();
  document.querySelector('.pv-hero').ondblclick = () => showPlaySetup(true);
  $('zImg').ondblclick = () => showPlaySetup(true); // 放大图上双击也一样
  $('zPrev').onclick = () => showZoom(zoom.i - 1);
  $('zNext').onclick = () => showZoom(zoom.i + 1);
  $('zClose').onclick = closeZoom;
  $('pvZoom').addEventListener('click', (e) => { if (e.target === $('pvZoom') || e.target.tagName === 'FIGURE') closeZoom(); });
  window.stage.onPreviewUpdate((dir) => { if (dir === pv.dir) loadPreview(dir); });
  const rf = { host: 'rHost', port: 'rPort', user: 'rUser', pass: 'rPass', path: 'rPath' };
  async function renderConns() {
    const box = $('savedConns');
    const list = await window.stage.connections();
    box.textContent = '';
    box.hidden = !list.length;
    for (const c of list) {
      const b = el('button', 'chip');
      b.type = 'button';
      b.appendChild(el('span', '', `${c.user ? c.user + '@' : ''}${c.host}${c.port && c.port !== '22' ? ':' + c.port : ''}`));
      if (c.hasPassword) b.appendChild(el('span', 'k', '密码已存'));
      const x = el('span', 'x', '×');
      x.title = '忘掉这个连接（连同保存的密码）';
      x.onclick = async (e) => { e.stopPropagation(); await window.stage.forgetConnection(c.id); renderConns(); };
      b.appendChild(x);
      b.onclick = () => {
        $(rf.host).value = c.host; $(rf.port).value = c.port; $(rf.user).value = c.user; $(rf.pass).value = '';
        $(rf.pass).placeholder = c.hasPassword ? '已保存，留空沿用' : '留空则用密钥登录';
        $(rf.path).focus();
      };
      box.appendChild(b);
    }
  }
  function showAddRemote(on) {
    $('addRemote').hidden = !on;
    if (!on) return;
    $('remoteMsg').textContent = '';
    $('remoteMsg').className = 'form-msg';
    for (const id of Object.values(rf)) $(id).value = '';
    $(rf.pass).placeholder = '留空则用密钥登录';
    renderConns();
    $(rf.host).focus();
  }
  async function submitRemote() {
    const msg = $('remoteMsg');
    const input = { host: $(rf.host).value, port: $(rf.port).value, user: $(rf.user).value, password: $(rf.pass).value, path: $(rf.path).value };
    if (!input.host.trim()) { msg.textContent = '请填主机地址'; return; }
    const btn = $('submitRemote');
    btn.disabled = true;
    btn.textContent = '连接中…';
    msg.className = 'form-msg';
    msg.textContent = '';
    const r = await window.stage.addRemote(input);
    btn.disabled = false;
    btn.textContent = '连接并添加';
    if (r.ok) { showAddRemote(false); filter = 'all'; refresh(); }
    else msg.textContent = r.error;
  }
  $('addRemoteRoot').onclick = () => showAddRemote(true);
  $('closeAddRemote').onclick = () => showAddRemote(false);
  $('addRemote').addEventListener('click', (e) => { if (e.target === $('addRemote')) showAddRemote(false); });
  $('submitRemote').onclick = submitRemote;
  for (const id of Object.values(rf)) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') submitRemote(); });
  $('openSkills').onclick = () => showSkills(true);
  $('closeSkills').onclick = () => showSkills(false);
  $('openRemote').onclick = () => showRemote(true);
  $('closeRemote').onclick = () => showRemote(false);
  $('remote').addEventListener('click', (e) => { if (e.target === $('remote')) showRemote(false); });
  $('remoteToggle').onclick = async () => { await window.stage.remoteToggle(!remoteInfo.enabled); await refreshRemote(); };
  $('resetPair').onclick = async () => { await window.stage.remoteReset(); await refreshRemote(); };
  $('copyUrl').onclick = async (e) => { await window.stage.copy(remoteInfo.base); flash(e.target, '已复制'); };
  $('skills').addEventListener('click', (e) => { if (e.target === $('skills')) showSkills(false); });
  $('revealSkill').onclick = () => window.stage.revealSkill();
  $('copyPath').onclick = async (e) => { await window.stage.copy(state.skills.dir); flash(e.target, '已复制'); };
  $('copyPrompt').onclick = async (e) => { await window.stage.copy(state.skills.prompt); flash(e.target, '已复制'); };
  $('play').onclick = () => { if (selected) showPlaySetup(true); };
  $('closePlaySetup').onclick = () => showPlaySetup(false);
  $('playSetup').addEventListener('click', (e) => { if (e.target === $('playSetup')) showPlaySetup(false); });
  $('confirmPlay').onclick = confirmPlay;
  $('reveal').onclick = () => { if (selected) window.stage.reveal(selected); };

  document.addEventListener('keydown', (e) => {
    if (!$('pvZoom').hidden) {
      if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); closeZoom(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); showZoom(zoom.i + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); showZoom(zoom.i - 1); }
      return;
    }
    if (e.key === ' ' && document.activeElement !== $('q') && $('playSetup').hidden && $('skills').hidden && $('remote').hidden && $('addRemote').hidden && !$('preview').hidden && zoomSlides().length) { e.preventDefault(); openZoom(); return; }
    if (e.key === 'Escape') { if (!$('playSetup').hidden) showPlaySetup(false); else if (!$('addRemote').hidden) showAddRemote(false); else if (!$('remote').hidden) showRemote(false); else if (!$('skills').hidden) showSkills(false); else if (query) { $('q').value = ''; query = ''; renderList(); renderBar(); } return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('q').focus(); return; }
    if (!$('playSetup').hidden) { if (e.key === 'Enter') { e.preventDefault(); confirmPlay(); } return; }
    if (!$('skills').hidden || !$('remote').hidden || !$('addRemote').hidden || document.activeElement === $('q') && e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const decks = visibleDecks();
    const i = decks.findIndex((d) => d.dir === selected);
    if (e.key === 'ArrowDown' && i < decks.length - 1) { e.preventDefault(); selected = decks[i + 1].dir; window.stage.select(selected); renderList(); renderBar(); }
    else if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); selected = decks[i - 1].dir; window.stage.select(selected); renderList(); renderBar(); }
    else if (e.key === 'Enter' && selected) { e.preventDefault(); showPlaySetup(true); }
  });

  window.stage.onChanged(refresh);
  window.stage.onShowSkills(() => { showSkills(true); refresh(); });
  window.stage.onShowRemote(() => { showRemote(true); refresh(); });
  refresh();
})();
