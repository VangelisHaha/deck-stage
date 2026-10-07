'use strict';
// 默认稿库：~/Documents/DeckStage。启动时自动建好并登记进稿库，配套 skill 默认把新稿子建在这里，
// 用户不用每次告诉 Agent 放哪、也不用手动添加目录。用户把它从稿库移除后，不会再自动加回来（再手动添加会恢复）。
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const store = require('./store');

const rootDir = () => path.join(app.getPath('documents'), 'DeckStage');
const isDefaultRoot = (dir) => path.resolve(String(dir)) === rootDir();

function ensure() {
  const d = store.read().defaults || {};
  if (d.removed) return;
  try { fs.mkdirSync(rootDir(), { recursive: true }); } catch (e) { return; }
  if (!store.read().roots.includes(rootDir())) store.addRoot(rootDir());
}

// 用户在稿库里移除默认稿库：只取消登记，不删文件，也不再自动加回
function markRemoved() {
  store.removeRoot(rootDir());
  store.update((c) => { c.defaults = Object.assign({}, c.defaults, { removed: true }); });
}

// 用户手动添加了这个目录：恢复自动登记
function noteAdded(dir) {
  if (isDefaultRoot(dir)) store.update((c) => { c.defaults = Object.assign({}, c.defaults, { removed: false }); });
}

module.exports = { rootDir, isDefaultRoot, ensure, markRemoved, noteAdded };
