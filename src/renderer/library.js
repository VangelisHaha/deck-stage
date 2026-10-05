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
      const { b, right } = item(r.dir, r.label + (r.exists ? '' : '（找不到）'), count, true);
      const x = el('span', 'x', '×');
      x.title = '移除这个稿库目录（不删文件）';
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
      main.appendChild(el('div', 'path', [d.group, d.rel].filter(Boolean).join(' / ')));
      row.appendChild(main);
      const meta = el('div', 'meta');
      meta.appendChild(document.createTextNode(ep ? `第 ${ep[1]} 期` : ''));
      meta.appendChild(document.createElement('br'));
      meta.appendChild(document.createTextNode(d.mtimeText));
      row.appendChild(meta);
      row.onclick = () => { selected = d.dir; window.stage.select(selected); renderList(); renderBar(); };
      row.ondblclick = () => window.stage.open(d.dir);
      list.appendChild(row);
    });

    if (!decks.length) {
      let msg = '没有匹配的稿子。';
      if (!state.roots.length) msg = '还没有登记稿库目录。点左下角「+ 添加稿库目录」，选择放稿子的文件夹。';
      else if (!state.decks.length) msg = '已登记的目录里还没有稿子。让 Agent 用 deck-html skill 生成一份，回到这里会自动出现。';
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
  $('play').onclick = () => { if (selected) window.stage.open(selected); };
  $('reveal').onclick = () => { if (selected) window.stage.reveal(selected); };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('remote').hidden) showRemote(false); else if (!$('skills').hidden) showSkills(false); else if (query) { $('q').value = ''; query = ''; renderList(); renderBar(); } return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('q').focus(); return; }
    if (!$('skills').hidden || !$('remote').hidden || document.activeElement === $('q') && e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const decks = visibleDecks();
    const i = decks.findIndex((d) => d.dir === selected);
    if (e.key === 'ArrowDown' && i < decks.length - 1) { e.preventDefault(); selected = decks[i + 1].dir; window.stage.select(selected); renderList(); renderBar(); }
    else if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); selected = decks[i - 1].dir; window.stage.select(selected); renderList(); renderBar(); }
    else if (e.key === 'Enter' && selected) { e.preventDefault(); window.stage.open(selected); }
  });

  window.stage.onChanged(refresh);
  window.stage.onShowSkills(() => { showSkills(true); refresh(); });
  window.stage.onShowRemote(() => { showRemote(true); refresh(); });
  refresh();
})();
