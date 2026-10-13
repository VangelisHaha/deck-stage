'use strict';
// 配置落在 userData/config.json。Agent 也可以直接改这个文件（roots 数组），每次读都重新读盘。
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { isDir } = require('./util');
const { resolveLocalPath, pathKey, samePath } = require('./paths');
const ssh = require('./ssh');
const { DEFAULT_POINTER, normalizePointer } = require('./pointer');

// 首次启动时预置的稿库目录（不存在的会被过滤掉）。默认为空，由用户在稿库里添加。
const SEED_ROOTS = [];

const EMPTY = { roots: [], recent: [], skillAgents: [], hotReload: false, trusted: {}, presenter: {}, pointer: DEFAULT_POINTER, demo: {}, defaults: {} };

function file() { return path.join(app.getPath('userData'), 'config.json'); }

function normalizeRoot(dir) { return ssh.isRemote(dir) ? dir : resolveLocalPath(dir); }

function rootKey(dir) {
  const remote = ssh.parseRemote(dir);
  return remote ? 'ssh:' + ssh.canonical(remote) : 'local:' + pathKey(dir);
}

function uniqueRoots(roots) {
  const seen = new Set();
  return roots.filter((dir) => typeof dir === 'string' && dir !== '').map(normalizeRoot).filter((dir) => {
    const key = rootKey(dir);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function read() {
  try {
    const cfg = Object.assign({}, EMPTY, JSON.parse(fs.readFileSync(file(), 'utf8')));
    cfg.roots = uniqueRoots(cfg.roots || []);
    cfg.pointer = normalizePointer(cfg.pointer);
    return cfg;
  } catch (e) {
    if (e.code === 'ENOENT') {
      const seeded = Object.assign({}, EMPTY, { roots: SEED_ROOTS.map(resolveLocalPath).filter(isDir) });
      write(seeded);
      return seeded;
    }
    return Object.assign({}, EMPTY); // 文件损坏时不覆盖，避免丢用户手改的内容
  }
}

function write(cfg) {
  cfg.pointer = normalizePointer(cfg.pointer);
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
  const key = rootKey(dir);
  return update((c) => {
    if (!c.roots.some((r) => rootKey(r) === key)) c.roots.push(normalizeRoot(dir));
  });
}

function removeRoot(dir) {
  const key = rootKey(dir);
  return update((c) => { c.roots = c.roots.filter((r) => rootKey(r) !== key); });
}

function touchRecent(dir) {
  return update((c) => {
    c.recent = [{ dir: resolveLocalPath(dir), at: Date.now() }, ...c.recent.filter((r) => !samePath(r.dir, dir))].slice(0, 20);
  });
}

function recordAgent(agent) {
  return update((c) => {
    c.skillAgents = [{ agent, at: Date.now() }, ...c.skillAgents.filter((a) => a.agent !== agent)].slice(0, 10);
  });
}

module.exports = { read, write, update, addRoot, removeRoot, touchRecent, recordAgent, file };
