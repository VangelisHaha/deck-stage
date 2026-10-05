'use strict';
// 配置落在 userData/config.json。Agent 也可以直接改这个文件（roots 数组），每次读都重新读盘。
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { expandHome, isDir } = require('./util');

// 首次启动时预置的稿库目录（不存在的会被过滤掉）。默认为空，由用户在稿库里添加。
const SEED_ROOTS = [];

const EMPTY = { roots: [], recent: [], skillAgents: [], hotReload: false, trusted: {}, presenter: {} };

function file() { return path.join(app.getPath('userData'), 'config.json'); }

function read() {
  try {
    const cfg = Object.assign({}, EMPTY, JSON.parse(fs.readFileSync(file(), 'utf8')));
    cfg.roots = (cfg.roots || []).map(expandHome);
    return cfg;
  } catch (e) {
    if (e.code === 'ENOENT') {
      const seeded = Object.assign({}, EMPTY, { roots: SEED_ROOTS.map(expandHome).filter(isDir) });
      write(seeded);
      return seeded;
    }
    return Object.assign({}, EMPTY); // 文件损坏时不覆盖，避免丢用户手改的内容
  }
}

function write(cfg) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cfg, null, 2));
}

function update(fn) {
  const cfg = read();
  fn(cfg);
  write(cfg);
  return cfg;
}

function addRoot(dir) {
  return update((c) => { if (!c.roots.includes(dir)) c.roots.push(dir); });
}

function removeRoot(dir) {
  return update((c) => { c.roots = c.roots.filter((r) => r !== dir); });
}

function touchRecent(dir) {
  return update((c) => {
    c.recent = [{ dir, at: Date.now() }, ...c.recent.filter((r) => r.dir !== dir)].slice(0, 20);
  });
}

function recordAgent(agent) {
  return update((c) => {
    c.skillAgents = [{ agent, at: Date.now() }, ...c.skillAgents.filter((a) => a.agent !== agent)].slice(0, 10);
  });
}

module.exports = { read, write, update, addRoot, removeRoot, touchRecent, recordAgent, file };
