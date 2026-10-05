'use strict';
// 远端稿库：扫描结果缓存、本机镜像目录、放映/导出前的同步。
// 远端稿子在本机的镜像放在 userData/remote/<稿库哈希>/<相对路径>，稿库里的 dir 就是这个本机路径，
// 所以选中、最近放映、导出这些按 dir 工作的逻辑对本地和远端稿子一视同仁。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const ssh = require('./ssh');
const { isDeckDir, deckLabel, formatTime } = require('./util');

const STALE_MS = 30 * 1000;

class RemoteDecks {
  constructor({ onChange }) {
    this.onChange = onChange;
    this.scans = new Map();   // 稿库地址 → { root, decks, at, error, loading }
    this.owners = new Map();  // 本机镜像目录 → { spec, remoteDir, host }
    this.loaded = false;
  }

  base() { return path.join(app.getPath('userData'), 'remote'); }
  indexFile() { return path.join(this.base(), 'index.json'); }
  hash(spec) { return crypto.createHash('sha1').update(spec).digest('hex').slice(0, 10); }
  cacheDir(spec) { return path.join(this.base(), this.hash(spec)); }

  localDirFor(spec, root, remoteDir) {
    const rel = path.posix.relative(root, remoteDir);
    return path.join(this.cacheDir(spec), rel || '_root');
  }

  // 启动时读上次的扫描结果：离线也能看到列表，已同步过的稿子照样能放
  load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const saved = JSON.parse(fs.readFileSync(this.indexFile(), 'utf8'));
      for (const [spec, s] of Object.entries(saved)) this.scans.set(spec, { ...s, loading: false, error: '' });
      this.reindex();
    } catch (e) { /* 没有就算了 */ }
  }

  save() {
    try {
      fs.mkdirSync(this.base(), { recursive: true });
      const out = {};
      for (const [spec, s] of this.scans) out[spec] = { root: s.root, decks: s.decks, at: s.at };
      fs.writeFileSync(this.indexFile(), JSON.stringify(out));
    } catch (e) { /* 缓存写不了不影响使用 */ }
  }

  reindex() {
    this.owners.clear();
    for (const [spec, s] of this.scans) {
      const r = ssh.parseRemote(spec);
      if (!r || !s.decks) continue;
      for (const d of s.decks) this.owners.set(this.localDirFor(spec, s.root, d.remoteDir), { spec, remoteDir: d.remoteDir, host: r.host });
    }
  }

  owner(localDir) { return this.owners.get(localDir) || null; }

  // 重新扫一个远端稿库；失败时保留旧列表，只记下错误
  async refresh(spec) {
    const r = ssh.parseRemote(spec);
    if (!r) return;
    const prev = this.scans.get(spec) || { root: r.path, decks: [], at: 0 };
    this.scans.set(spec, { ...prev, loading: true, error: '' });
    this.onChange();
    try {
      const { root, decks } = await ssh.scan(r);
      this.scans.set(spec, { root, decks, at: Date.now(), loading: false, error: '' });
      this.save();
    } catch (e) {
      this.scans.set(spec, { ...prev, loading: false, error: e.message });
    }
    this.reindex();
    this.onChange();
  }

  refreshAll(specs, { onlyStale = false } = {}) {
    for (const spec of specs) {
      const s = this.scans.get(spec);
      if (s && s.loading) continue;
      if (onlyStale && s && Date.now() - s.at < STALE_MS) continue;
      this.refresh(spec);
    }
  }

  forget(spec) {
    this.scans.delete(spec);
    this.reindex();
    this.save();
    try { fs.rmSync(this.cacheDir(spec), { recursive: true, force: true }); } catch (e) { /* 清不掉就留着 */ }
  }

  // 稿库状态（给界面）
  rootInfo(spec) {
    const r = ssh.parseRemote(spec);
    const s = this.scans.get(spec) || {};
    return { host: r ? r.host : '', loading: !!s.loading, error: s.error || '', at: s.at || 0 };
  }

  decks(spec) {
    const r = ssh.parseRemote(spec);
    const s = this.scans.get(spec);
    if (!r || !s || !s.decks) return [];
    const group = ssh.label(r);
    return s.decks.map((d) => {
      const dir = this.localDirFor(spec, s.root, d.remoteDir);
      const rel = path.posix.relative(s.root, d.remoteDir).replace(/(^|\/)(slides|deck|dist)$/i, '');
      return {
        dir,
        root: spec,
        group,
        title: d.title || deckLabel(dir),
        name: deckLabel(dir),
        mtime: d.mtime,
        mtimeText: formatTime(d.mtime),
        rel,
        remote: { host: r.host, cached: isDeckDir(dir) }
      };
    });
  }

  // 放映 / 导出前把这份稿子同步到本机
  async sync(localDir) {
    const own = this.owner(localDir);
    if (!own) return;
    const r = ssh.parseRemote(own.spec);
    await ssh.syncDir(r, own.remoteDir, localDir);
  }
}

module.exports = { RemoteDecks };
