'use strict';
// 随应用附带的示例稿：首次启动自动放进稿库，用户看完可以随时删掉（删了不会再自动回来，需要时手动装回）。
// 示例稿复制到 userData 下，不改应用包里的原件；应用升级带来新版示例时，没删过的用户会自动更新到新版。
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const store = require('./store');

const DEMO_VERSION = 2; // 示例稿内容有改动时加一（2：改用 App 内置内核，稿子里不再带 deck.js / deck.css）
const ROOT_NAME = 'DeckStage 示例';
const DECK_NAME = '欢迎使用 DeckStage';

const source = () => (app.isPackaged ? path.join(process.resourcesPath, 'demo') : path.join(app.getAppPath(), 'examples', 'demo'));
const rootDir = () => path.join(app.getPath('userData'), ROOT_NAME);
const isDemoRoot = (dir) => path.resolve(dir) === rootDir();

function copyDeck() {
  const dest = path.join(rootDir(), DECK_NAME);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(rootDir(), { recursive: true });
  fs.cpSync(source(), dest, { recursive: true });
}

function install() {
  copyDeck();
  store.addRoot(rootDir());
  store.update((c) => { c.demo = { state: 'installed', version: DEMO_VERSION }; });
}

function remove() {
  fs.rmSync(rootDir(), { recursive: true, force: true });
  store.removeRoot(rootDir());
  store.update((c) => { c.demo = { state: 'removed', version: DEMO_VERSION }; });
}

// 启动时调用：首次运行安装；已装且版本旧了就更新；用户自己把目录删了就当作删除
function ensure({ firstRun }) {
  const demo = store.read().demo || {};
  if (firstRun && !demo.state) return install();
  if (demo.state !== 'installed') return;
  if (!fs.existsSync(path.join(rootDir(), DECK_NAME))) {
    store.removeRoot(rootDir());
    return store.update((c) => { c.demo = { state: 'removed', version: DEMO_VERSION }; });
  }
  if ((demo.version || 0) < DEMO_VERSION) install();
}

const installed = () => (store.read().demo || {}).state === 'installed';

module.exports = { install, remove, ensure, installed, isDemoRoot, rootDir };
